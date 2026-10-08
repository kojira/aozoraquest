import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { DiagnosisResult } from '@aozoraquest/core';
import {
  tierForRegion,
  BATTLE_TUNING,
  canSeeEnemyVitals,
  favoredMonsterFor,
  jobLevelFromXp,
  playerCombatant,
  playerLevelFromXp,
  regionAffinity,
  regionOf,
  SEARCH_TUNING,
  statVectorToArray,
  terrainAt,
  townAt,
  worldOverlay,
  interiorById,
  interiorShopAt,
  interiorTerrainAt,
} from '@aozoraquest/core';
import { useSession } from '@/lib/session';
import { useJobXp, xpOfJob } from '@/lib/use-job-xp';
import { saveWorldState } from '@/lib/world-state';
import { serverGear, worldServerEnabled, type ScenarioMessage } from '@/lib/world-server';
import { ShopModal } from '@/components/shop-modal';
import { GearModal } from '@/components/gear-modal';
import { resolveGear } from '@/lib/gear';
import { useWorldScroll, type WorldScrollStep } from '@/lib/use-world-scroll';
import { WORLD_PREVIEW_ENABLED } from '@/lib/world-preview';
import { Avatar } from '@/components/avatar';
import { WorldBattleControls } from '@/components/world-battle-controls';
import { EncounterWipe, type WipePhase } from '@/components/encounter-wipe';
import { DoorFade, type DoorFadePhase } from '@/components/door-fade';
import { VirtualStick } from '@/components/virtual-stick';
import { WorldMapModal } from '@/components/world-map-modal';
import { DialogueWindow } from '@/components/dialogue-window';
import { npcDialogueLines } from '@/lib/npc-image';
import { StatusModal } from '@/components/status-modal';
import { WorldHud, HUD_Z, OVERLAY_Z } from '@/components/world-hud';
import { WorldMenu, type WorldMenuCommand } from '@/components/world-menu';
import { ItemsModal, InventoryModal } from '@/components/world-item-modals';
import { FeatherModal } from '@/components/feather-modal';
import { WelcomeBlessingOverlay, notifyWelcome } from '@/components/welcome-blessing';
import { WELCOME_POWER, ONBOARDING_DONE_KEY } from '@/lib/onboarding-reset';
import { questMenuLines } from '@/lib/game-quest';
import { guildReception } from '@/lib/npc-talk';
import { guildMetKey, npcTalkPortrait } from '@/lib/guild-greeting';
import { useLatestRef } from '@/lib/use-latest-ref';
import { useWorldInventory } from '@/lib/use-world-inventory';
import { useNpcQuestTalk } from '@/lib/use-npc-quest-talk';
import { useWorldShop } from '@/lib/use-world-shop';
import { useWorldBattle } from '@/lib/use-world-battle';
import { useWorldMove } from '@/lib/use-world-move';
import { useWorldFieldItems } from '@/lib/use-world-field-items';
import { useWorldLoad } from '@/lib/use-world-load';
import { WorldMapLayer } from '@/components/world-map-layer';
import { WorldMenuHint } from '@/components/world-menu-hint';
import { GUILD_INVITATION, ONBOARDING_LINES, ONBOARDING_PORTRAIT, OPENING_GUIDE_LINES, PROLOGUE_LINES, starterHandoffLines } from '@/lib/world-opening';
import { HALF, MENU_HINT_DONE_KEY, TILE, VIEW, dangerLabel, type Dir, type Vitals } from '@/lib/world-view';

/**
 * あおぞらワールド (docs/19-overworld.md) — 散歩 + 遭遇プレビュー。
 *
 * - 16×16 ビューポート、1 タップ 1 マス、トーラス wrap。
 * - **HP/MP は戦闘をまたいで持続**。街に立ち寄ると全回復 + その街が
 *   「最後に立ち寄った街」= 敗北時の帰還先になる。フィールドでどうぐを使える。
 * - 野外戦闘は試練と同じ機構で **1 戦 = パワー 1 消費 + 戦闘レコード + XP/素材の報酬**
 *   (パワー不足だと遭遇しない = 散歩だけならタダ)。遭遇判定自体はまだプレビュー
 *   (Math.random)。PR-W3 で移動ごと Worker (署名付き seed) に置換。dev 環境限定。
 *
 * 責務ごとの分割: 移動 (use-world-move) / NPC 会話とクエスト (use-npc-quest-talk) /
 * 戦闘 (use-world-battle) / なんでも屋とそうび (use-world-shop) / どうぐ・しらべる
 * (use-world-field-items) / 初期ロード (use-world-load) / マップ描画 (world-map-layer)。
 */

export function World() {
  const session = useSession();
  const agent = session.agent ?? null;
  const did = session.did ?? null;
  const [ws, setWs] = useState<Vitals | null>(null);
  const [scrollStep, setScrollStep] = useState<WorldScrollStep | null>(null);
  const { layerRef: scrollLayerRef, padding: scrollPadding } = useWorldScroll(ws, scrollStep);
  const [loadErr, setLoadErr] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);
  const [notice, setNotice] = useState<string | null>(null); // 進めない/回復などの一行メッセージ
  // 地図入手は次の歩行で消える notice に置かず、読了まで表示する。
  const [mapAcquisition, setMapAcquisition] = useState<string | null>(null);
  const mapAcquisitionRef = useRef(false);
  const waitForFreshDirectionRef = useRef(false);
  const guildExitBlockedRef = useRef(false);
  /** 進行フラグ (#545)。**サーバーが正** — 立てるのは edge だけで、ここは表示用の写し。 */
  const flagsRef = useRef<string[]>([]);
  /** 戦闘中に届いたシナリオのお知らせ (#545)。戦闘の窓は使えないので、
   *  リザルトを閉じてマップに戻ってから出す。 */
  const pendingNoticesRef = useRef<ScenarioMessage[]>([]);
  /** 溜まったシナリオのお知らせをマップの窓で出す。**戦闘を閉じた直後に呼ぶ** —
   *  戦闘中に出しても窓が描画されず、発火済みのお知らせは二度と返らないので消える。 */
  const flushScenarioNotices = useCallback(() => {
    const list = pendingNoticesRef.current;
    if (list.length === 0) return;
    pendingNoticesRef.current = [];
    setScenarioTalk(list);
  }, []);
  /** シナリオのお知らせ窓 (話者なしの地の文)。 */
  const [scenarioTalk, setScenarioTalk] = useState<ScenarioMessage[] | null>(null);
  const [onboarding, setOnboarding] = useState(false);
  const onboardingRef = useRef(false);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [playerName, setPlayerName] = useState('');
  // **ジョブ XP は権威 state 由来** (#534)。analysis.jobLevel.xp は凍結済みなので読まない。
  // **共有キャッシュ (use-job-xp) を使う** — ここだけ独自 state を持つと、戦闘で上げた直後に
  // /me を開いたとき戦闘前の LV が出る (SPA なので module キャッシュはリロードまで残る)。
  const { jobXp: serverJobXp } = useJobXp();
  // **権威 state のパワー残高**。報酬の可否 (rewarded) はこの値で決まるので、
  // client 側の points (PDS の viaPosts 由来) ではなくこちらを表示する。
  // 両者がずれていると「画面には残っているのに報酬が出ない」という見えない失敗になる。
  const [serverPower, setServerPower] = useState<number | null>(null);
  // **deps の狭い callback から読むための ref。** searchHere / onCraft は deps に
  // serverPower を入れていないので、直接参照すると初回生成時の null を掴んだままになる
  // (この形の退行を実際に出した — 「パワーが たりない」が一度も出ず常に通信エラーになった)。
  const serverPowerRef = useLatestRef(serverPower);
  const [statusOpen, setStatusOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
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
  const [featherOpen, setFeatherOpen] = useState(false);
  const [showStarter, setShowStarter] = useState(false);
  // リセット (= 実際に +20 を付与した経路) からの入場か。祝福セリフ/演出の有無を実付与と
  // 一致させるための旗。入場時に sessionStorage マークから確定する。
  const [starterBlessed, setStarterBlessed] = useState(false);
  const [diag, setDiag] = useState<DiagnosisResult | null>(null);
  const inventory = useWorldInventory();
  const { herbStock, tonicStock, featherStock, materialsRef, materialsView } = inventory;
  /** エンカウント演出 (DQ1 風ワイプ)。cover 中はマップの上でタイルが閉じ、覆い切ったら
   *  バトル画面に差し替えて reveal で開く。支払い通信が長い場合は hold でつなぐ。 */
  const [wipe, setWipe] = useState<WipePhase | null>(null);
  /** 街の出入りの演出 (#626)。戦闘の渦巻きとは別の、白い光のフェード。 */
  const [doorFade, setDoorFade] = useState<DoorFadePhase | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mapRef = useRef<HTMLDivElement>(null);
  const [tilePx, setTilePx] = useState(24);
  const [mapOpen, setMapOpen] = useState(false);
  /** 移動中フラグ。移動は毎回サーバー往復するので、連打で並行 serverMove が飛ばないよう塞ぐ。 */
  const moveBusyRef = useRef(false);
  // サーバー権威の位置トークン (署名済み)。毎歩これを渡し、新トークンを受け取る。初回は undefined
  // (サーバーが gameState から再同期する)。位置はトークンが権威なので歩行では PDS を触らない = 高速。
  const tokenRef = useRef<string | undefined>(undefined);
  const wsRef = useLatestRef(ws);
  // 決着コールバックは deps が狭いので、archetype / did は ref 経由で最新を読む (上記の理由)。
  const archetype = diag?.archetype ?? null;
  const archetypeRef = useLatestRef<string | null>(archetype);
  const didRef = useLatestRef<string | null>(did);
  /** 制作の記帳に残す luk。combat (装備込み) から下で毎レンダー更新する。 */
  const lukRef = useRef(0);

  // 状態保存 (2 秒デバウンス + unmount 時に確定)
  const scheduleSave = useCallback(() => {
    if (!agent) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveTimer.current = null;
      const s = wsRef.current;
      if (s) void saveWorldState(agent, s);
    }, 2000);
  }, [agent, wsRef]);

  const talk = useNpcQuestTalk({
    agent, moveBusyRef, tokenRef, flagsRef, materialsRef, applyServerMaterials: inventory.applyServerMaterials,
    setServerPower, setNotice, waitForFreshDirectionRef,
  });
  const { npcTalk, setNpcTalk, npcTalkRef, quest, setQuest, questPending, npcChoices, openDirectNpc, directQuestList } = talk;
  const shop = useWorldShop({ agent, did, inventory, lukRef, serverPowerRef, setServerPower, tokenRef, wsRef, setNotice });
  const { shopOpen, setShopOpen, gearOpen, setGearOpen, craftedPieces, setCraftedPieces, gearRefs, setGearRefs, craftBusy, shopError, flushCraftLog } = shop;

  // ジョブ/レベル由来の最大値 (フィールド HP/MP バーの分母)
  const resolvedGear = archetype ? resolveGear(gearRefs, craftedPieces, archetype) : null;
  // 装備をサーバーにミラー (戦闘に反映 #377)。解決結果が変わるたび送る = 初回ロード + 装備変更を一括カバー。
  // 参照でなく内容キーで発火 (resolveGear は毎回新オブジェクトを返すため)。
  const gearKey = JSON.stringify(resolvedGear?.selection ?? null);

  useEffect(() => {
    if (!agent || !worldServerEnabled || gearKey === 'null') return;
    void serverGear(agent, JSON.parse(gearKey)).catch((e) => console.warn('[world] gear sync failed', e));
  }, [agent, gearKey]);
  // combat (装備込み) と combatBase (装備なし) は gear 引数だけが違う。base 引数を
  // 共有タプルにして「そうび +N = combat − combatBase」の不変条件を構造的に守る
  // (5 行コピペだと片方の base 導出変更で内訳が黙って壊れる — レビュー ★★)
  // 権威 state の XP がまだ読めていないうちは combat を作らない (#534)。
  // 0 に丸めて Lv1 の HP/MP を出すと、通信断が「レベルが戻された」に見えるうえ、
  // curHp が Lv1 の maxHp で頭打ちになって HP バーまで削れて見える。
  const hereJobXp = xpOfJob(serverJobXp, archetype);
  const baseArgs = archetype && hereJobXp !== null
    ? ([
        archetype,
        jobLevelFromXp(hereJobXp, archetype),
        playerLevelFromXp(diag?.playerLevel?.xp ?? 0),
        '',
        diag?.rpgStats ? statVectorToArray(diag.rpgStats) : undefined,
      ] as const)
    : null;
  const combat = baseArgs ? playerCombatant(...baseArgs, undefined, resolvedGear?.selection) : null;
  lukRef.current = combat?.luk ?? 0;
  // 装備なしの素の値 (つよさ画面の「そうび +N」内訳用)。つよさ画面を開いた時だけ
  // 計算する (World は移動/HP バー更新で頻繁に再レンダーする — レビュー ★)
  const combatBase = useMemo(
    () => (statusOpen && baseArgs ? playerCombatant(...baseArgs) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- baseArgs は下記 diag/archetype で代表
    [statusOpen, archetype, hereJobXp, diag?.playerLevel?.xp, diag?.rpgStats],
  );
  const curHp = combat ? Math.min(ws?.hp ?? combat.maxHp, combat.maxHp) : null;
  const curMp = combat ? Math.min(ws?.mp ?? combat.maxMp, combat.maxMp) : null;

  useWorldLoad({
    sessionStatus: session.status, agent, did, retryNonce, setLoadErr, setServerPower, setQuest, flagsRef, tokenRef,
    setCraftedPieces, setGearRefs, setWs, setStarterBlessed, setShowStarter, setOnboarding, onboardingRef, setNotice,
    setAvatarUrl, setPlayerName, setDiag, inventory, flushCraftLog,
  });

  const { battle, battleRef, setBattle, onBattleCommand, onMessageAdvance } = useWorldBattle({
    agent, setQuest, flagsRef, pendingNoticesRef, flushScenarioNotices, tokenRef, setWs, setNotice, scheduleSave,
    inventory, setServerPower, archetypeRef, didRef,
  });

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

  useEffect(() => () => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      const s = wsRef.current;
      if (agent && s) void saveWorldState(agent, s);
    }
  }, [agent, wsRef]);

  const wipeRef = useLatestRef(wipe);
  /** 入力ガード用に、開いている窓・演出の最新値を 1 つの ref で読む (deps の狭い callback から)。 */
  const overlaysRef = useLatestRef({ mapOpen, shopOpen, gearOpen, statusOpen, menuOpen, itemsOpen, invOpen, searchMsg, featherOpen, showStarter });
  // 戦闘中・リザルト表示中・地図表示中・ワイプ演出中・各窓・会話・サーバー往復中は移動不可。
  const moveBlocked = useCallback(() => {
    const o = overlaysRef.current;
    return !!battleRef.current || o.mapOpen || o.shopOpen || o.gearOpen || !!wipeRef.current || onboardingRef.current || o.statusOpen || o.menuOpen || o.itemsOpen || o.invOpen || o.searchMsg !== null || o.featherOpen || o.showStarter
      || moveBusyRef.current || !!npcTalkRef.current || mapAcquisitionRef.current; // 直前の移動がサーバー往復中 (トークン連鎖を直列化)
  }, [battleRef, npcTalkRef, overlaysRef, wipeRef]);
  // そらのはねの行き先えらび: 導入中・戦闘・演出・地図/店/そうび/つよさの窓では開かない。
  const featherBlocked = useCallback(() => {
    const o = overlaysRef.current;
    return onboardingRef.current || !!battleRef.current || !!wipeRef.current || o.mapOpen || o.shopOpen || o.gearOpen || o.statusOpen;
  }, [battleRef, overlaysRef, wipeRef]);

  const move = useWorldMove({
    agent, did, wsRef, setWs, setScrollStep, inputBlocked: moveBlocked, moveBusyRef, tokenRef, flagsRef, materialsRef,
    guildExitBlockedRef, mapAcquisitionRef, waitForFreshDirectionRef, battleRef, setBattle, setWipe, setDoorFade, setNotice,
    setMapAcquisition, setServerPower, setNpcTalk, openDirectNpc, resetShopView: shop.resetShopView, setShopOpen, scheduleSave,
  });
  const { onCoverDone, onRevealDone, onHoldTimeout, useHerbOnField, useTonicOnField, useFeatherOnField, flyToTown, searchHere } = useWorldFieldItems({
    agent, did, combat, inventory, wsRef, setWs, setNotice, scheduleSave, moveBusyRef, tokenRef, flagsRef, pendingNoticesRef, serverPowerRef, setServerPower,
    setSearchMsg, setFeatherOpen, setWipe, fieldItemBlocked: featherBlocked,
  });

  // オンボード用リセットは**設定画面**へ移設した (地図メニューから消し、新規と同じ
  // 「イントロ→手渡し→祝福」導入を辿れるようにするため)。
  // world 側は再入場時にマーク/フラグを読むだけ (WELCOME_BLESSING_PENDING_KEY / ONBOARDING_DONE_KEY)。

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
        // 入手前から押しっぱなしのキーは、読了後も新しい押下まで再開しない。
        if (mapAcquisitionRef.current || (waitForFreshDirectionRef.current && e.repeat)) return;
        waitForFreshDirectionRef.current = false;
        move(dir);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [move, battleRef, wipeRef, wsRef]);


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

  // 戦闘はページ遷移せず「暗転したマップ枠内」で行う。
  // シーン (敵+ログ) はマップ上オーバーレイ、コマンド/リザルトはマップ下に出す。
  const inBattle = battle !== null && (wipe === null || wipe === 'reveal');

  const insideHere = ws.mapId ? interiorById(ws.mapId) ?? null : null;
  // 内部では**フィールドの街表を引かない** — 内部座標がたまたま街と重なると、
  // 街の HUD が出て「なんでも屋」が生えるのにサーバーは回復しない、という食い違いになる。
  // ただし**村の中のなんでも屋の扉**に立っているときは、その店の街として扱う (#424)。
  const innerShop = insideHere ? interiorShopAt(insideHere.id, ws.x, ws.y) : undefined;
  const town = insideHere
    ? (innerShop ? townAt(innerShop.town.x, innerShop.town.y) : null)
    : townAt(ws.x, ws.y);
  const here = insideHere ? interiorTerrainAt(insideHere, ws.x, ws.y) : terrainAt(ws.x, ws.y);
  // 地域相性: この地方で出やすいモンスター名を現地ヒントにする (相性が見えない導線対策)
  // 「このあたり」の見出しと「何が多いか」は同じ tier を見る (ラベルと中身が食い違わないように)。
  // 内部マップ (#424) の座標はローカル系なので、地域から引く危険度・敵は意味を持たない
  // (常に region 0 になる)。内部では自分の危険度設定を使い、未設定なら「敵なし」。
  const hereTier = insideHere ? ((insideHere.encounterTier ?? 1) as ReturnType<typeof tierForRegion>) : tierForRegion(regionOf(ws.x, ws.y));
  const favoredMonsterName = favoredMonsterFor(hereTier, regionAffinity(regionOf(ws.x, ws.y))).name;

  // 自分タップで開く DQ 風コマンド。街にいるときだけ「なんでも屋」を足す。
  // **フックは使わない** (この行は早期 return より後にあるので useMemo だと
  // フック数が可変になり React error #310 でクラッシュする — 2026-07-18 事故)。
  // 毎レンダー生成でも、メニューは開いている間だけマウントされるので実害は無い。
  const inTown = !!town;
  const statusReady = !!combat && !!archetype;
  const menuCommands: WorldMenuCommand[] = [
    { key: 'items', label: 'どうぐ', onSelect: () => setItemsOpen(true) },
    // しらべるは街の外だけ (街=安全地帯で地方素材は出ない)。コストをラベルに明記
    ...(inTown ? [] : [{ key: 'search', label: `しらべる (パワー${SEARCH_TUNING.powerCost})`, onSelect: () => void searchHere() } as WorldMenuCommand]),
    { key: 'gear', label: 'そうび', onSelect: () => setGearOpen(true) },
    // ちずは世界地図なので内部では出さない (#613)。内部の座標を世界地図に重ねると
    // 現在地マーカーが region 0 (左上) に出る誤表示になる。
    ...(insideHere ? [] : [{ key: 'map', label: 'ちず', onSelect: () => setMapOpen(true) } as WorldMenuCommand]),
    { key: 'inventory', label: 'もちもの', onSelect: () => setInvOpen(true) },
    // 使えないコマンドはグレーで残さず消す (なんでも屋と同じポリシー — レビュー ★★)
    ...(statusReady ? [{ key: 'status', label: 'つよさ', onSelect: () => setStatusOpen(true) } as WorldMenuCommand] : []),
    ...(inTown
      ? [{ key: 'shop', label: 'なんでも屋', onSelect: shop.openShopFromMenu } as WorldMenuCommand]
      : []),
    // 「はじめから (管理)」は設定画面へ移設 (新規と同じ導入を辿らせるため)。ここには出さない。
  ];

  const avatarSize = Math.max(16, Math.round(tilePx * 1.15));

  return (
    <div style={{ maxWidth: 560, margin: '0 auto' }}>
      {/* HUD (HP/MP + 現在地) はマップ上にオーバーレイ表示する — 縦スクロールを
          なくして没入感を上げるため。マップ外に置いて
          いた HP/MP バー・場所ヘッダーは廃止し、下記 WorldHud に集約した。 */}
      <div className="dq-window" style={{ padding: 4 }}>
        <div ref={mapRef} style={{ position: 'relative' }}>
          <svg
            viewBox={`0 0 ${VIEW * TILE} ${VIEW * TILE}`}
            style={{ display: 'block', width: '100%', overflow: 'hidden' }}
            aria-label="ワールドマップ"
          >
            <g ref={scrollLayerRef} data-world-scroll data-world-x={ws.x} data-world-y={ws.y}>
              <WorldMapLayer at={ws} scrollPadding={scrollPadding} />
            </g>
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
              (十字キーはスマホで非常に操作しづらい) */}
          {/* 入手中はunmountして押しっぱなしの反復/捕捉ポインタを破棄する。 */}
          {mapAcquisition === null && <VirtualStick
            onMove={move}
            onTapSelf={() => {
              // 演出中・戦闘中はメニューを開かない。他オーバーレイ (menu/items/inv/
              // map/shop/gear/status) 中はそもそもスティックがそれらの背面シートで
              // 遮断されタップが届かないので、ここでは wipe/battle だけ見れば足りる
              // 導入/手渡し/受付中はキーボード経由の自己タップも遮断する。
              if (wipeRef.current || battleRef.current || mapAcquisitionRef.current || onboardingRef.current || overlaysRef.current.showStarter || npcTalkRef.current) return;
              dismissMenuHint();
              setMenuOpen(true);
            }}
          />}
          {combat && curHp !== null && curMp !== null && (
            <WorldHud
              // 戦闘中は上枠 HP/MP を「戦闘中の実 HP/MP」(battle.state.player) に追従させる。
              // ws.hp/ws.mp は戦闘終了時にしか更新されないので、それを見ると結果画面まで
              // 減らないバグになる。フィールドでは ws 由来。
              hp={battle ? battle.state.player.hp : curHp}
              maxHp={battle ? battle.state.player.maxHp : combat.maxHp}
              mp={battle ? battle.state.player.mp : curMp}
              power={serverPower}
              maxMp={battle ? battle.state.player.maxMp : combat.maxMp}
              locationLabel={
                // 内部では**そのマップの名前**を出す (どこに居るか分かる唯一の手掛かり)。
                // 敵が出ない内部 (街の中・広間) では危険度も敵名も出さない。
                insideHere
                  ? `🚪 ${insideHere.name}${insideHere.encounterTier !== undefined ? ` / ${dangerLabel(hereTier)}` : ''}`
                  : town ? `🏘 ${town.name}` : `${dangerLabel(hereTier)}${here === 'forest' ? '・深い森' : ''} / ${favoredMonsterName}`
              }
              // 戦闘/リザルト中は HP/MP を暗転オーバーレイより上に出して上枠で鮮明に
              // 見せる (下段の重複バーは廃止し上枠へ一本化)。
              // 値は phase を問わず battle 優先 (上記)、レイヤー (z) だけ wipe を見る
              // inBattle を使う — wipe='cover' の一瞬は値=battle 由来 / z=HUD_Z で意図的に非対称。
              zIndex={inBattle ? OVERLAY_Z + 1 : HUD_Z}
            />
          )}
          {menuHint && !onboarding && !showStarter && !menuOpen && <WorldMenuHint />}
          {menuOpen && <WorldMenu commands={menuCommands} questLines={questMenuLines(quest, materialsView)} onClose={() => setMenuOpen(false)} />}
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
          {/* 会話ウィンドウは**地図枠内**にオーバーレイする (DQ 風。以前は画面下端の footer 際に
              出て「マップ上」に見えなかった)。anchor="map" で、この
              position:relative の地図枠の下部に貼る。一度に出るのは 1 つ (相互にガード)。
              会話は z が戦闘オーバーレイ (OVERLAY_Z) より上なので、状態機械のガードに加えて
              !battle でも囲い、万一の同時表示で戦闘操作が塞がれる事故を防ぐ (レビュー ★★)。 */}
          {!battle && mapAcquisition !== null && !onboarding && (
            <DialogueWindow
              anchor="map"
              lines={[{ text: mapAcquisition }]}
              onDone={() => { mapAcquisitionRef.current = false; setMapAcquisition(null); }}
            />
          )}
          {!battle && npcTalk && !onboarding && mapAcquisition === null && (
            <DialogueWindow
              // 段ごとに作り直さない (D-DIALOGUE-004)。setNpcTalk の新しい段で行・選択を数え直す。
              conversationStep={npcTalk}
              anchor="map"
              // 先頭の表情タグは外し、登録済みの表情画像だけ行ごとに出す (D-DIALOGUE-005)。
              lines={[...npcDialogueLines(npcTalk.npc, npcTalk.lines), ...(npcTalk.notices ?? [])]}
              portrait={npcTalkPortrait(npcTalk.npc, !!npcTalk.guild)}
              // 依頼は「うけますか？」に はい と答えたときだけ受注する (#659)。いいえ は閉じるだけで、
              // また話せば聞ける。受注もサーバーが正。
              busy={questPending}
              choices={npcChoices}
              onDone={() => {
                if (npcTalk.guild) {
                  try { localStorage.setItem(guildMetKey(did, npcTalk.npc.id), '1'); } catch { /* private mode */ }
                  // 選択肢が次の窓へ進めた場合、古い窓のonDoneで上書きしない。
                  setNpcTalk(current => current === npcTalk ? guildReception(npcTalk.npc) : current);
                } else if (npcTalk.directList && npcTalkRef.current === npcTalk) directQuestList(npcTalk.npc);
                else setNpcTalk(current => current === npcTalk ? null : current);
              }}
            />
          )}
          {doorFade && <DoorFade phase={doorFade} onDone={() => setDoorFade(null)} />}
          {!battle && scenarioTalk && !npcTalk && !onboarding && mapAcquisition === null && (
            <DialogueWindow
              anchor="map"
              lines={scenarioTalk}
              onDone={() => setScenarioTalk(null)}
            />
          )}
          {!battle && onboarding && (
            <DialogueWindow
              anchor="map"
              lines={showStarter ? [...PROLOGUE_LINES, ...ONBOARDING_LINES] : [...PROLOGUE_LINES, ...ONBOARDING_LINES, GUILD_INVITATION, ...OPENING_GUIDE_LINES]}
              onDone={() => {
                setOnboarding(false);
                onboardingRef.current = false;
                try { localStorage.setItem(ONBOARDING_DONE_KEY, '1'); } catch { /* private mode */ }
              }}
            />
          )}
          {!battle && showStarter && !onboarding && (
            // 導入に続けて Blueskyちゃんが やくそう と そらのはね を手渡す (#703。以前はブルスコンが
            // 話していて、導入の話者と混ざって混乱した)。リセット (実 +20 付与) 経由のときだけ
            // 祝福のセリフを足し、読み終えた瞬間に祝福演出を出す。starterBlessed は入場時にマークから確定済み。
            <DialogueWindow
              anchor="map"
              lines={starterHandoffLines(starterBlessed)}
              portrait={ONBOARDING_PORTRAIT}
              onDone={() => { setShowStarter(false); if (starterBlessed) notifyWelcome({ power: WELCOME_POWER }); }}
            />
          )}
          {!battle && searchMsg !== null && (
            <DialogueWindow anchor="map" lines={[{ text: searchMsg }]} onDone={() => { setSearchMsg(null); flushScenarioNotices(); }} />
          )}
        </div>
      </div>

      {/* マップ下: 戦闘/リザルトはマップ枠内で完結するので何も出さない (縦スクロール
          をなくす)。通常時のみ操作ヒント。 */}
      {!inBattle && !onboarding && !showStarter && !npcTalk && (
        <p style={{ textAlign: 'center', fontSize: '0.72em', color: 'var(--color-muted)', margin: '0.4em 0 0' }}>
          じぶんを タップすると コマンドが ひらくよ。
        </p>
      )}
      {/* 一時メッセージ + 操作説明は戦闘/リザルト中は隠す (マップ枠内で完結・
          縦スクロールをなくす) */}
      {!inBattle && !onboarding && !showStarter && !npcTalk && (
        <>
          <p
            aria-live="polite"
            style={{ textAlign: 'center', fontSize: '0.85em', minHeight: '1.6em', margin: '0.5em 0 0' }}
          >
            {notice && <strong style={{ color: 'var(--color-fg)' }}>{notice}</strong>}
          </p>
          <p style={{ textAlign: 'center', fontSize: '0.72em', color: 'var(--color-muted)', marginTop: '0.4em' }}>
            マップをタッチしたまま指を動かすと移動 (PC は矢印キーも可)。やどやで パワーを はらうと 全回復。
            {/* **残高は HUD の P だけに出す。** ここに client 台帳 (points) の数字を併記すると、
                権威側と食い違ったときに同じ画面に別々の残高が並ぶ (実際に「P 0」の 3cm 下に
                「いまのパワー: 152」が出ていた)。遭遇判定はサーバーが権威 power で行うので、
                client 台帳を根拠に「モンスターは出ません」と書くのも嘘になる。 */}
            {diag
              ? serverPower === null
                ? ' パワー残高を読み込めなかった (通信を確認して開き直して)。'
                : serverPower < BATTLE_TUNING.powerCost
                  ? ' あおぞらパワーが ないので、勝っても経験値・素材・依頼の進みは 得られません。とうこうしたくなったら ひとやすみしよう。'
                  : ` 歩くとモンスターが出ることがあります (1 戦 = あおぞらパワー ${BATTLE_TUNING.powerCost}、勝つと経験値と素材)。`
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
          jobLv={jobLevelFromXp(hereJobXp ?? 0, archetype)}
          jobXp={hereJobXp ?? 0}
          combat={combat}
          combatBase={combatBase}
          hp={curHp}
          mp={curMp}
          gearPieces={resolvedGear?.pieces ?? {}}
          onClose={() => setStatusOpen(false)}
        />
      )}
      {gearOpen && (
        <GearModal
          archetype={archetype}
          pieces={craftedPieces}
          refs={gearRefs}
          busy={craftBusy}
          errorText={shopError}
          onDiscard={shop.onDiscard}
          onEquip={shop.onEquip}
          onUnequip={shop.onUnequip}
          onClose={() => setGearOpen(false)}
        />
      )}
      {shopOpen && town && mapAcquisition === null && (
        <ShopModal
          town={town}
          townIndex={Math.max(0, worldOverlay().towns.findIndex((t) => t.x === town.x && t.y === town.y))}
          archetype={archetype}
          balance={serverPower ?? 0} // 残高は権威側が正 (#551)
          materials={materialsView}
          pieces={craftedPieces}
          // **参照している rkey 全部を保護する** (#609 レビュー)。resolved (実効) だけだと、
          // 手数で無効化中の盾が「そうび中」表示のまま きたえる で黙って燃える。
          equippedRkeys={Object.values(gearRefs ?? {}).filter((v): v is string => typeof v === 'string')}
          busy={craftBusy}
          lastAction={shop.lastShopAction}
          errorText={shopError}
          noticeText={shop.shopNotice}
          onCraft={(def) => void shop.onCraft(def)}
          onForge={(def, level, rkeys) => void shop.onForge(def, level, rkeys)}
          onSell={(materialId, count) => void shop.onSell(materialId, count)}
          onClose={() => setShopOpen(false)}
        />
      )}
      {wipeOverlay}
      <WelcomeBlessingOverlay />
    </div>
  );
}
