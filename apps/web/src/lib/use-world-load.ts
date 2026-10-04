import { useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import type { Agent } from '@atproto/api';
import { townAt, type DiagnosisResult } from '@aozoraquest/core';
import { getRecord } from '@/lib/atproto';
import { COL } from '@/lib/collections';
import { loadWorldState, saveWorldState } from '@/lib/world-state';
import { loadBattleStats } from '@/lib/battle-log';
import { serverState } from '@/lib/world-server';
import { loadCraftInventory, type CraftedPiece } from '@/lib/crafting';
import { loadGearRefs, type GearRefs } from '@/lib/gear';
import { loadAuthoredWorld } from '@/lib/world-authoring';
import { ONBOARDING_DONE_KEY, WELCOME_BLESSING_PENDING_KEY } from '@/lib/onboarding-reset';
import { questStateOf, type QuestState } from '@/lib/game-quest';
import { piecesFromServer } from '@/lib/use-world-shop';
import type { WorldInventory } from '@/lib/use-world-inventory';
import type { Vitals } from '@/lib/world-view';

export interface WorldLoadDeps {
  sessionStatus: string;
  agent: Agent | null;
  did: string | null;
  retryNonce: number;
  setLoadErr: Dispatch<SetStateAction<boolean>>;
  setServerPower: Dispatch<SetStateAction<number | null>>;
  setQuest: (next: QuestState) => void;
  flagsRef: MutableRefObject<string[]>;
  tokenRef: MutableRefObject<string | undefined>;
  setCraftedPieces: Dispatch<SetStateAction<CraftedPiece[]>>;
  setGearRefs: Dispatch<SetStateAction<GearRefs>>;
  setWs: Dispatch<SetStateAction<Vitals | null>>;
  setStarterBlessed: Dispatch<SetStateAction<boolean>>;
  setShowStarter: Dispatch<SetStateAction<boolean>>;
  setOnboarding: Dispatch<SetStateAction<boolean>>;
  onboardingRef: MutableRefObject<boolean>;
  setNotice: Dispatch<SetStateAction<string | null>>;
  setAvatarUrl: Dispatch<SetStateAction<string | null>>;
  setPlayerName: Dispatch<SetStateAction<string>>;
  setDiag: Dispatch<SetStateAction<DiagnosisResult | null>>;
  inventory: WorldInventory;
  flushCraftLog: () => void;
}

// 初期ロード。位置の読み込み失敗はエラー表示 + リトライ (spawn に倒すと
// 「テレポート → 上書き保存」のデータ損失になるため倒さない)。
export function useWorldLoad(d: WorldLoadDeps) {
  const { sessionStatus, agent, did, retryNonce, flushCraftLog, setQuest } = d;
  useEffect(() => {
    if (sessionStatus !== 'signed-in' || !agent || !did) return;
    const { setLoadErr, setServerPower, flagsRef, tokenRef, setCraftedPieces, setGearRefs, setWs, setStarterBlessed, setShowStarter, setOnboarding, onboardingRef, setNotice, setAvatarUrl, setPlayerName, setDiag, inventory } = d;
    const { setHerbStock, setTonicStock, setFeatherStock, materialsRef, setMaterialsView } = inventory;
    let cancelled = false;
    setLoadErr(false);
    let grantStarter = false;
    // サーバー gameState の在庫/HP (取得できれば表示の正)。try の内外で使うのでここで宣言。
    let serverInv: { materials: Record<string, number>; carryHp?: number | undefined; carryMp?: number | undefined } | null = null;
    (async () => {
      try {
        // Internal map/NPC definitions must exist before restoring a saved mapId.
        // Otherwise a fast state response renders village coordinates as a field.
        await loadAuthoredWorld(agent);
        if (cancelled) return;
        const state = await loadWorldState(agent, did);
        if (cancelled) return;
        // 冒険の初回に そらのはねを 1 個わたす (docs/19。gotStarterFeather で二重配布
        // 防止)。実際の +1 は下の featherStock 初期化 (stats ロード後) で足す
        grantStarter = !state.gotStarterFeather;
        // 位置は**サーバー権威**を正とする (docs/21 再設計)。サーバーの gameState 位置を初期位置に
        // 使うことで、初回移動でクライアント位置とサーバー位置がズレて「ワープ」するのを防ぐ。
        // 街/地図/HP 等の探索メモは従来どおり client の world-record を使う。取得失敗時は world-record 位置。
        let px = state.x, py = state.y;
        /** サーバー権威の mapId (#424)。内部マップに居るならその id。 */
        let serverMapId: string | undefined;
        // サーバー gameState を在庫/HP/位置の**唯一の正**とする (#372)。取得失敗時のみ world-record にフォールバック。
        try {
          const ss = await serverState(agent);
          if (!cancelled) {
            serverInv = { materials: ss.state.materials ?? {}, carryHp: ss.state.carryHp, carryMp: ss.state.carryMp };
            setServerPower(ss.state.power ?? 0);
            setQuest(questStateOf(ss.state));
            flagsRef.current = ss.state.flags ?? [];
            serverMapId = ss.state.mapId;
            // **所持個体もサーバーが正** (#551 段階 2)。ユーザー PDS の craft レコードは
            // 記帳 (履歴) であって所持の根拠ではない。
            if (ss.state.pieces) setCraftedPieces(piecesFromServer(ss.state.pieces));
            if (Number.isFinite(ss.state.x) && Number.isFinite(ss.state.y)) {
              px = ss.state.x; py = ss.state.y;
              // 初期トークンも受け取る → 初手 move から有効トークンを送れて、表示位置=トークン位置が保証され
              // 再同期・ワープが起きない (impl レビュー指摘)。
              if (ss.token) tokenRef.current = ss.token;
            }
          }
        } catch (e) { console.warn('[world] serverState failed; using local position', e); }
        if (cancelled) return;
        // 今いる場所が街 (spawn 含む) なら訪問済みに含める。歩いて入る move 経路だけ
        // だと、開始の街や そらのはね着地先が行き先候補に入らない (レビュー ★★)
        const curTown = townAt(px, py);
        const seededVisited = curTown && !state.visitedTowns.some((v) => v.x === px && v.y === py)
          ? [...state.visitedTowns, { x: px, y: py }]
          : state.visitedTowns;
        const initialWs = {
          // **内部マップ (#424) を維持する。** ここで捨てると、内部でリロードした瞬間
          // 内部座標をフィールドとして描き、移動判定もフィールドで行って食い違う
          // (サーバーは mapId 入りのトークンを返している。レビュー ★★)。
          ...(serverMapId ? { mapId: serverMapId } : {}),
          x: px,
          y: py,
          // HP/MP はサーバー権威 (carryHp/Mp)。undefined=満タンなので null に。取得失敗時のみ world-record。
          hp: serverInv ? (serverInv.carryHp ?? null) : state.hp,
          mp: serverInv ? (serverInv.carryMp ?? null) : state.mp,
          lastTown: state.lastTown,
          regions: state.regions,
          visitedTowns: seededVisited,
          gotStarterFeather: true,
        };
        setWs(initialWs);
        if (grantStarter) {
          // 専用の DQ ウィンドウで Blueskyちゃんの手渡しを見せる (notice だとオンボーディングに
          // 覆われ、relocated 通知に上書きされて「もらった瞬間」が消える — レビュー ★★★)。
          // リセット (実 +20 付与) 経由かをマークで判定 → 祝福セリフ/演出の有無を実付与に一致させる。
          // マークは**ここで読み捨てる**。set 側 (doReset) との間にリロードを挟んでも、入場時に
          // 必ず消費/掃除されるので残留・誤発火しない (レビュー ★★)。
          let blessed = false;
          try {
            blessed = sessionStorage.getItem(WELCOME_BLESSING_PENDING_KEY) === '1';
            if (blessed) sessionStorage.removeItem(WELCOME_BLESSING_PENDING_KEY);
          } catch { /* private mode 等は演出だけ諦める (+20 付与自体は済んでいる) */ }
          setStarterBlessed(blessed);
          setShowStarter(true);
          // gotStarterFeather=true は即時保存 (デバウンス中リロードで二重配布しない —
          // かけら/初訪問と同じ流儀。レビュー ★★)
          void saveWorldState(agent, initialWs);
        } else {
          // 手渡しダイアログを出さない入場では祝福マークを掃除する (set したのに演出へ
          // 到達しなかった残留マークによる誤発火を防ぐ — レビュー ★★)。
          try { sessionStorage.removeItem(WELCOME_BLESSING_PENDING_KEY); } catch { /* ignore */ }
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
      // パワー残高はここで読まない (#551)。**権威 state (serverPower) が唯一の正**で、
      // client 台帳 (points) を並べて持つと、片方だけ更新される経路が生えて食い違う。
      const [profile, d, stats, craftInv, refs] = await Promise.all([
        agent.getProfile({ actor: did }).catch(() => null),
        getRecord<DiagnosisResult>(agent, did, COL.analysis, 'self').catch(() => null),
        loadBattleStats(agent, did).catch(() => null),
        loadCraftInventory(agent, did).catch(() => ({ pieces: [], materialsSpent: {} })),
        loadGearRefs(agent, did).catch(() => ({})),
      ]);
      if (cancelled) return;
      setAvatarUrl(profile?.data.avatar ?? null);
      setPlayerName(profile?.data.displayName || profile?.data.handle || '');
      setDiag(d);
      // 在庫はサーバー gameState を正とする (#372)。やくそう=herb / しずく=sky-dew / はね=sky-feather。
      // サーバー取得失敗時のみ従来のクライアント集計 (stats+craft) にフォールバック。
      let inv: Record<string, number>;
      if (serverInv) {
        inv = { ...serverInv.materials };
      } else {
        inv = { ...(stats?.materials ?? {}) };
        for (const [id, n] of Object.entries(craftInv.materialsSpent)) {
          const left = Math.max(0, (inv[id] ?? 0) - n);
          if (left > 0) inv[id] = left; else delete inv[id];
        }
      }
      setHerbStock(inv['herb'] ?? 0);
      setTonicStock(inv['sky-dew'] ?? 0);
      setFeatherStock(inv['sky-feather'] ?? 0);
      materialsRef.current = inv;
      setMaterialsView({ ...inv });
      // **所持個体はサーバーが正** (#551 段階 2)。ここで入れるのは、サーバーから
      // 取れなかったときの表示フォールバックだけ (装備しても edge が弾く)。
      if (!serverInv) setCraftedPieces(craftInv.pieces);
      setGearRefs(refs);
      // 前のセッションで書けなかった記帳をここで書き直す (#642)。保留は localStorage に
      // 残るので、リロードや翌日の起動でも拾える。
      flushCraftLog();
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 元の World と同じ再取得条件 (setter/ref は安定)
  }, [sessionStatus, agent, did, retryNonce, flushCraftLog, setQuest]);
}

