import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { BattleState, Command, DiagnosisResult } from '@aozoraquest/core';
import {
  tierForDanger,
  BATTLE_TUNING,
  ITEMS,
  MONSTERS_BY_ID,
  jobDisplayName,
  levelUpGains,
  townShopStock,
  type EquipmentDef,
  type StatGain,
  encounterRateFor,
  isWalkable,
  jobLevelFromXp,
  playerCombatant,
  playerLevelFromXp,
  regionDanger,
  regionOf,
  regionsAround,
  resolveTurn,
  rollDefeatLoss,
  rollDrops,
  startBattle,
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
import { awardBattleXp, finishBattleRecord, loadBattleStats, startBattleRecord, type BattleLevelUps } from '@/lib/battle-log';
import { formatGain, notifyLevelUp } from '@/components/level-up-overlay';
import { bumpPower, loadPointsState, type PointsState } from '@/lib/points';
import { craftItem, forgeItems, loadCraftInventory, newCraftRkey, newForgeRkey, newSaleRkey, sellMaterials, type CraftedPiece } from '@/lib/crafting';
import { ShopModal, type LastShopAction } from '@/components/shop-modal';
import { GearModal } from '@/components/gear-modal';
import { loadGearRefs, resolveGear, saveGearRefs, type GearRefs } from '@/lib/gear';
import { WORLD_PREVIEW_ENABLED } from '@/lib/world-preview';
import { Avatar } from '@/components/avatar';
import { BattleView } from '@/components/battle-view';
import { EncounterWipe, type WipePhase } from '@/components/encounter-wipe';
import { MonsterSvg } from '@/components/monster-svg';
import { PLAINS_VARIANTS, TERRAIN_TILES } from '@/components/world-tiles';
import { VirtualStick, type StickDir } from '@/components/virtual-stick';
import { WorldMapModal } from '@/components/world-map-modal';
import { DialogueWindow } from '@/components/dialogue-window';
import { SpiritIcon } from '@/components/spirit-icon';
import { StatusModal } from '@/components/status-modal';
import { WorldHud, HUD_Z } from '@/components/world-hud';
import { WorldMenu, type WorldMenuCommand } from '@/components/world-menu';
import { ItemsModal, InventoryModal } from '@/components/world-item-modals';
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

interface Vitals {
  x: number;
  y: number;
  /** null = 全快 (最大値はジョブ/レベルから導出) */
  hp: number | null;
  mp: number | null;
  lastTown: { x: number; y: number } | null;
  /** ちずのかけらで解禁済みのリージョン (世界地図の開示範囲) */
  regions: number[];
}

/** 初回オンボーディングを見終えたかの localStorage キー (スティックのヒントと同じ方式) */
const ONBOARDING_DONE_KEY = 'aq-world-onboarding-done';
/** 「自分タップでコマンド」コーチマークを出したか。新規キーなので、どうぐ列廃止で
 *  操作が変わった既存プレイヤーにも 1 回だけ表示される (再オンボーディングの代替)。 */
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
  const itemsOpenRef = useRef(false);
  itemsOpenRef.current = itemsOpen;
  const invOpenRef = useRef(false);
  invOpenRef.current = invOpen;
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
    state: BattleState;
    busy: boolean;
    rkey: string;
    tier: 1 | 2 | 3;
    /** 敗北した場合に落とす素材 (開戦時に seed から確定済み) */
    materialsLost: string[];
  } | null>(null);
  /** エンカウント演出 (DQ1 風ワイプ)。cover 中はマップの上でタイルが閉じ、覆い切ったら
   *  バトル画面に差し替えて reveal で開く。支払い通信が長い場合は hold でつなぐ。 */
  const [wipe, setWipe] = useState<WipePhase | null>(null);
  const [battleResult, setBattleResult] = useState<{
    state: BattleState;
    movedToTown: string | null;
    drops: string[];
    xp: number;
    saveFailed: boolean;
    /** XP 加算で確定したレベルアップ (非同期に届く) */
    levelUps?: BattleLevelUps;
    /** レベルアップによるステータス上昇 (合算、0.1 未満除外) */
    statGains?: StatGain[];
    /** 敗北ペナルティで落とした素材 */
    materialsLost: string[];
  } | null>(null);
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
    (async () => {
      try {
        const state = await loadWorldState(agent, did);
        if (cancelled) return;
        setWs({ x: state.x, y: state.y, hp: state.hp, mp: state.mp, lastTown: state.lastTown, regions: state.regions });
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
      setFeatherStock(stats?.materials['sky-feather'] ?? 0);
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
  }, [ws === null, battle === null, battleResult === null]);

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
  const battleResultRef = useRef(battleResult);
  battleResultRef.current = battleResult;
  const pointsRef = useRef(points);
  pointsRef.current = points;
  const resolvedGearRef = useRef(resolvedGear);
  resolvedGearRef.current = resolvedGear;
  const diagRef = useRef(diag);
  diagRef.current = diag;
  const wipeRef = useRef(wipe);
  wipeRef.current = wipe;

  const move = useCallback(
    (dir: Dir) => {
      const s = wsRef.current;
      // 戦闘中・リザルト表示中・地図表示中・ワイプ演出中は移動不可。
      // wipe ガードが必要なのは そらのはね帰還が「wipe あり・battle なし」状態を
      // 作るため — キャプチャ済みスティックの interval はイベント非依存で、
      // cover 中も歩けてしまい、テレポート直後に戦闘が開く / featherDestRef が
      // 残留して次のエンカウントをハイジャックする (レビュー指摘)。
      // move() 冒頭で塞ぐことでキーボード・スティック・AT ボタン全経路を一括ガード
      if (!s || battleRef.current || battleResultRef.current || mapOpenRef.current || shopOpenRef.current || gearOpenRef.current || wipeRef.current || onboardingRef.current || statusOpenRef.current || menuOpenRef.current || itemsOpenRef.current || invOpenRef.current) return;
      const { dx, dy } = DIRS[dir];
      const nx = wrap(s.x + dx);
      const ny = wrap(s.y + dy);
      const terrain = terrainAt(nx, ny);
      if (!isWalkable(terrain)) {
        setNotice('そっちには進めない!');
        return; // 位置不変なので保存もしない
      }
      // 街に入ったら全回復 + 「最後に立ち寄った街」を更新 (敗北時の帰還先)
      if (terrain === 'town') {
        const t = townAt(nx, ny);
        // ちずのかけら: 街に入るとその街の地方一帯 (3×3 リージョン) が地図に加わる
        const around = regionsAround(regionOf(nx, ny));
        const gained = around.some((r) => !s.regions.includes(r));
        const regions = gained ? [...new Set([...s.regions, ...around])].sort((a, b) => a - b) : s.regions;
        setNotice(
          t
            ? `「${t.name}」で休んで、すっかり元気になった!${gained ? ' ちずのかけらを 手に入れた!' : ''}`
            : null,
        );
        // wsRef を即時更新 (長押し連打で render 前の tick が同座標から二重計算しないように)
        wsRef.current = { x: nx, y: ny, hp: null, mp: null, lastTown: { x: nx, y: ny }, regions };
        setWs(wsRef.current);
        scheduleSave();
        // かけら入手は離散イベントなのでデバウンスを待たず即時にも保存する
        // (通知を見た直後のリロードで入手が消えない。二重保存は同内容の put で無害)
        if (gained && agent) void saveWorldState(agent, wsRef.current);
        return; // 街では遭遇しない
      }
      setNotice(null);
      wsRef.current = { ...s, x: nx, y: ny };
      setWs(wsRef.current);
      scheduleSave();
      // 野外遭遇 (遭遇判定はプレビュー: Math.random。PR-W3 で Worker の署名付き seed に)。
      // 1 戦 = パワー 1 消費 + 戦闘レコード (試練と同じ機構)。パワー不足なら遭遇しない
      // (= 散歩だけならタダ。無料戦闘で報酬だけ稼げる穴を作らない)。
      const d = diag;
      const pts = pointsRef.current;
      if (!agent || !did || !d || !pts || pts.balance < BATTLE_TUNING.powerCost) return;
      if (Math.random() < encounterRateFor(terrain)) {
        const danger = regionDanger(regionOf(nx, ny));
        const tier = tierForDanger(danger);
        const seed = Math.floor(Math.random() * 0xffffffff) >>> 0;
        const jobLv = jobLevelFromXp(d.jobLevel?.xp ?? 0);
        const playerLv = playerLevelFromXp(d.playerLevel?.xp ?? 0);
        const herbs = Math.min(BATTLE_TUNING.herbCarryMax, herbStock);
        const tonics = Math.min(BATTLE_TUNING.tonicCarryMax, tonicStock);
        const cHp = wsRef.current?.hp;
        const cMp = wsRef.current?.mp;
        const state = startBattle(
          d.archetype,
          jobLv,
          playerLv,
          session.handle?.split('.')[0] ?? 'あなた',
          tier,
          seed,
          herbs,
          // フィールドの現在 HP/MP を引き継ぐ (戦闘をまたいで持続)
          { ...(cHp !== null && cHp !== undefined ? { hp: cHp } : {}), ...(cMp !== null && cMp !== undefined ? { mp: cMp } : {}) },
          {
            tonics,
            ...(d.rpgStats ? { baseStats: statVectorToArray(d.rpgStats) } : {}),
            ...(resolvedGearRef.current ? { gear: resolvedGearRef.current.selection } : {}),
          },
        );
        // 敗北ペナルティの素材ロスを開戦時に確定 (seed から決定的)。持ち込み分の
        // 消耗品は母集団から除外 (herbsUsed/tonicsUsed と二重減算しないように)。
        // 仮レコードに書いておくことで「負けそうになったら閉じる」でもペナルティが効く
        const lossPool = { ...materialsRef.current };
        const subtractPool = (id: string, n: number) => {
          if (!n) return;
          const left = Math.max(0, (lossPool[id] ?? 0) - n);
          if (left > 0) lossPool[id] = left;
          else delete lossPool[id];
        };
        subtractPool('herb', herbs);
        subtractPool('sky-dew', tonics);
        const materialsLost = rollDefeatLoss(lossPool, state.player.luk, seed);
        // 遭遇成立: ワイプ演出でマップを覆いながら支払いを進める (busy = コマンド不可)。
        // battleRef は即時更新して長押し連打の次 tick が移動 + 二重遭遇しないようにする。
        const pending = { state, busy: true, rkey: '', tier, materialsLost };
        battleRef.current = pending;
        setBattle(pending);
        setWipe('cover');
        void (async () => {
          try {
            // 支払い + 仮レコード (途中離脱 = 棄権 = 敗北)。失敗したら遭遇なしに戻す。
            const rkey = await startBattleRecord(agent, { seed, tier, monsterId: state.monsterId, materialsLost, source: 'world' });
            void bumpPower(agent, did, { battles: 1 });
            setPoints((p) => (p ? { ...p, battles: p.battles + 1, balance: p.balance - BATTLE_TUNING.powerCost } : p));
            setBattle((b) => {
              if (!(b && b.state.seed === seed)) return b;
              // battleRef も即時更新 (onCoverDone のタイマーが render flush 前に
              // 発火しても準備完了を読めるように。pending 生成時と同じ流儀)
              const ready = { ...b, rkey, busy: false };
              battleRef.current = ready;
              return ready;
            });
            // 覆い切って待機中 (hold) なら開く。cover 中なら onCoverDone 側が拾う。
            setWipe((w) => (w === 'hold' ? 'reveal' : w));
          } catch (e) {
            console.warn('[world] field battle start failed', e);
            setNotice('モンスターの気配がしたが、見失った… (通信エラー)');
            setBattle((b) => (b && b.state.seed === seed ? null : b));
            // マップに向かって開き直す (注: CSS の都合で「いったん全面黒に跳んでから
            // 開く」見え方になる。稀な経路なので許容 — レビュー確認済み)
            setWipe((w) => (w ? 'reveal' : w));
          }
        })();
      }
    },
    [scheduleSave, diag, session.handle, herbStock, tonicStock, agent, did],
  );

  // 戦闘コマンド (戦闘解決はクライアント。W3/W4 でサーバー権威に置換)
  const onBattleCommand = useCallback(
    async (command: Command) => {
      const b = battleRef.current;
      if (!b || b.busy || !agent || !did) return;
      const next = resolveTurn(b.state, command);
      // battleRef も同期更新 (同一フレームの二重発火が busy=false を二重観測して
      // レコード確定/XP が二重実行される穴を塞ぐ。move() と同じ流儀。レビュー指摘)
      const acting = { ...b, state: next, busy: true };
      battleRef.current = acting;
      setBattle(acting);
      await new Promise((r) => setTimeout(r, 450));
      if (next.outcome === 'ongoing') {
        setBattle((cur) => (cur ? { ...cur, state: next, busy: false } : cur));
        return;
      }
      // 決着: レコード確定 + XP + ドロップ (試練と同じ)。逃走は XP もドロップも無し。
      const drops = next.outcome === 'win' ? rollDrops(next.monsterId, next.player.luk, next.seed) : [];
      const xp = next.outcome === 'win' ? BATTLE_TUNING.xpWin : next.outcome === 'fled' ? 0 : BATTLE_TUNING.xpLose;
      const lost = next.outcome === 'lose' ? b.materialsLost : [];
      const record = {
        seed: next.seed,
        tier: b.tier,
        monsterId: next.monsterId,
        outcome: next.outcome,
        turns: next.turn,
        drops,
        herbsUsed: next.herbsUsed,
        tonicsUsed: next.tonicsUsed,
        materialsLost: lost,
      };
      // 保存は 1 回リトライ。失敗したらリザルトで明示 (仮レコードが敗北のまま残る)。
      let saveFailed = false;
      try {
        await finishBattleRecord(agent, b.rkey, record);
      } catch {
        try {
          await finishBattleRecord(agent, b.rkey, record);
        } catch (e) {
          console.warn('[world] battle finish record failed (after retry)', e);
          saveFailed = true;
        }
      }
      if (xp > 0) {
        void awardBattleXp(agent, did, xp).then((ups) => {
          if (!ups) return;
          // ステータス上昇量は再取得前の diag (レベルアップ前の基準) から計算する
          const d = diagRef.current;
          const base = d?.rpgStats ? statVectorToArray(d.rpgStats) : undefined;
          const arch = d?.archetype;
          const jNow = jobLevelFromXp(d?.jobLevel?.xp ?? 0);
          const pNow = playerLevelFromXp(d?.playerLevel?.xp ?? 0);
          const jFrom = ups.job?.from ?? jNow;
          const jTo = ups.job?.to ?? jNow;
          const pFrom = ups.player?.from ?? pNow;
          const pTo = ups.player?.to ?? pNow;
          // 表示レベル (HP/MP バー分母・次戦の戦闘値) を追従させる。演出だけ出して
          // maxHp が増えないと「LEVEL UP! なのに強くなってない」に見える (レビュー指摘)
          void getRecord<DiagnosisResult>(agent, did, COL.analysis, 'self')
            .then((nd) => { if (nd) setDiag(nd); })
            .catch(() => {});
          // 発火順は投稿フロー (compose-modal) と同じ job → player
          if (ups.job) {
            notifyLevelUp({
              kind: 'job',
              from: ups.job.from,
              to: ups.job.to,
              jobName: jobDisplayName(ups.job.archetype, 'default'),
              ...(arch ? { gains: levelUpGains(arch, { jobLevel: jFrom, playerLevel: pFrom }, { jobLevel: jTo, playerLevel: pFrom }, base) } : {}),
            });
          }
          if (ups.player) {
            notifyLevelUp({
              kind: 'player',
              from: ups.player.from,
              to: ups.player.to,
              ...(arch ? { gains: levelUpGains(arch, { jobLevel: jTo, playerLevel: pFrom }, { jobLevel: jTo, playerLevel: pTo }, base) } : {}),
            });
          }
          // 同じ戦闘のリザルトが出ている間だけ文言も反映 (次の遭遇に紛れ込ませない)
          const statGains = arch
            ? levelUpGains(arch, { jobLevel: jFrom, playerLevel: pFrom }, { jobLevel: jTo, playerLevel: pTo }, base)
            : [];
          setBattleResult((r) => (r && r.state.seed === next.seed ? { ...r, levelUps: ups, statGains } : r));
        });
      }
      // 手持ちを更新: 使った分を引き、ドロップ分を足す。
      // TODO(W3): 在庫の正は Worker (DO) に移す (フィールド使用分が記録されない併走は
      // プレビュー限定の割り切り)。
      const lostOf = (id: string) => lost.filter((x) => x === id).length;
      setHerbStock((n) => Math.max(0, n - next.herbsUsed - lostOf('herb')) + drops.filter((x) => x === 'herb').length);
      setTonicStock((n) => Math.max(0, n - next.tonicsUsed - lostOf('sky-dew')) + drops.filter((x) => x === 'sky-dew').length);
      setFeatherStock((n) => Math.max(0, n - lostOf('sky-feather')) + drops.filter((x) => x === 'sky-feather').length);
      // 素材全体の在庫 (敗北ロス抽選の母集団) も追随
      {
        const m = { ...materialsRef.current };
        for (const d of drops) m[d] = (m[d] ?? 0) + 1;
        const sub = (id: string, n: number) => {
          if (!n) return;
          const left = Math.max(0, (m[id] ?? 0) - n);
          if (left > 0) m[id] = left;
          else delete m[id];
        };
        sub('herb', next.herbsUsed);
        sub('sky-dew', next.tonicsUsed);
        for (const id of lost) sub(id, 1);
        materialsRef.current = m;
      }
      let movedToTown: string | null = null;
      if (next.outcome === 'lose') {
        // 敗北: 最後に立ち寄った街 (無ければはじまりの街) へ。宿で介抱 = 全快。
        // lastTown はワールド再生成で街が動くと無効になりうるので townAt で検証し、
        // 無効なら座標・名前とも spawn に倒す (レビュー指摘)。
        const s = wsRef.current;
        const spawn = worldOverlay().spawn;
        const lt = s?.lastTown;
        const valid = lt && townAt(lt.x, lt.y) ? lt : null;
        const back = valid ?? { x: spawn.x, y: spawn.y };
        movedToTown = townAt(back.x, back.y)?.name ?? spawn.name;
        // 帰還先の街のかけらも入手 (「街に入るとかけら入手」の一貫性 — 移行プレイヤーが
        // spawn へ敗北帰還したとき「介抱された街が地図にない」を防ぐ。レビュー指摘)
        setWs({
          x: back.x,
          y: back.y,
          hp: null,
          mp: null,
          lastTown: valid,
          regions: [...new Set([...(s?.regions ?? []), ...regionsAround(regionOf(back.x, back.y))])].sort((a, b) => a - b),
        });
      } else {
        // 勝利/引き分け/逃走: 減った HP/MP をフィールドに持ち帰る (持続)。
        // 満タンは null に正規化 (絶対値で焼くと後のレベルアップで「減って見える」)。
        const hp = next.player.hp >= next.player.maxHp ? null : Math.max(1, next.player.hp);
        const mp = next.player.mp >= next.player.maxMp ? null : next.player.mp;
        setWs((s) => (s ? { ...s, hp, mp } : s));
      }
      scheduleSave();
      setBattle(null);
      setBattleResult({ state: next, movedToTown, drops, xp, saveFailed, materialsLost: lost });
    },
    [scheduleSave, agent, did],
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
      };
      setWs(wsRef.current);
      scheduleSave();
      setNotice(`そらのはねで「${name}」へ舞いもどった!`);
      setWipe('reveal');
      return;
    }
    const b = battleRef.current;
    setWipe(b && b.rkey === '' && b.busy ? 'hold' : 'reveal');
  }, [scheduleSave]);
  const onRevealDone = useCallback(() => setWipe(null), []);
  // hold の上限 (10s) 到達 = 支払い通信ハング。遭遇をキャンセルしてマップに開き直す
  // (全面黒でリロード以外の脱出手段がなくなるのを防ぐ。レコードが後から成立していた
  // 場合は棄権 = 敗北の既存セマンティクスに落ちる)。
  const onHoldTimeout = useCallback(() => {
    setNotice('通信が不安定でモンスターを見失った…');
    setBattle((b) => (b && b.busy && b.rkey === '' ? null : b));
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

  // そらのはねを使う: 最後に立ち寄った街 (無ければはじまりの街) へ帰還。
  // フィールド専用 (戦闘中はにげるを使う)。消費の保存は TODO(W3) で DO に
  const useFeatherOnField = useCallback(() => {
    if (onboardingRef.current) return;
    if (featherStock <= 0) return;
    const s = wsRef.current;
    // mapOpen / shopOpen も塞ぐ (モーダルの裏へ Tab で抜けて発動でき、店を開いた
    // まま別の街へテレポートすると品揃えが無言で差し替わる — レビュー指摘)
    if (!s || battleRef.current || battleResultRef.current || wipeRef.current || mapOpenRef.current || shopOpenRef.current || gearOpenRef.current || statusOpenRef.current) return;
    const lt = s.lastTown && townAt(s.lastTown.x, s.lastTown.y) ? s.lastTown : null;
    const spawn = worldOverlay().spawn;
    const dest = lt ?? { x: spawn.x, y: spawn.y };
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
  }, [featherStock]);

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

  // ─── 野外遭遇 (戦闘中はマップの代わりにバトル画面)。cover/hold 中はまだマップを
  //     見せたままタイルで覆っていく (覆い切った瞬間にこちらへ切り替わる) ───
  if (battle && (wipe === null || wipe === 'reveal')) {
    const danger = regionDanger(regionOf(ws.x, ws.y));
    return (
      <div style={{ maxWidth: 560, margin: '0 auto' }}>
        {/* 途中離脱 = 敗北の開示はヘッダ側 (低い端末ではコマンド下が fold 落ちする。レビュー指摘) */}
        <h2 style={{ margin: '0 0 0.1em' }}>たたかい! <span style={{ fontSize: '0.6em', color: 'var(--color-muted)' }}>(パワー {BATTLE_TUNING.powerCost} 消費)</span></h2>
        <p style={{ margin: '0 0 0.2em', fontSize: '0.7em', color: 'var(--color-muted)' }}>
          ※ とちゅうでやめる (画面を閉じる) と敗北あつかい。まけると素材を落とすことがあるよ。
        </p>
        <BattleView
          state={battle.state}
          busy={battle.busy}
          onCommand={(c) => void onBattleCommand(c)}
          headerNote={DANGER_LABELS[danger]}
        />
        {wipeOverlay}
      </div>
    );
  }
  if (battleResult) {
    const { state, movedToTown, drops, xp, saveFailed } = battleResult;
    const won = state.outcome === 'win';
    return (
      <div style={{ maxWidth: 560, margin: '0 auto', textAlign: 'center' }}>
        <div style={{ opacity: won ? 0.45 : 1, display: 'inline-block', transform: won ? 'rotate(180deg)' : 'none' }}>
          <MonsterSvg species={MONSTERS_BY_ID[state.monsterId]?.species ?? 'slime'} size={110} />
        </div>
        <h3 style={{ margin: '0.4em 0' }}>
          {won ? '勝利!' : state.outcome === 'lose' ? 'まけてしまった…' : state.outcome === 'fled' ? 'にげだした!' : 'ひきわけ'}
        </h3>
        {state.lastEvents.length > 0 && (
          <div style={{ margin: '0.5em auto', maxWidth: 420, fontSize: '0.8em', lineHeight: 1.6, textAlign: 'left', padding: '0.4em 0.7em', border: '2px solid var(--color-border)', borderRadius: 4, background: 'var(--color-window-bg)' }}>
            {state.lastEvents.map((e, i) => <div key={i}>{e.text}</div>)}
          </div>
        )}
        <div aria-live="polite" style={{ margin: '0.6em 0', fontSize: '0.9em', display: 'flex', flexDirection: 'column', gap: '0.3em' }}>
          {xp > 0 && <div>経験値 +{xp}</div>}
          {battleResult.levelUps?.player && (
            <div style={{ color: 'var(--color-accent)', fontWeight: 700 }}>
              レベルが {battleResult.levelUps.player.to} に あがった!
            </div>
          )}
          {battleResult.levelUps?.job && (
            <div style={{ color: 'var(--color-accent)', fontWeight: 700 }}>
              {jobDisplayName(battleResult.levelUps.job.archetype, 'default')}のジョブレベルが {battleResult.levelUps.job.to} に あがった!
            </div>
          )}
          {battleResult.statGains && battleResult.statGains.length > 0 && (
            <div style={{ fontSize: '0.85em', color: 'var(--color-muted)' }}>
              {battleResult.statGains.map((g) => `${g.label} +${formatGain(g.delta)}`).join('、')}
            </div>
          )}
          {drops.length > 0 && (
            <div>素材を手に入れた: {drops.map((d) => ITEMS[d]?.name ?? d).join('、')}</div>
          )}
          {saveFailed && (
            <div style={{ color: 'var(--color-danger)', fontSize: '0.85em' }}>
              ※ 結果の保存に失敗した (通信エラー)。この 1 戦は記録上「敗北」のまま残り、
              素材を落とした扱いになることがある。電波のよい場所で開き直すと在庫に反映される。
            </div>
          )}
        </div>
        {battleResult.materialsLost.length > 0 && (
          <div style={{ margin: '0.3em 0', fontSize: '0.9em', color: 'var(--color-danger)' }}>
            たおれたひょうしに 素材を落としてしまった…: {(() => {
              const counts = new Map<string, number>();
              for (const d of battleResult.materialsLost) counts.set(d, (counts.get(d) ?? 0) + 1);
              return [...counts.entries()].map(([d, n]) => `${ITEMS[d]?.name ?? d}${n > 1 ? ` ×${n}` : ''}`).join('、');
            })()}
          </div>
        )}
        {state.outcome === 'fled' && (
          <p style={{ fontSize: '0.85em', color: 'var(--color-muted)' }}>
            なにも手に入らなかったが、ぶじに逃げのびた。(つかったパワーは戻らない)
          </p>
        )}
        {movedToTown && (
          <p style={{ fontSize: '0.85em' }}>気がつくと「{movedToTown}」で介抱されていた… (全回復)</p>
        )}
        <button type="button" onClick={() => setBattleResult(null)} style={{ padding: '0.7em 1.6em' }}>
          マップへ戻る
        </button>
        {/* reveal 中に決着した場合でも演出を最後まで流す (無いと wipe='reveal' が
            残留してマップ復帰時に再生される。レビュー指摘) */}
        {wipeOverlay}
      </div>
    );
  }

  const town = townAt(ws.x, ws.y);
  const here = terrainAt(ws.x, ws.y);
  const danger = regionDanger(regionOf(ws.x, ws.y));

  // 自分タップで開く DQ 風コマンド。街にいるときだけ「なんでも屋」を足す。
  // 参照を安定させる (メニューは開いている間だけマウントされるが、将来キーボード
  // ナビ等を足すときに毎レンダー別関数だと地雷 — レビュー ★★)
  const inTown = !!town;
  const statusReady = !!combat && !!archetype;
  const menuCommands: WorldMenuCommand[] = useMemo(
    () => [
      // 並び順は「しらべる」(次 PR) を どうぐ の後に差し込む前提で固定 (筋肉記憶を裏切らない)
      { key: 'items', label: 'どうぐ', onSelect: () => setItemsOpen(true) },
      { key: 'gear', label: 'そうび', onSelect: () => setGearOpen(true) },
      { key: 'map', label: 'ちず', onSelect: () => setMapOpen(true) },
      { key: 'inventory', label: 'もちもの', onSelect: () => setInvOpen(true) },
      // 使えないコマンドはグレーで残さず消す (なんでも屋と同じポリシー — レビュー ★★)
      ...(statusReady ? [{ key: 'status', label: 'つよさ', onSelect: () => setStatusOpen(true) } as WorldMenuCommand] : []),
      ...(inTown
        ? [{ key: 'shop', label: 'なんでも屋', onSelect: () => { setLastShopAction(null); setMaterialsView({ ...materialsRef.current }); setShopOpen(true); } } as WorldMenuCommand]
        : []),
    ],
    [inTown, statusReady],
  );

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
              if (wipeRef.current || battleRef.current || battleResultRef.current) return;
              dismissMenuHint();
              setMenuOpen(true);
            }}
          />
          {combat && curHp !== null && curMp !== null && (
            <WorldHud
              hp={curHp}
              maxHp={combat.maxHp}
              mp={curMp}
              maxMp={combat.maxMp}
              locationLabel={town ? `🏘 ${town.name}` : `このあたり: ${DANGER_LABELS[danger]}${here === 'forest' ? ' / 深い森…' : ''}`}
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
        </div>
      </div>

      {/* コマンドは「自分をタップ」で開く DQ 風メニューに集約した (どうぐ列を廃止 —
          縦スクロールを減らして没入感を上げる。オーナー要望 2026-07-18)。下の一言は
          初見の操作手掛かり */}
      <p style={{ textAlign: 'center', fontSize: '0.72em', color: 'var(--color-muted)', margin: '0.4em 0 0' }}>
        じぶんを タップすると コマンドが ひらくよ。
      </p>
      {/* 一時メッセージ (やくそう使用 / 進めない / 街で回復 など)。操作した指の
          すぐ近くに出す。minHeight 常設で出現時のレイアウトシフトを防ぐ */}
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
