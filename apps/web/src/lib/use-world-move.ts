import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import type { Agent } from '@atproto/api';
import { WORLD_MAP_ID, gateAt, gateLockedNotice, gateOpen, interiorById, interiorExitFor, interiorShopAt, isWalkableAt, npcAt, townAt, walkableIn, wrap, type NpcDef } from '@aozoraquest/core';
import { serverMove, worldServerEnabled, WorldServerError } from '@/lib/world-server';
import { recordTownArrival, saveWorldState } from '@/lib/world-state';
import type { WorldScrollStep } from '@/lib/use-world-scroll';
import type { BattlePhase } from '@/components/world-battle-controls';
import type { WipePhase } from '@/components/encounter-wipe';
import type { DoorFadePhase } from '@/components/door-fade';
import { isFutabaGuild } from '@/lib/futaba-guild';
import { guildEntryTalk, guildMetKey } from '@/lib/guild-greeting';
import type { NpcTalk } from '@/lib/npc-talk';
import type { WorldBattle } from '@/lib/use-world-battle';
import { DIRS, asBattleState, type Dir, type Vitals } from '@/lib/world-view';

export interface WorldMoveDeps {
  agent: Agent | null;
  did: string | null;
  wsRef: MutableRefObject<Vitals | null>;
  setWs: Dispatch<SetStateAction<Vitals | null>>;
  setScrollStep: Dispatch<SetStateAction<WorldScrollStep | null>>;
  /** 戦闘・演出・各モーダル・会話など、移動を受け付けない状態か (全入力経路を一括ガード)。 */
  inputBlocked: () => boolean;
  moveBusyRef: MutableRefObject<boolean>;
  tokenRef: MutableRefObject<string | undefined>;
  flagsRef: MutableRefObject<string[]>;
  materialsRef: MutableRefObject<Record<string, number>>;
  guildExitBlockedRef: MutableRefObject<boolean>;
  mapAcquisitionRef: MutableRefObject<boolean>;
  waitForFreshDirectionRef: MutableRefObject<boolean>;
  battleRef: MutableRefObject<WorldBattle | null>;
  setBattle: Dispatch<SetStateAction<WorldBattle | null>>;
  setWipe: Dispatch<SetStateAction<WipePhase | null>>;
  setDoorFade: Dispatch<SetStateAction<DoorFadePhase | null>>;
  setNotice: Dispatch<SetStateAction<string | null>>;
  setMapAcquisition: Dispatch<SetStateAction<string | null>>;
  setServerPower: Dispatch<SetStateAction<number | null>>;
  setNpcTalk: Dispatch<SetStateAction<NpcTalk | null>>;
  openDirectNpc: (npc: NpcDef) => void;
  resetShopView: () => void;
  setShopOpen: Dispatch<SetStateAction<boolean>>;
  scheduleSave: () => void;
}

// 移動は**サーバー (edge Worker) が権威判定する** (docs/21 §5 再設計)。クライアントは方向 (隣接1マス) と
// 位置トークンを送るだけで、位置も遭遇も tier も報酬もサーバーが決める = 改造してもチートできない。
// 体感を軽くするため**楽観描画** (応答を待たず即座に1マス進め、サーバー応答で照合)。
export function useWorldMove(d: WorldMoveDeps) {
  const { agent, did, wsRef, setWs, setScrollStep, moveBusyRef, tokenRef, flagsRef, materialsRef, guildExitBlockedRef, mapAcquisitionRef, waitForFreshDirectionRef, battleRef, setBattle, setWipe, setDoorFade, setNotice, setMapAcquisition, setServerPower, setNpcTalk, openDirectNpc, resetShopView, setShopOpen, scheduleSave, inputBlocked } = d;
  return useCallback(
    (dir: Dir) => {
      const s = wsRef.current;
      // 戦闘中・リザルト表示中・地図表示中・ワイプ演出中は移動不可 (全入力経路を一括ガード)。
      if (!s || inputBlocked()) return;
      if (!worldServerEnabled || !agent) { setNotice('サーバーに接続できないため移動できない。'); return; }
      const { dx, dy } = DIRS[dir];
      const cur = s.mapId ? interiorById(s.mapId) ?? null : null;
      const nx = cur ? s.x + dx : wrap(s.x + dx);
      const ny = cur ? s.y + dy : wrap(s.y + dy);
      // **NPC にぶつかったら会話** (#425)。DQ の作法: 移動はせず、話しかける。
      // クエスト発注 NPC (#423) は状況で話が変わる: 未受注→依頼 (はいで受注)、
      // 進行中→達成を試みる (条件検証はサーバー)、達成済み→通常セリフ。
      // NPC は今いるマップで引く (#613)。内部マップの NPC はフィールドの同じ座標には居ない。
      const npc = npcAt(cur?.id ?? WORLD_MAP_ID, nx, ny);
      if (npc) {
        if (isFutabaGuild(npc)) {
          // 受付の真下 (扉の前) からだけ入れる。位置は NPC データから決める (Refs #718)。
          if (s.x !== npc.x || s.y !== npc.y + 1) {
            setNotice('ギルドの とびらの まえから はいろう。');
            return;
          }
          if (guildExitBlockedRef.current) return;
          guildExitBlockedRef.current = true;
          let met = false;
          try { met = localStorage.getItem(guildMetKey(did, npc.id)) === '1'; } catch { /* private mode */ }
          setNpcTalk(guildEntryTalk(npc, met));
          return;
        }
        openDirectNpc(npc);
        return;
      }
      // 施錠中のゲート (#426) は踏む前に止める。サーバーも同じ判定をするので、
      // ここで止めないと「歩けたのに弾かれる」1 手が毎回発生する。
      const gate = gateAt(s.mapId ?? WORLD_MAP_ID, nx, ny);
      if (gate && !gateOpen(gate, flagsRef.current, materialsRef.current)) {
        setNotice(gateLockedNotice(gate));
        return;
      }
      // 端から外へ出られるマップ (#626) は、範囲外でも止めない (サーバーが外へ出す)。
      const leaving = cur ? interiorExitFor(cur, nx, ny) : undefined;
      if (!leaving && !walkableIn(s.mapId ?? WORLD_MAP_ID, nx, ny, isWalkableAt)) {
        setNotice('そっちには進めない!');
        return;
      }
      // 楽観描画: サーバー応答を待たずに即座に1マス進める (歩行を軽快に)。位置はサーバーが権威だが
      // client/server とも同じ wrap+地形なので通常は一致する。失敗時だけ元位置へロールバック。
      const optimistic: Vitals = { ...s, x: nx, y: ny };
      wsRef.current = optimistic;
      setScrollStep({ x: nx, y: ny, mapId: s.mapId, dx, dy });
      setWs(optimistic);
      moveBusyRef.current = true;
      void (async () => {
        try {
          const res = await serverMove(agent, dx, dy, tokenRef.current);
          tokenRef.current = res.token;
          const guildAbove = res.mapId ? npcAt(res.mapId, res.x, res.y - 1) : undefined;
          if (!guildAbove || !isFutabaGuild(guildAbove)) guildExitBlockedRef.current = false;
          // A correction/door is not another walking step. Discard the old map offset.
          if (res.x !== nx || res.y !== ny || res.mapId !== s.mapId) setScrollStep(null);
          const cur = wsRef.current ?? optimistic;
          // マップの切り替え (#424)。ゲートを踏むとサーバーが mapId を返す。
          // 街到着は移動後の地形ではなく、権威側が確定したフィールド座標で扱う。
          const t = res.townArrival ? townAt(res.townArrival.x, res.townArrival.y) : null;
          let next: Vitals = { ...cur, x: res.x, y: res.y, ...(res.mapId ? { mapId: res.mapId } : {}) };
          if (!res.mapId) delete next.mapId;
          if (res.healed) { next.hp = null; next.mp = null; }
          // **マップが変わったら扉の演出** (#626)。パッと切り替わると「どこへ来たのか」が
          // 分からない。戦闘の渦巻きとは別の、白い光がふわっと引くフェードにする。
          if ((res.mapId ?? null) !== (cur.mapId ?? null)) setDoorFade('out');
          // **なんでも屋の扉に入ったら店を開く** (#424)。メニューを開かせないと
          // 店だと気づけない (実機で「なんでも屋がどこか分からない」と指摘)。
          if (res.mapId) {
            const sp = interiorShopAt(res.mapId, res.x, res.y);
            // メニュー経由と**同じ状態合わせをする** (#638 レビュー ★★★)。resetShopView 参照。
            if (sp) {
              resetShopView();
              setShopOpen(true);
              setNotice(null);
            }
          }
          // 宿屋 (#424)。残高もサーバーが正 (payment は権威側で引かれている)。
          if (res.inn) {
            setServerPower(res.inn.power);
            const who = res.inn.name ?? 'やどや';
            setNotice(res.inn.paid > 0
              ? `${who}に とまった (パワー -${res.inn.paid})。すっかり 元気に なった!`
              : `「${who}」…いまは よく ねむれているようだ。`);
          } else if (res.innDenied) {
            const who = res.innDenied.name ?? 'やどや';
            setNotice(`${who}「ひとばん ${res.innDenied.price} パワーだよ」… パワーが たりない (いま ${res.innDenied.power})。`);
          }
          if (res.townArrival) {
            const arrival = recordTownArrival(next, res.townArrival);
            const { gained, newlyVisited } = arrival;
            next = arrival.state;
            const arrived = t ? (res.healed
              ? `「${t.name}」で休んで、すっかり元気になった!`
              : `「${t.name}」に ついた!`) : '';
            if (gained) {
              mapAcquisitionRef.current = true;
              waitForFreshDirectionRef.current = true;
              setMapAcquisition(`${arrived} ちずのかけらを 手に入れた!`.trim());
              setNotice(null);
            } else {
              setNotice(arrived || null);
            }
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
          // 失敗: 楽観移動をロールバック (元の位置へ戻す)。トークンは前回成功時のまま = 次歩で再同期される。
          wsRef.current = s;
          setScrollStep(null);
          setWs(s);
          // 409 は「戦闘中」だけでなく未診断 (診断が先に必要) もあるので code で出し分ける。
          if (e instanceof WorldServerError && e.code === 'diagnosis_required') setNotice('先に 気質診断が ひつようだ。');
          else if (e instanceof WorldServerError && e.status === 409) setNotice('戦闘中は移動できない。');
          // 施錠ゲート (#426) はサーバーの理由をそのまま出す ('そっちには進めない' だと
          // 地形のせいだと誤解する)。
          else if (e instanceof WorldServerError && e.code === 'gate_locked') setNotice(e.message);
          else if (e instanceof WorldServerError && e.status === 400) setNotice('そっちには進めない!');
          else if (e instanceof WorldServerError && (e.code === 'timeout' || e.code === 'network')) setNotice('サーバーが応答しない。すこし まってから もう一度。');
          else { console.warn('[world] serverMove failed', e); setNotice('移動できなかった (通信エラー)。'); }
        } finally {
          moveBusyRef.current = false;
        }
      })();
    },
    [scheduleSave, agent, did, resetShopView, openDirectNpc, inputBlocked, wsRef, setWs, setScrollStep, moveBusyRef, tokenRef, flagsRef, materialsRef, guildExitBlockedRef, mapAcquisitionRef, waitForFreshDirectionRef, battleRef, setBattle, setWipe, setDoorFade, setNotice, setMapAcquisition, setServerPower, setNpcTalk, setShopOpen],
  );
}
