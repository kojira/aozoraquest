import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { BattleState, Command, DiagnosisResult } from '@aozoraquest/core';
import {
  tierForDanger,
  BATTLE_TUNING,
  canSeeEnemyVitals,
  ITEMS,
  townShopStock,
  type EquipmentDef,
  favoredMonsterFor,
  isWalkable,
  jobLevelFromXp,
  playerCombatant,
  playerLevelFromXp,
  regionAffinity,
  regionDanger,
  regionOf,
  regionsAround,
  rollSearch,
  SEARCH_TUNING,
  statVectorToArray,
  terrainAt,
  tileDetailAt,
  townAt,
  worldOverlay,
  wrap,
} from '@aozoraquest/core';
import { useSession } from '@/lib/session';
import { getRecord } from '@/lib/atproto';
import { COL } from '@/lib/collections';
import { loadWorldState, saveWorldState } from '@/lib/world-state';
import { loadBattleStats } from '@/lib/battle-log';
import { bumpPower, loadPointsState, type PointsState } from '@/lib/points';
import { serverMove, serverTurn, worldServerEnabled, WorldServerError, type ServerBattleState, type ServerAward } from '@/lib/world-server';
import { craftItem, forgeItems, loadCraftInventory, newCraftRkey, newForgeRkey, newSaleRkey, sellMaterials, type CraftedPiece } from '@/lib/crafting';
import { ShopModal, type LastShopAction } from '@/components/shop-modal';
import { GearModal } from '@/components/gear-modal';
import { loadGearRefs, resolveGear, saveGearRefs, type GearRefs } from '@/lib/gear';
import { WORLD_PREVIEW_ENABLED } from '@/lib/world-preview';
import { Avatar } from '@/components/avatar';
import { WorldBattleControls, type BattlePhase } from '@/components/world-battle-controls';
import { EncounterWipe, type WipePhase } from '@/components/encounter-wipe';
import { PLAINS_VARIANTS, TERRAIN_TILES } from '@/components/world-tiles';
import { VirtualStick, type StickDir } from '@/components/virtual-stick';
import { WorldMapModal } from '@/components/world-map-modal';
import { DialogueWindow } from '@/components/dialogue-window';
import { SpiritIcon } from '@/components/spirit-icon';
import { StatusModal } from '@/components/status-modal';
import { WorldHud, HUD_Z, OVERLAY_Z } from '@/components/world-hud';
import { WorldMenu, type WorldMenuCommand } from '@/components/world-menu';
import { ItemsModal, InventoryModal } from '@/components/world-item-modals';
import { FeatherModal } from '@/components/feather-modal';
import type { DialogueLine } from '@/lib/dialogue';

/**
 * あおぞらワールド (docs/19-overworld.md) — 散歩 + 遭遇プレビュー。
 *
 * - 16×16 ビューポート、1 タップ 1 マス、トーラス wrap。
 * - **HP/MP は戦闘をまたいで持続** (オーナー決定)。街に立ち寄ると全回復 + その街が
 *   「最後に立ち寄った街」= 敗北時の帰還先になる。フィールドでどうぐを使える。
 * - 野外戦闘は試練と同じ機構で **1 戦 = パワー 1 消費 + 戦闘レコード + XP/素材の報酬**
 *   (パワー不足だと遭遇しない = 散歩だけならタダ)。遭遇判定自体はまだプレビュー
 *   (Math.random)。PR-W3 で移動ごと Worker (署名付き seed) に置換。dev 環境限定。
 */

const VIEW = 16;
const HALF = VIEW / 2;
const TILE = 32;

type Dir = StickDir; // 仮想スティックと同一の 4 方向
const DIRS: Record<Dir, { dx: number; dy: number }> = {
  up: { dx: 0, dy: -1 },
  down: { dx: 0, dy: 1 },
  left: { dx: -1, dy: 0 },
  right: { dx: 1, dy: 0 },
};

const DANGER_LABELS = ['おだやか', 'すこし危険', '危険', 'とても危険'] as const;

/** サーバーの ServerBattleState を描画用 BattleState として扱う (seed は実行時に存在しない = UI 未使用)。 */
const asBattleState = (s: ServerBattleState): BattleState => s as unknown as BattleState;

interface Vitals {
  x: number;
  y: number;
  /** null = 全快 (最大値はジョブ/レベルから導出) */
  hp: number | null;
  mp: number | null;
  lastTown: { x: number; y: number } | null;
  /** ちずのかけらで解禁済みのリージョン (世界地図の開示範囲) */
  regions: number[];
  /** 訪れたことのある街 (そらのはねの行き先候補) */
  visitedTowns: { x: number; y: number }[];
  /** 初回に そらのはねを 1 個もらったか */
  gotStarterFeather: boolean;
}

/** 初回オンボーディングを見終えたかの localStorage キー (スティックのヒントと同じ方式) */
const ONBOARDING_DONE_KEY = 'aq-world-onboarding-done';
/** 「自分タップでコマンド」コーチマークを出したか。操作 UI が不可視 (スティックも
 *  コマンドもタップ起動) なので、オンボーディングを読み飛ばしても実際にマップへ
 *  立ったとき 1 回だけ操作を思い出させる。一度メニューを開くと消える。 */
const MENU_HINT_DONE_KEY = 'aq-world-menu-hint-done';

/** 初回オンボーディング (話者はブルスコン — 既存の案内役。オーナー指示 2026-07-18)。
 *  操作 → 危険と回復 → ちずのかけら → ちずボタン、の順で旅の前提だけ伝える */
const ONBOARDING_LINES: readonly DialogueLine[] = [
  { speaker: 'ブルスコン', text: 'ようこそ あおぞらワールドへ! わたしは せいれいブルスコン。すこしだけ あんないするね。' },
  { speaker: 'ブルスコン', text: 'マップを おしたまま ゆびを うごかすと あるけるよ。' },
  { speaker: 'ブルスコン', text: 'じぶんを ちょんと おすと、どうぐ・そうび・つよさ などの コマンドが ひらくよ。' },
  { speaker: 'ブルスコン', text: 'そとには モンスターが いる。たたかいに まけると さいごに たちよった 街まで もどされちゃう。あぶなくなったら 街で やすもう。' },
  { speaker: 'ブルスコン', text: '街に つくと「ちずのかけら」が 手に はいって、その街の まわりの ちずが ひろがっていくんだ。' },
  { speaker: 'ブルスコン', text: '🗺 ちずボタンで いつでも たしかめられる。それじゃ、よい たびを!' },
];

export function World() {
  const session = useSession();
  const agent = session.agent ?? null;
  const did = session.did ?? null;
  const [ws, setWs] = useState<Vitals | null>(null);
  const [loadErr, setLoadErr] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);
  const [notice, setNotice] = useState<string | null>(null); // 進めない/回復などの一行メッセージ
  const [onboarding, setOnboarding] = useState(false);
  const onboardingRef = useRef(false);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [playerName, setPlayerName] = useState('');
  const [statusOpen, setStatusOpen] = useState(false);
  const statusOpenRef = useRef(false);
  statusOpenRef.current = statusOpen;
  const [menuOpen, setMenuOpen] = useState(false);
  const menuOpenRef = useRef(false);
  menuOpenRef.current = menuOpen;
  const [menuHint, setMenuHint] = useState(() => {
    try {
      return typeof localStorage !== 'undefined' && localStorage.getItem(MENU_HINT_DONE_KEY) !== '1';
    } catch {
      return false;
    }
  });
  const dismissMenuHint = useCallback(() => {
    setMenuHint(false);
    try { localStorage.setItem(MENU_HINT_DONE_KEY, '1'); } catch { /* private mode */ }
  }, []);
  const [itemsOpen, setItemsOpen] = useState(false);
  const [invOpen, setInvOpen] = useState(false);
  const [searchMsg, setSearchMsg] = useState<string | null>(null);
  const searchMsgRef = useRef(false);
  searchMsgRef.current = searchMsg !== null;
  const [featherOpen, setFeatherOpen] = useState(false);
  const [starterMsg, setStarterMsg] = useState<string | null>(null);
  const starterMsgRef = useRef(false);
  starterMsgRef.current = starterMsg !== null;
  const itemsOpenRef = useRef(false);
  itemsOpenRef.current = itemsOpen;
  const invOpenRef = useRef(false);
  invOpenRef.current = invOpen;
  const featherOpenRef = useRef(false);
  featherOpenRef.current = featherOpen;
  const [diag, setDiag] = useState<DiagnosisResult | null>(null);
  /** やくそう/そらのしずくの手持ち。戦闘内の使用と獲得は battle レコードに残る。
   *  フィールドでの使用はセッション内のみ (TODO(W3): 在庫の正を Worker/DO に移す)。 */
  const [herbStock, setHerbStock] = useState(0);
  const [tonicStock, setTonicStock] = useState(0);
  const [featherStock, setFeatherStock] = useState(0);
  /** 素材の全在庫 (敗北ロス抽選の母集団)。ロード時に battle stats から初期化し、
   *  ドロップ/使用 (戦闘内・フィールドとも)/敗北ロスをセッション内で追随する */
  const materialsRef = useRef<Record<string, number>>({});
  const subtractMaterial = useCallback((id: string, n: number) => {
    if (!n) return;
    const m = materialsRef.current;
    const left = Math.max(0, (m[id] ?? 0) - n);
    if (left > 0) m[id] = left;
    else delete m[id];
  }, []);
  /** そらのはね帰還のワイプ待ち (cover 完了時に onCoverDone がテレポートを実行する) */
  const featherDestRef = useRef<{ x: number; y: number } | null>(null);
  const [points, setPoints] = useState<PointsState | null>(null);
  const [battle, setBattle] = useState<{
    /** サーバー権威の戦闘 state (seed は含まれない = 先読み不可)。描画のみに使う。 */
    state: BattleState;
    busy: boolean;
    /** DQ 風の交互表示。message=メッセージ窓 / input=コマンド入力 / result=決着後の報酬メッセージ
     *  (別パネルを出さず同じ固定サイズのメッセージ窓に畳む = 枠が伸縮せず敵の位置も動かない) */
    phase: BattlePhase;
    /** サーバーが採番した戦闘 ID (ターン送信に必須)。 */
    battleId: string;
    /** 決着ターンでサーバーが確定した報酬 (result フェーズの表示に使う)。 */
    awarded?: ServerAward;
    /** result フェーズで出す報酬行 (経験値・素材など) */
    resultLines?: readonly string[];
    /** コマンド送信失敗 (503/409/通信断) をバトル画面内に表示する一行。notice は戦闘中は
     *  描画されない (戦闘オーバーレイの外) ので、fail-closed のエラーはここに出す。 */
    errorText?: string;
  } | null>(null);
  /** エンカウント演出 (DQ1 風ワイプ)。cover 中はマップの上でタイルが閉じ、覆い切ったら
   *  バトル画面に差し替えて reveal で開く。支払い通信が長い場合は hold でつなぐ。 */
  const [wipe, setWipe] = useState<WipePhase | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mapRef = useRef<HTMLDivElement>(null);
  const [tilePx, setTilePx] = useState(24);
  const [mapOpen, setMapOpen] = useState(false);
  const mapOpenRef = useRef(mapOpen);
  mapOpenRef.current = mapOpen;
  const [shopOpen, setShopOpen] = useState(false);
  const shopOpenRef = useRef(shopOpen);
  shopOpenRef.current = shopOpen;
  const [craftedPieces, setCraftedPieces] = useState<CraftedPiece[]>([]);
  const [gearRefs, setGearRefs] = useState<GearRefs>({});
  const [gearOpen, setGearOpen] = useState(false);
  const gearOpenRef = useRef(gearOpen);
  gearOpenRef.current = gearOpen;
  const [craftBusy, setCraftBusy] = useState(false);
  const [lastShopAction, setLastShopAction] = useState<LastShopAction | null>(null);
  /** 再試行の冪等化: 失敗した制作/合成/ひきとりの rkey を保持し、同条件の再試行で
   *  使い回す (createRecord は同 rkey で衝突するため 2 重記帳が構造的に起きない) */
  const pendingCraftRef = useRef<{ defId: string; rkey: string } | null>(null);
  const pendingForgeRef = useRef<{ key: string; rkey: string } | null>(null);
  const pendingSaleRef = useRef<{ key: string; rkey: string } | null>(null);
  /** ShopModal 用の素材スナップショット (materialsRef は ref なので再レンダ用に複製) */
  const [materialsView, setMaterialsView] = useState<Record<string, number>>({});

  const archetype = diag?.archetype ?? null;
  // ジョブ/レベル由来の最大値 (フィールド HP/MP バーの分母)
  const resolvedGear = archetype ? resolveGear(gearRefs, craftedPieces, archetype) : null;
  // combat (装備込み) と combatBase (装備なし) は gear 引数だけが違う。base 引数を
  // 共有タプルにして「そうび +N = combat − combatBase」の不変条件を構造的に守る
  // (5 行コピペだと片方の base 導出変更で内訳が黙って壊れる — レビュー ★★)
  const baseArgs = archetype
    ? ([
        archetype,
        jobLevelFromXp(diag?.jobLevel?.xp ?? 0),
        playerLevelFromXp(diag?.playerLevel?.xp ?? 0),
        '',
        diag?.rpgStats ? statVectorToArray(diag.rpgStats) : undefined,
      ] as const)
    : null;
  const combat = baseArgs ? playerCombatant(...baseArgs, undefined, resolvedGear?.selection) : null;
  // 装備なしの素の値 (つよさ画面の「そうび +N」内訳用)。つよさ画面を開いた時だけ
  // 計算する (World は移動/HP バー更新で頻繁に再レンダーする — レビュー ★)
  const combatBase = useMemo(
    () => (statusOpen && baseArgs ? playerCombatant(...baseArgs) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- baseArgs は下記 diag/archetype で代表
    [statusOpen, archetype, diag?.jobLevel?.xp, diag?.playerLevel?.xp, diag?.rpgStats],
  );
  const curHp = combat ? Math.min(ws?.hp ?? combat.maxHp, combat.maxHp) : null;
  const curMp = combat ? Math.min(ws?.mp ?? combat.maxMp, combat.maxMp) : null;

  // 初期ロード。位置の読み込み失敗はエラー表示 + リトライ (spawn に倒すと
  // 「テレポート → 上書き保存」のデータ損失になるため倒さない)。
  useEffect(() => {
    if (session.status !== 'signed-in' || !agent || !did) return;
    let cancelled = false;
    setLoadErr(false);
    let grantStarter = false;
    (async () => {
      try {
        const state = await loadWorldState(agent, did);
        if (cancelled) return;
        // 冒険の初回に そらのはねを 1 個わたす (docs/19。gotStarterFeather で二重配布
        // 防止)。実際の +1 は下の featherStock 初期化 (stats ロード後) で足す
        grantStarter = !state.gotStarterFeather;
        // 今いる場所が街 (spawn 含む) なら訪問済みに含める。歩いて入る move 経路だけ
        // だと、開始の街や そらのはね着地先が行き先候補に入らない (レビュー ★★)
        const curTown = townAt(state.x, state.y);
        const seededVisited = curTown && !state.visitedTowns.some((v) => v.x === state.x && v.y === state.y)
          ? [...state.visitedTowns, { x: state.x, y: state.y }]
          : state.visitedTowns;
        const initialWs = {
          x: state.x,
          y: state.y,
          hp: state.hp,
          mp: state.mp,
          lastTown: state.lastTown,
          regions: state.regions,
          visitedTowns: seededVisited,
          gotStarterFeather: true,
        };
        setWs(initialWs);
        if (grantStarter) {
          // 専用の DQ ウィンドウで見せる (notice だとオンボーディングに覆われ、
          // relocated 通知に上書きされて「もらった瞬間」が消える — レビュー ★★★)
          setStarterMsg('たびの はじめに「そらのはね」を 1 つ もらった! こまったら どうぐ から つかって、行ったことのある街へ もどれるよ。');
          // gotStarterFeather=true は即時保存 (デバウンス中リロードで二重配布しない —
          // かけら/初訪問と同じ流儀。レビュー ★★)
          void saveWorldState(agent, initialWs);
        }
        try {
          if (typeof localStorage !== 'undefined' && localStorage.getItem(ONBOARDING_DONE_KEY) !== '1') {
            setOnboarding(true);
            onboardingRef.current = true;
          }
        } catch { /* private mode */ }
        if (state.relocated) {
          // 歩行不能地形からの退避 (橋の再配置など)。無言で数百タイル動くと混乱する
          const t = townAt(state.x, state.y);
          setNotice(`気がつくと${t ? `「${t.name}」` : 'はじまりの街'}に運ばれていた… (地形が変わったようだ)`);
        }
      } catch (e) {
        console.warn('[world] load failed', e);
        if (!cancelled) setLoadErr(true);
        return;
      }
      const [profile, d, stats, pts, craftInv, refs] = await Promise.all([
        agent.getProfile({ actor: did }).catch(() => null),
        getRecord<DiagnosisResult>(agent, did, COL.analysis, 'self').catch(() => null),
        loadBattleStats(agent, did).catch(() => null),
        loadPointsState(agent, did).catch(() => null),
        loadCraftInventory(agent, did).catch(() => ({ pieces: [], materialsSpent: {} })),
        loadGearRefs(agent, did).catch(() => ({})),
      ]);
      if (cancelled) return;
      setAvatarUrl(profile?.data.avatar ?? null);
      setPlayerName(profile?.data.displayName || profile?.data.handle || '');
      setDiag(d);
      setHerbStock(stats?.materials['herb'] ?? 0);
      setTonicStock(stats?.materials['sky-dew'] ?? 0);
      setFeatherStock((stats?.materials['sky-feather'] ?? 0) + (grantStarter ? 1 : 0));
      {
        const m = { ...(stats?.materials ?? {}) };
        for (const [id, n] of Object.entries(craftInv.materialsSpent)) {
          const left = Math.max(0, (m[id] ?? 0) - n);
          if (left > 0) m[id] = left;
          else delete m[id];
        }
        materialsRef.current = m;
        setMaterialsView({ ...m });
      }
      setCraftedPieces(craftInv.pieces);
      setGearRefs(refs);
      setPoints(pts);
    })();
    return () => { cancelled = true; };
  }, [session.status, agent, did, retryNonce]);

  // タイル実寸の追従 (アバターオーバーレイ用)
  useEffect(() => {
    const el = mapRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const update = () => setTilePx(el.clientWidth / VIEW);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ws === null, battle === null]);

  // 状態保存 (2 秒デバウンス + unmount 時に確定)
  const wsRef = useRef(ws);
  wsRef.current = ws;
  const scheduleSave = useCallback(() => {
    if (!agent) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveTimer.current = null;
      const s = wsRef.current;
      if (s) void saveWorldState(agent, s);
    }, 2000);
  }, [agent]);
  useEffect(() => () => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      const s = wsRef.current;
      if (agent && s) void saveWorldState(agent, s);
    }
  }, [agent]);

  const battleRef = useRef(battle);
  battleRef.current = battle;
  const pointsRef = useRef(points);
  pointsRef.current = points;
  const combatRef = useRef(combat);
  combatRef.current = combat;
  const wipeRef = useRef(wipe);
  wipeRef.current = wipe;
  /** 移動中フラグ。移動は毎回サーバー往復するので、連打で並行 serverMove が飛ばないよう塞ぐ。 */
  const moveBusyRef = useRef(false);

  // 移動は**毎回サーバー (edge Worker) が権威処理する** (docs/21 §5)。クライアントは方向 (隣接1マス)
  // しか送れず、位置も遭遇有無も tier も報酬もサーバーが決める = 改造してもチートできない。
  // クライアント側は結果を描画するだけ (街のかけら/訪問済みは表示用の探索メモなので client 保存)。
  const move = useCallback(
    (dir: Dir) => {
      const s = wsRef.current;
      // 戦闘中・リザルト表示中・地図表示中・ワイプ演出中は移動不可 (全入力経路を一括ガード)。
      if (!s || battleRef.current || mapOpenRef.current || shopOpenRef.current || gearOpenRef.current || wipeRef.current || onboardingRef.current || statusOpenRef.current || menuOpenRef.current || itemsOpenRef.current || invOpenRef.current || searchMsgRef.current || featherOpenRef.current || starterMsgRef.current) return;
      if (moveBusyRef.current) return; // 直前の移動がサーバー往復中 (連打の並行実行を塞ぐ)
      if (!worldServerEnabled || !agent) { setNotice('サーバーに接続できないため移動できない。'); return; }
      const { dx, dy } = DIRS[dir];
      // 即時フィードバック用のローカル先読み (権威はサーバー。壁ドンだけ即返す)。
      const nx = wrap(s.x + dx);
      const ny = wrap(s.y + dy);
      if (!isWalkable(terrainAt(nx, ny))) {
        setNotice('そっちには進めない!');
        return;
      }
      moveBusyRef.current = true;
      void (async () => {
        try {
          const res = await serverMove(agent, dx, dy);
          const cur = wsRef.current ?? s;
          const t = townAt(res.x, res.y);
          let next: Vitals = { ...cur, x: res.x, y: res.y };
          if (res.healed) { next.hp = null; next.mp = null; }
          if (res.terrain === 'town') {
            // ちずのかけら: 街に入るとその街の地方一帯 (3×3 リージョン) が地図に加わる。
            // 訪問済みの街 (そらのはねの行き先候補) も積む。どちらも表示用の探索メモ。
            const around = regionsAround(regionOf(res.x, res.y));
            const gained = around.some((r) => !cur.regions.includes(r));
            const regions = gained ? [...new Set([...cur.regions, ...around])].sort((a, b) => a - b) : cur.regions;
            const newlyVisited = !cur.visitedTowns.some((v) => v.x === res.x && v.y === res.y);
            const visitedTowns = newlyVisited ? [...cur.visitedTowns, { x: res.x, y: res.y }] : cur.visitedTowns;
            next = { ...next, hp: null, mp: null, lastTown: { x: res.x, y: res.y }, regions, visitedTowns };
            setNotice(t ? `「${t.name}」で休んで、すっかり元気になった!${gained ? ' ちずのかけらを 手に入れた!' : ''}` : null);
            wsRef.current = next;
            setWs(next);
            scheduleSave();
            // 離散イベント (かけら/初訪問) はデバウンスを待たず即時にも保存する
            if ((gained || newlyVisited) && agent) void saveWorldState(agent, next);
          } else {
            setNotice(null);
            wsRef.current = next;
            setWs(next);
            scheduleSave();
          }
          // 遭遇: サーバーが封印済み (guard 作成・seed 非公開)。ワイプで覆ってからバトルへ。
          if (res.encounter) {
            const pending = { state: asBattleState(res.encounter.state), busy: false, phase: 'message' as BattlePhase, battleId: res.encounter.battleId };
            battleRef.current = pending;
            setBattle(pending);
            setWipe('cover');
          }
        } catch (e) {
          // 409 は「戦闘中」だけでなく未診断 (診断が先に必要) もあるので code で出し分ける。
          if (e instanceof WorldServerError && e.code === 'diagnosis_required') setNotice('先に 気質診断が ひつようだ。');
          else if (e instanceof WorldServerError && e.status === 409) setNotice('戦闘中は移動できない。');
          else if (e instanceof WorldServerError && e.status === 400) setNotice('そっちには進めない!');
          else if (e instanceof WorldServerError && (e.code === 'timeout' || e.code === 'network')) setNotice('サーバーが応答しない。すこし まってから もう一度。');
          else { console.warn('[world] serverMove failed', e); setNotice('移動できなかった (通信エラー)。'); }
        } finally {
          moveBusyRef.current = false;
        }
      })();
    },
    [scheduleSave, agent],
  );

  // 戦闘コマンドも**毎回サーバーが解決する** (docs/21 §5)。クライアントは battleId + turn + command を送るだけ。
  // 決着ターンの報酬 (XP/ドロップ/素材ロス) はサーバーが権威 state に確定し、awarded として返す。
  // タップ送り (onMessageAdvance) で「〜のダメージ！」を読んでから結果へ進む (DQ 風)。
  const onBattleCommand = useCallback(
    (command: Command) => {
      const b = battleRef.current;
      if (!b || b.busy || b.phase !== 'input') return;
      if (!agent) { setBattle({ ...b, errorText: 'サーバーに接続できず 戦えない。' }); return; }
      const { errorText: _clear, ...bClean } = b; // 再送時は前回エラーを消す (exactOptional のため省略で落とす)
      const busy = { ...bClean, busy: true };
      battleRef.current = busy;
      setBattle(busy);
      void (async () => {
        try {
          const res = await serverTurn(agent, b.battleId, b.state.turn, command);
          const acting = { ...bClean, state: asBattleState(res.state), phase: 'message' as BattlePhase, busy: false, ...(res.awarded ? { awarded: res.awarded } : {}) };
          battleRef.current = acting;
          setBattle(acting);
        } catch (e) {
          // 失敗しても**クライアント側で報酬を付けない** (fail-closed。busy を戻して再送させる)。
          // エラーは戦闘オーバーレイ内に出す (notice は戦闘中は描画されない = 無言失敗になる)。
          const cur = battleRef.current;
          if (!cur) return;
          let errorText = 'こうげきを 送れなかった (通信エラー)。もう一度どうぞ。';
          if (e instanceof WorldServerError && e.status === 503) errorText = 'サーバーに記録できなかった (報酬なし)。でんぱのよい ばしょで もう一度どうぞ。';
          else if (e instanceof WorldServerError && e.status === 409) errorText = 'ターンが ずれた。もう一度どうぞ。';
          else if (e instanceof WorldServerError && (e.code === 'timeout' || e.code === 'network')) errorText = 'サーバーが応答しない。でんぱのよい ばしょで もう一度どうぞ。';
          else console.warn('[world] serverTurn failed', e);
          const revert = { ...cur, busy: false, errorText };
          battleRef.current = revert;
          setBattle(revert);
        }
      })();
    },
    [agent],
  );

  // メッセージ窓のタップ送り。開幕/継戦は入力へ、決着は確定処理してリザルトへ。
  const onMessageAdvance = useCallback(
    async () => {
      const b = battleRef.current;
      if (!b || b.busy) return;
      // result フェーズ (決着後の報酬メッセージ) はタップでマップへ戻る
      if (b.phase === 'result') {
        battleRef.current = null;
        setBattle(null);
        return;
      }
      // agent/did は決着の確定処理 (レコード/XP) だけに要るので、ここでは要求しない。
      // 継戦のタップ送りまで塞ぐと、稀にセッションが切れた時にメッセージが送れず詰む。
      if (b.phase !== 'message') return;
      const next = b.state;
      // 開幕メッセージ (turn 0 = 開幕専用。resolveTurn は turn を必ず +1 するので決着は
      // 常に turn>=1) と継戦は入力フェーズへ戻すだけ
      if (next.turn === 0 || next.outcome === 'ongoing') {
        const back = { ...b, phase: 'input' as BattlePhase };
        battleRef.current = back;
        setBattle(back);
        return;
      }
      // 決着: 報酬は**サーバーが権威 state に確定済み** (onBattleCommand の serverTurn が返した
      // awarded)。ここではクライアント表示を更新するだけ = 一切 XP/パワー/素材を書かない (改造不可)。
      const awarded = b.awarded ?? {};
      const drops = awarded.drops ?? [];
      const lost = awarded.materialsLost ?? [];
      // HP/MP をフィールドに持ち帰る (持続)。敗北はサーバーが carry を消す = 全快なので null に。
      // (注: サーバーは敗北で位置を街へ戻さない。街帰還は今後のサーバー実装課題。ここでは
      //  その場で回復させ、次の serverMove がサーバー権威の位置を返す。)
      if (next.outcome === 'lose') {
        setWs((s) => (s ? { ...s, hp: null, mp: null } : s));
      } else {
        // 満タンは null に正規化 (絶対値で焼くと後のレベルアップで「減って見える」)。
        const hp = next.player.hp >= next.player.maxHp ? null : Math.max(1, next.player.hp);
        const mp = next.player.mp >= next.player.maxMp ? null : next.player.mp;
        setWs((s) => (s ? { ...s, hp, mp } : s));
      }
      scheduleSave();
      // クライアント在庫はサーバー報酬 (awarded) をミラーするだけ (表示用。正はサーバー state)。
      // TODO: 在庫表示もサーバー state を正にする移行 (別 PR)。ここは UX を合わせる best-effort。
      const countOf = (arr: readonly string[], id: string) => arr.filter((x) => x === id).length;
      setHerbStock((n) => Math.max(0, n - countOf(lost, 'herb')) + countOf(drops, 'herb'));
      setTonicStock((n) => Math.max(0, n - countOf(lost, 'sky-dew')) + countOf(drops, 'sky-dew'));
      setFeatherStock((n) => Math.max(0, n - countOf(lost, 'sky-feather')) + countOf(drops, 'sky-feather'));
      {
        const m = { ...materialsRef.current };
        for (const d of drops) m[d] = (m[d] ?? 0) + 1;
        for (const id of lost) {
          const left = Math.max(0, (m[id] ?? 0) - 1);
          if (left > 0) m[id] = left;
          else delete m[id];
        }
        materialsRef.current = m;
      }
      // 報酬を「同じ固定サイズのメッセージ窓」に畳んで出す (別パネルを出すと枠が
      // でかくなり認知負荷 — オーナー指摘)。resultLines が空になるのは実質「逃走
      // (fled = 経験値もドロップも無し)」のみ。その時は即マップへ戻す。
      const dropCounts = new Map<string, number>();
      for (const d of drops) dropCounts.set(d, (dropCounts.get(d) ?? 0) + 1);
      const lostCounts = new Map<string, number>();
      for (const d of lost) lostCounts.set(d, (lostCounts.get(d) ?? 0) + 1);
      const nameOf = (id: string) => ITEMS[id]?.name ?? id;
      const resultLines: string[] = [];
      if (awarded.xp && awarded.xp > 0) resultLines.push(`けいけんち を ${awarded.xp} かくとく！`);
      for (const [id, n] of dropCounts) resultLines.push(`${nameOf(id)}${n > 1 ? ` ×${n}` : ''} を てにいれた！`);
      for (const [id, n] of lostCounts) resultLines.push(`${nameOf(id)}${n > 1 ? ` ×${n}` : ''} を おとしてしまった…`);
      if (next.outcome === 'lose') resultLines.push('たおれてしまった… 気がつくと きずが いえていた。');
      if (resultLines.length === 0) {
        battleRef.current = null;
        setBattle(null);
      } else {
        const done = { ...b, state: next, busy: false, phase: 'result' as BattlePhase, resultLines };
        battleRef.current = done;
        setBattle(done);
      }
    },
    [scheduleSave],
  );

  // ワイプ演出の進行。覆い切った時点で支払いがまだ終わっていなければ hold でつなぐ
  // (通信の遅さが「固まった」に見えず、演出の一部になる)。
  const onCoverDone = useCallback(() => {
    // そらのはね帰還: 覆い切ったところでテレポートして開く (旅の演出をワイプで共用)
    const dest = featherDestRef.current;
    if (dest) {
      featherDestRef.current = null;
      const name = townAt(dest.x, dest.y)?.name ?? worldOverlay().spawn.name;
      wsRef.current = {
        x: dest.x,
        y: dest.y,
        hp: null,
        mp: null,
        lastTown: { x: dest.x, y: dest.y },
        regions: [...new Set([...(wsRef.current?.regions ?? []), ...regionsAround(regionOf(dest.x, dest.y))])].sort((a, b) => a - b),
        // 着地先も行き先候補に (通常は既訪だが、念のため union)
        visitedTowns: (wsRef.current?.visitedTowns ?? []).some((v) => v.x === dest.x && v.y === dest.y)
          ? (wsRef.current?.visitedTowns ?? [])
          : [...(wsRef.current?.visitedTowns ?? []), { x: dest.x, y: dest.y }],
        gotStarterFeather: wsRef.current?.gotStarterFeather ?? true,
      };
      setWs(wsRef.current);
      scheduleSave();
      setNotice(`そらのはねで「${name}」へ舞いもどった!`);
      setWipe('reveal');
      return;
    }
    // エンカウントは serverMove が既に封印済み (battle は準備完了) なので覆い切ったら開くだけ。
    setWipe('reveal');
  }, [scheduleSave]);
  const onRevealDone = useCallback(() => setWipe(null), []);
  // hold タイムアウト (通常は到達しない。serverMove は遭遇 state を同期で返すので hold に入らない)。
  // 保険としてマップに開き直す。
  const onHoldTimeout = useCallback(() => {
    setNotice('通信が不安定でモンスターを見失った…');
    setWipe('reveal');
  }, []);

  // フィールドでやくそうを使う (移動せずに回復。消費の保存は TODO(W3) で DO に)
  const useHerbOnField = useCallback((): string | void => {
    if (!combat || herbStock <= 0) return;
    const cur = wsRef.current;
    if (!cur) return;
    const hpNow = Math.min(cur.hp ?? combat.maxHp, combat.maxHp);
    if (hpNow >= combat.maxHp) {
      setNotice('HP は満タンだ。');
      return 'HP は満タンだ。';
    }
    const heal = Math.round(combat.maxHp * BATTLE_TUNING.herbHealRatio);
    const healed = Math.min(combat.maxHp, hpNow + heal);
    setHerbStock((n) => n - 1);
    subtractMaterial('herb', 1);
    setWs({ ...cur, hp: healed >= combat.maxHp ? null : healed });
    const m = `やくそうを使った! HP が ${healed - hpNow} 回復。`;
    setNotice(m);
    scheduleSave();
    return m;
  }, [combat, herbStock, scheduleSave]);

  // フィールドでそらのしずくを使う (MP 回復)
  const useTonicOnField = useCallback((): string | void => {
    if (!combat || tonicStock <= 0) return;
    const cur = wsRef.current;
    if (!cur) return;
    const mpNow = Math.min(cur.mp ?? combat.maxMp, combat.maxMp);
    if (mpNow >= combat.maxMp) {
      setNotice('MP は満タンだ。');
      return 'MP は満タンだ。';
    }
    const gain = Math.max(1, Math.round(combat.maxMp * BATTLE_TUNING.tonicMpRatio));
    const restored = Math.min(combat.maxMp, mpNow + gain);
    setTonicStock((n) => n - 1);
    subtractMaterial('sky-dew', 1);
    setWs({ ...cur, mp: restored >= combat.maxMp ? null : restored });
    const m = `そらのしずくを使った! MP が ${restored - mpNow} 回復。`;
    setNotice(m);
    scheduleSave();
    return m;
  }, [combat, tonicStock, scheduleSave]);

  // そらのはねを使う: 訪問済みの街から行き先を選ぶ (オーナー要望 2026-07-18)。
  // フィールド専用 (戦闘中はにげるを使う)。消費の保存は TODO(W3) で DO に
  const useFeatherOnField = useCallback(() => {
    if (onboardingRef.current) return;
    if (featherStock <= 0) return;
    const s = wsRef.current;
    // mapOpen / shopOpen も塞ぐ (モーダルの裏へ Tab で抜けて発動でき、店を開いた
    // まま別の街へテレポートすると品揃えが無言で差し替わる — レビュー指摘)
    if (!s || battleRef.current || wipeRef.current || mapOpenRef.current || shopOpenRef.current || gearOpenRef.current || statusOpenRef.current) return;
    setFeatherOpen(true); // 行き先えらびを開く (選ぶと flyToTown が飛ばす)
  }, [featherStock]);

  // 選んだ街へ飛ぶ (そらのはね消費 + ワイプ演出でテレポート)。FeatherModal は選択時に
  // 先に onClose するので二度押しは構造的に不可 (featherStock の stale closure 無害)
  const flyToTown = useCallback((dest: { x: number; y: number }) => {
    const s = wsRef.current;
    if (!s || featherStock <= 0) return;
    // 今いる街は FeatherModal 側で候補除外済み。ここは防御の二重ガード (レビュー ★)
    if (s.x === dest.x && s.y === dest.y) {
      setNotice('もうその街にいる。');
      return;
    }
    setFeatherStock((n) => n - 1);
    subtractMaterial('sky-feather', 1);
    featherDestRef.current = dest;
    // cover が画面を覆うまでの間に「自分の操作の結果」と分かる一言を出す
    // (エンカウント演出と同一のワイプなので、無言だと戦闘が始まると誤解する)
    setNotice('そらのはねをつかった!');
    setWipe('cover'); // 覆い切ったら onCoverDone がテレポートする
  }, [featherStock, subtractMaterial]);

  // しらべる: パワー 1 を使って足元を調べる。luk 連動でアイテムが手に入ることがある
  // (見つからないこともある)。発見物はセッション内在庫に加える (消費の正は TODO(W3))。
  const searchHere = useCallback((): string => {
    const s = wsRef.current;
    const pts = pointsRef.current;
    if (!s || !agent || !did) return 'いま しらべられない (つうしんを かくにんして)。';
    if (!pts || pts.balance < SEARCH_TUNING.powerCost) return `パワーが たりない (しらべるには ${SEARCH_TUNING.powerCost} いる)。とうこうすると ふえるよ。`;
    const luk = combatRef.current?.luk ?? 0;
    const tier = tierForDanger(regionDanger(regionOf(s.x, s.y)));
    const seed = Math.floor(Math.random() * 0xffffffff) >>> 0;
    const found = rollSearch(seed, luk, tier);
    // パワーを 1 消費 (見つかっても見つからなくても。無料の無限試行を作らない)
    const left = Math.max(0, pts.balance - SEARCH_TUNING.powerCost);
    void bumpPower(agent, did, { searchPowerSpent: SEARCH_TUNING.powerCost });
    setPoints((p) => (p ? { ...p, searchPowerSpent: p.searchPowerSpent + SEARCH_TUNING.powerCost, balance: Math.max(0, p.balance - SEARCH_TUNING.powerCost) } : p));
    if (!found) return `あたりを しらべたが、なにも なかった… (のこりパワー ${left})`;
    // 在庫に加える。消耗品 (やくそう/しずく) は「どうぐ」で使え、素材は「もちもの」に入る
    const isConsumable = found === 'herb' || found === 'sky-dew';
    if (found === 'herb') setHerbStock((n) => n + 1);
    else if (found === 'sky-dew') setTonicStock((n) => n + 1);
    const m = materialsRef.current;
    m[found] = (m[found] ?? 0) + 1;
    setMaterialsView({ ...m });
    const where = isConsumable ? 'どうぐ' : 'もちもの';
    return `しらべると、${ITEMS[found]?.name ?? found} を 1 つ 見つけた! (${where}で かくにん / のこりパワー ${left})`;
  }, [agent, did]);

  // なんでも屋で作ってもらう (docs/20 W6b)。支払い: パワー (craftPowerSpent 累積) +
  // 素材 (craft レコードの集計で差し引き)。品質は rkey + luk から決定的
  const onCraft = useCallback(
    async (def: EquipmentDef) => {
      if (!agent || !did || craftBusy) return;
      const town = townAt(wsRef.current?.x ?? -1, wsRef.current?.y ?? -1);
      if (!town) return;
      const towns = worldOverlay().towns;
      const townIndex = Math.max(0, towns.findIndex((t) => t.x === town.x && t.y === town.y));
      const stock = townShopStock(town, townIndex);
      const pts = pointsRef.current;
      const have = materialsRef.current[stock.materialId] ?? 0;
      if (!pts || pts.balance < def.price.power || have < def.price.materials) return;
      // 冪等化: 直前に同じ品で失敗していたら同じ rkey で再試行する
      // (createRecord は同 rkey で衝突するため 2 重制作が構造的に起きない。レビュー指摘)
      const rkey = pendingCraftRef.current?.defId === def.id ? pendingCraftRef.current.rkey : newCraftRkey();
      pendingCraftRef.current = { defId: def.id, rkey };
      setCraftBusy(true);
      try {
        const piece = await craftItem(
          agent,
          {
            itemId: def.id,
            materialId: stock.materialId,
            materialCount: def.price.materials,
            power: def.price.power,
            luk: combat?.luk ?? 0,
          },
          rkey,
        );
        pendingCraftRef.current = null;
        void bumpPower(agent, did, { craftPowerSpent: def.price.power });
        setPoints((p) => (p ? { ...p, craftPowerSpent: p.craftPowerSpent + def.price.power, balance: Math.max(0, p.balance - def.price.power) } : p));
        subtractMaterial(stock.materialId, def.price.materials);
        setMaterialsView({ ...materialsRef.current });
        setCraftedPieces((list) => [...list, piece]);
        setLastShopAction({ piece, kind: 'craft' });
      } catch (e) {
        // 失敗しても店は開いたまま (再試行させる。同 rkey なので 2 重にならない)
        console.warn('[world] craft failed', e);
        setLastShopAction(null);
        setNotice('つくってもらえなかった (通信エラー)。もういちどどうぞ。');
      } finally {
        setCraftBusy(false);
      }
    },
    [agent, did, craftBusy, combat, subtractMaterial],
  );

  // 合成 (きたえる): 同アイテム・同強化値 2 個体 → +1。素材もパワーも不要
  // (燃やす 2 個体そのものが対価 — docs/20 のシンク設計)
  const onForge = useCallback(
    async (def: EquipmentDef, resultLevel: number, rkeys: [string, string]) => {
      if (!agent || !did || craftBusy) return;
      const forgeKey = `${def.id}:${rkeys[0]}:${rkeys[1]}`;
      const frkey = pendingForgeRef.current?.key === forgeKey ? pendingForgeRef.current.rkey : newForgeRkey();
      pendingForgeRef.current = { key: forgeKey, rkey: frkey };
      setCraftBusy(true);
      try {
        const piece = await forgeItems(agent, { itemId: def.id, resultLevel, consumed: rkeys }, frkey);
        pendingForgeRef.current = null;
        setCraftedPieces((list) => [...list.filter((p) => p.rkey !== rkeys[0] && p.rkey !== rkeys[1]), piece]);
        setLastShopAction({ piece, kind: 'forge' });
      } catch (e) {
        console.warn('[world] forge failed', e);
        setLastShopAction(null);
        setNotice('きたえてもらえなかった (通信エラー)。もういちどどうぞ。');
      } finally {
        setCraftBusy(false);
      }
    },
    [agent, did, craftBusy],
  );

  // 素材のひきとり (素材 → パワー。docs/20 の低レート変換)
  const onSell = useCallback(
    async (materialId: string, count: number) => {
      if (!agent || !did || craftBusy || count <= 0) return;
      if ((materialsRef.current[materialId] ?? 0) < count) return;
      const saleKey = `${materialId}:${count}`;
      const srkey = pendingSaleRef.current?.key === saleKey ? pendingSaleRef.current.rkey : newSaleRkey();
      pendingSaleRef.current = { key: saleKey, rkey: srkey };
      setCraftBusy(true);
      try {
        const { powerGained } = await sellMaterials(agent, { materialId, materialCount: count }, srkey);
        pendingSaleRef.current = null;
        void bumpPower(agent, did, { salePowerEarned: powerGained });
        setPoints((p) => (p ? { ...p, salePowerEarned: p.salePowerEarned + powerGained, balance: p.balance + powerGained } : p));
        subtractMaterial(materialId, count);
        setMaterialsView({ ...materialsRef.current });
        setLastShopAction(null);
        setNotice(`${ITEMS[materialId]?.name ?? materialId} ×${count} をひきとってもらい、パワーが ${powerGained} ふえた!`);
      } catch (e) {
        console.warn('[world] sell failed', e);
        setNotice('ひきとってもらえなかった (通信エラー)。もういちどどうぞ。');
      } finally {
        setCraftBusy(false);
      }
    },
    [agent, did, craftBusy, subtractMaterial],
  );

  // 装備の着脱 (gear/self は rkey 参照 — 強化値は直書きしない。docs/20 W6c 契約)
  const gearSavingRef = useRef(false);
  const onEquipChange = useCallback(
    async (next: GearRefs) => {
      if (!agent || gearSavingRef.current) return; // 並行保存で後勝ち巻き戻しを防ぐ
      gearSavingRef.current = true;
      const prev = gearRefs;
      setGearRefs(next); // 楽観更新 (HP/MP バーが即応する)
      try {
        await saveGearRefs(agent, next);
      } catch (e) {
        console.warn('[world] gear save failed', e);
        // 失敗時のみ、まだ next のままなら巻き戻す (関数型で他更新を潰さない)
        setGearRefs((cur) => (cur === next ? prev : cur));
        setNotice('そうびを保存できなかった (通信エラー)。');
      } finally {
        gearSavingRef.current = false;
      }
    },
    [agent, gearRefs],
  );

  // キーボード (PC)。修飾キー付き (Cmd+← のブラウザ戻る等) は奪わない。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      // 演出 (wipe) 中もキーボード移動を止める (ポインタは overlay が吸うが
      // キーボードは素通りするため。レビュー指摘)
      if (!wsRef.current || battleRef.current || wipeRef.current) return;
      const map: Record<string, Dir> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };
      const dir = map[e.key];
      if (dir) {
        e.preventDefault();
        move(dir);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [move]);

  if (!WORLD_PREVIEW_ENABLED) {
    return (
      <div>
        <h2>あおぞらワールド</h2>
        <p style={{ color: 'var(--color-muted)' }}>じゅんびちゅう… もうすこし待っててね。</p>
        <Link to="/spirit">← ブルスコンのところへ戻る</Link>
      </div>
    );
  }
  if (session.status === 'loading') return <p>読み込み中…</p>;
  if (session.status === 'signed-out') {
    return (
      <div>
        <h2>あおぞらワールド</h2>
        <p>ログインすると世界を歩けます。</p>
        <Link to="/onboarding"><button>ログイン</button></Link>
      </div>
    );
  }
  if (loadErr) {
    return (
      <div>
        <h2>あおぞらワールド</h2>
        <p style={{ color: 'var(--color-danger)' }}>現在地を読み込めなかった。通信を確認してもう一度どうぞ。</p>
        <button type="button" onClick={() => setRetryNonce((n) => n + 1)}>再読み込み</button>
      </div>
    );
  }
  if (!ws) return <p>世界を読み込んでいる…</p>;

  // エンカウント演出のオーバーレイ (cover/hold 中はマップの上、reveal 中はバトル画面の上)
  const wipeOverlay = wipe ? (
    <EncounterWipe
      phase={wipe}
      holdMessage="モンスターが あらわれようとしている…"
      onCoverDone={onCoverDone}
      onRevealDone={onRevealDone}
      onHoldTimeout={onHoldTimeout}
    />
  ) : null;

  // 戦闘はページ遷移せず「暗転したマップ枠内」で行う (オーナー要望 2026-07-18)。
  // シーン (敵+ログ) はマップ上オーバーレイ、コマンド/リザルトはマップ下に出す。
  const inBattle = battle !== null && (wipe === null || wipe === 'reveal');

  const town = townAt(ws.x, ws.y);
  const here = terrainAt(ws.x, ws.y);
  const danger = regionDanger(regionOf(ws.x, ws.y));
  // 地域相性: この地方で出やすいモンスター名を現地ヒントにする (相性が見えない導線対策)
  const favoredMonsterName = favoredMonsterFor(tierForDanger(danger), regionAffinity(regionOf(ws.x, ws.y))).name;

  // 自分タップで開く DQ 風コマンド。街にいるときだけ「なんでも屋」を足す。
  // **フックは使わない** (この行は早期 return より後にあるので useMemo だと
  // フック数が可変になり React error #310 でクラッシュする — 2026-07-18 事故)。
  // 毎レンダー生成でも、メニューは開いている間だけマウントされるので実害は無い。
  const inTown = !!town;
  const statusReady = !!combat && !!archetype;
  const menuCommands: WorldMenuCommand[] = [
    { key: 'items', label: 'どうぐ', onSelect: () => setItemsOpen(true) },
    // しらべるは街の外だけ (街=安全地帯で地方素材は出ない)。コストをラベルに明記
    ...(inTown ? [] : [{ key: 'search', label: `しらべる (パワー${SEARCH_TUNING.powerCost})`, onSelect: () => setSearchMsg(searchHere()) } as WorldMenuCommand]),
    { key: 'gear', label: 'そうび', onSelect: () => setGearOpen(true) },
    { key: 'map', label: 'ちず', onSelect: () => setMapOpen(true) },
    { key: 'inventory', label: 'もちもの', onSelect: () => setInvOpen(true) },
    // 使えないコマンドはグレーで残さず消す (なんでも屋と同じポリシー — レビュー ★★)
    ...(statusReady ? [{ key: 'status', label: 'つよさ', onSelect: () => setStatusOpen(true) } as WorldMenuCommand] : []),
    ...(inTown
      ? [{ key: 'shop', label: 'なんでも屋', onSelect: () => { setLastShopAction(null); setMaterialsView({ ...materialsRef.current }); setShopOpen(true); } } as WorldMenuCommand]
      : []),
  ];

  // ビューポートのタイル列 (プレイヤー中央固定)。平地は見た目バリアントを散らす。
  const tiles = [];
  for (let vy = 0; vy < VIEW; vy++) {
    for (let vx = 0; vx < VIEW; vx++) {
      const x = wrap(ws.x - HALF + vx);
      const y = wrap(ws.y - HALF + vy);
      const t = terrainAt(x, y);
      const body = t === 'plains' ? PLAINS_VARIANTS[tileDetailAt(x, y)] : TERRAIN_TILES[t];
      tiles.push(
        <g key={`${vx}-${vy}`} transform={`translate(${vx * TILE},${vy * TILE})`}>
          {body}
        </g>,
      );
    }
  }

  const avatarSize = Math.max(16, Math.round(tilePx * 1.15));

  return (
    <div style={{ maxWidth: 560, margin: '0 auto' }}>
      {/* HUD (HP/MP + 現在地) はマップ上にオーバーレイ表示する — 縦スクロールを
          なくして没入感を上げるため (オーナー要望 2026-07-18)。マップ外に置いて
          いた HP/MP バー・場所ヘッダーは廃止し、下記 WorldHud に集約した。 */}
      <div className="dq-window" style={{ padding: 4 }}>
        <div ref={mapRef} style={{ position: 'relative' }}>
          <svg
            viewBox={`0 0 ${VIEW * TILE} ${VIEW * TILE}`}
            style={{ display: 'block', width: '100%' }}
            aria-label="ワールドマップ"
          >
            {tiles}
            <ellipse
              cx={HALF * TILE + TILE / 2}
              cy={HALF * TILE + TILE * 0.8}
              rx={TILE * 0.34}
              ry={TILE * 0.14}
              fill="rgba(0,0,0,0.3)"
            />
          </svg>
          <div
            style={{
              position: 'absolute',
              left: `${((HALF + 0.5) / VIEW) * 100}%`,
              top: `${((HALF + 0.5) / VIEW) * 100}%`,
              transform: 'translate(-50%, -55%)',
              width: avatarSize,
              height: avatarSize,
              pointerEvents: 'none',
              filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.4))',
            }}
          >
            <Avatar src={avatarUrl ?? undefined} size={avatarSize} archetype={archetype} />
          </div>
          {/* 仮想スティック: マップ全面がタッチ領域。十字キーの置き換え
              (スマホで非常に操作しづらい — オーナー報告 2026-07-17) */}
          <VirtualStick
            onMove={move}
            onTapSelf={() => {
              // 演出中・戦闘中はメニューを開かない。他オーバーレイ (menu/items/inv/
              // map/shop/gear/status) 中はそもそもスティックがそれらの背面シートで
              // 遮断されタップが届かないので、ここでは wipe/battle だけ見れば足りる
              // (move() ガードとは条件集合が非対称 — 意図的)
              if (wipeRef.current || battleRef.current) return;
              dismissMenuHint();
              setMenuOpen(true);
            }}
          />
          {combat && curHp !== null && curMp !== null && (
            <WorldHud
              // 戦闘中は上枠 HP/MP を「戦闘中の実 HP/MP」(battle.state.player) に追従させる。
              // ws.hp/ws.mp は戦闘終了時にしか更新されないので、それを見ると結果画面まで
              // 減らないバグになる (オーナー報告 2026-07-18)。フィールドでは ws 由来。
              hp={battle ? battle.state.player.hp : curHp}
              maxHp={battle ? battle.state.player.maxHp : combat.maxHp}
              mp={battle ? battle.state.player.mp : curMp}
              maxMp={battle ? battle.state.player.maxMp : combat.maxMp}
              locationLabel={town ? `🏘 ${town.name}` : `このあたり: ${DANGER_LABELS[danger]}${here === 'forest' ? '・深い森' : ''} / ${favoredMonsterName}が多い`}
              // 戦闘/リザルト中は HP/MP を暗転オーバーレイより上に出して上枠で鮮明に
              // 見せる (下段の重複バーは廃止し上枠へ一本化 — オーナー要望 2026-07-18)。
              // 値は phase を問わず battle 優先 (上記)、レイヤー (z) だけ wipe を見る
              // inBattle を使う — wipe='cover' の一瞬は値=battle 由来 / z=HUD_Z で意図的に非対称。
              zIndex={inBattle ? OVERLAY_Z + 1 : HUD_Z}
            />
          )}
          {menuHint && !onboarding && !menuOpen && (
            <div
              aria-hidden
              style={{
                position: 'absolute',
                left: '50%',
                top: '50%',
                transform: 'translate(-50%, -50%)',
                pointerEvents: 'none',
                zIndex: HUD_Z,
                textAlign: 'center',
              }}
            >
              <div className="aq-menu-hint-ring" style={{ width: 64, height: 64, borderRadius: '50%', border: '3px solid #fff', margin: '0 auto', boxShadow: '0 0 8px rgba(0,0,0,0.6)' }} />
              <div style={{ marginTop: 4, fontSize: 12, fontWeight: 700, color: '#fff', textShadow: '0 1px 3px rgba(0,0,0,0.9)' }}>
                じぶんを タップ → コマンド
              </div>
              <style>{`
@keyframes aq-menu-hint { 0% { transform: scale(0.8); opacity: 0.9; } 70% { transform: scale(1.25); opacity: 0; } 100% { opacity: 0; } }
.aq-menu-hint-ring { animation: aq-menu-hint 1.5s ease-out infinite; }
@media (prefers-reduced-motion: reduce) { .aq-menu-hint-ring { animation: none; } }
`}</style>
            </div>
          )}
          {menuOpen && <WorldMenu commands={menuCommands} onClose={() => setMenuOpen(false)} />}
          {/* 戦闘: 暗転したマップ枠内で完結 (DQ1 風。ページ遷移なし・縦スクロールなし)。
              敵+ログ+コマンド、リザルトの報酬まで全部この枠内に畳む。上枠 (paddingTop)
              は WorldHud の HP/MP 帯を空けておく。 */}
          {inBattle && battle && (
            <div
              style={{
                position: 'absolute',
                inset: 0,
                zIndex: OVERLAY_Z,
                pointerEvents: 'auto', // 操作オーバーレイ層: 背面スティックへの貫通を吸う
                background: 'rgba(8, 10, 16, 0.92)',
                display: 'flex',
                flexDirection: 'column',
                padding: '0.5em',
                paddingTop: '2.7em', // 上枠 WorldHud (HP/MP) の帯を避ける
                overflow: 'hidden',
              }}
            >
              <WorldBattleControls
                state={battle.state}
                phase={battle.phase}
                busy={battle.busy}
                showEnemyVitals={canSeeEnemyVitals(archetype)}
                resultLines={battle.resultLines ?? []}
                onCommand={onBattleCommand}
                onAdvance={() => void onMessageAdvance()}
              />
              {/* コマンド送信失敗 (fail-closed = 報酬なし) を戦闘画面内に表示。notice はここには出ない。 */}
              {battle.errorText && (
                <p aria-live="assertive" style={{ textAlign: 'center', fontSize: '0.8em', color: 'var(--color-danger, #ff6b6b)', margin: '0.4em 0 0' }}>
                  {battle.errorText}
                </p>
              )}
            </div>
          )}
        </div>
      </div>
      {searchMsg !== null && (
        <DialogueWindow lines={[{ text: searchMsg }]} onDone={() => setSearchMsg(null)} />
      )}
      {starterMsg !== null && !onboarding && (
        <DialogueWindow lines={[{ speaker: 'ブルスコン', text: starterMsg }]} plateIcon={<SpiritIcon size={20} />} onDone={() => setStarterMsg(null)} />
      )}

      {/* マップ下: 戦闘/リザルトはマップ枠内で完結するので何も出さない (縦スクロール
          をなくす — オーナー要望 2026-07-18)。通常時のみ操作ヒント。 */}
      {!inBattle && (
        <p style={{ textAlign: 'center', fontSize: '0.72em', color: 'var(--color-muted)', margin: '0.4em 0 0' }}>
          じぶんを タップすると コマンドが ひらくよ。
        </p>
      )}
      {/* 一時メッセージ + 操作説明は戦闘/リザルト中は隠す (マップ枠内で完結・
          縦スクロールをなくす。オーナー要望 2026-07-18) */}
      {!inBattle && (
        <>
          <p
            aria-live="polite"
            style={{ textAlign: 'center', fontSize: '0.85em', minHeight: '1.6em', margin: '0.5em 0 0' }}
          >
            {notice && <strong style={{ color: 'var(--color-fg)' }}>{notice}</strong>}
          </p>
          <p style={{ textAlign: 'center', fontSize: '0.72em', color: 'var(--color-muted)', marginTop: '0.4em' }}>
            マップをタッチしたまま指を動かすと移動 (PC は矢印キーも可)。街に入ると全回復。
            {diag
              ? points === null
                ? ' パワー残高を読み込めなかった (通信エラー)。モンスターは出ません。再読み込みでもう一度どうぞ。'
                : points.balance >= BATTLE_TUNING.powerCost
                  ? ` 歩くとモンスターが出ることがあります (1 戦 = あおぞらパワー ${BATTLE_TUNING.powerCost}、勝つと経験値と素材)。いまのパワー: ${points.balance}`
                  : ' あおぞらパワーがないのでモンスターは出ません (ホームで投稿すると増える)。'
              : ''}
          </p>
        </>
      )}
      {mapOpen && <WorldMapModal x={ws.x} y={ws.y} regions={ws.regions} onClose={() => setMapOpen(false)} />}
      {itemsOpen && (
        <ItemsModal
          herbStock={herbStock}
          tonicStock={tonicStock}
          featherStock={featherStock}
          canUse={!!combat}
          onUseHerb={useHerbOnField}
          onUseTonic={useTonicOnField}
          onUseFeather={useFeatherOnField}
          onClose={() => setItemsOpen(false)}
        />
      )}
      {invOpen && (
        <InventoryModal materials={materialsRef.current} pieces={craftedPieces} onClose={() => setInvOpen(false)} />
      )}
      {featherOpen && (
        <FeatherModal
          visitedTowns={ws.visitedTowns}
          current={{ x: ws.x, y: ws.y }}
          onSelect={flyToTown}
          onClose={() => setFeatherOpen(false)}
        />
      )}
      {statusOpen && combat && combatBase && archetype && (
        <StatusModal
          name={playerName}
          avatarUrl={avatarUrl}
          archetype={archetype}
          jobLv={jobLevelFromXp(diag?.jobLevel?.xp ?? 0)}
          playerLv={playerLevelFromXp(diag?.playerLevel?.xp ?? 0)}
          jobXp={diag?.jobLevel?.xp ?? 0}
          playerXp={diag?.playerLevel?.xp ?? 0}
          combat={combat}
          combatBase={combatBase}
          hp={curHp}
          mp={curMp}
          gearPieces={resolvedGear?.pieces ?? {}}
          onClose={() => setStatusOpen(false)}
        />
      )}
      {onboarding && (
        <DialogueWindow
          lines={ONBOARDING_LINES}
          plateIcon={<SpiritIcon size={20} />}
          onDone={() => {
            setOnboarding(false);
            onboardingRef.current = false;
            try { localStorage.setItem(ONBOARDING_DONE_KEY, '1'); } catch { /* private mode */ }
          }}
        />
      )}
      {gearOpen && (
        <GearModal
          archetype={archetype}
          pieces={craftedPieces}
          refs={gearRefs}
          onEquip={(slot, rkey) => void onEquipChange({ ...gearRefs, [slot]: rkey })}
          onUnequip={(slot) => {
            const next = { ...gearRefs };
            delete next[slot];
            void onEquipChange(next);
          }}
          onClose={() => setGearOpen(false)}
        />
      )}
      {shopOpen && town && (
        <ShopModal
          town={town}
          townIndex={Math.max(0, worldOverlay().towns.findIndex((t) => t.x === town.x && t.y === town.y))}
          archetype={archetype}
          balance={points?.balance ?? 0}
          materials={materialsView}
          pieces={craftedPieces}
          equippedRkeys={Object.values(resolvedGear?.pieces ?? {}).map((p) => p.rkey)}
          busy={craftBusy}
          lastAction={lastShopAction}
          onCraft={(def) => void onCraft(def)}
          onForge={(def, level, rkeys) => void onForge(def, level, rkeys)}
          onSell={(materialId, count) => void onSell(materialId, count)}
          onClose={() => setShopOpen(false)}
        />
      )}
      {wipeOverlay}
    </div>
  );
}
