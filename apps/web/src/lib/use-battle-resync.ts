/**
 * 戦闘の読み直し (#1006)。スマホでブラウザを裏に回すと、ターンの答えが画面に届かないまま
 * サーバーではターンが進む。画面が古い番号で送り続けると 409 から抜けられない。
 *
 * - 409 を受けたとき・画面が前に戻ったとき (入力待ちのとき) に `/api/battle/current` を読む。
 * - 同じ戦闘が続いていれば、サーバーのいまの番号・state の入力にもどす。
 * - 戦闘が無い (決着ずみ・置き換え) なら戦闘を閉じ、`/api/me/state` の HP・位置・在庫・パワー・依頼を写す。
 *   報酬は**サーバーが決着のときに確定済み**。ここでは何も足さない (二重に付けない)。
 *   決着の行は取り戻せないので「たたかいは おわっていた」とだけ出す。
 */
import { useCallback, useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import type { Agent } from '@atproto/api';
import { serverBattleCurrent, serverState } from '@/lib/world-server';
import { questStateOf, type QuestState } from '@/lib/game-quest';
import { refreshJobXp } from '@/lib/use-job-xp';
import { asBattleState, type Vitals } from '@/lib/world-view';
import type { WorldBattle } from '@/lib/use-world-battle';

export const BATTLE_ALREADY_OVER = 'たたかいは おわっていた';

export function useBattleResync({ agent, battleRef, setBattle, setWs, setNotice, scheduleSave, setQuest, flagsRef, tokenRef, applyServerMaterials, setServerPower, didRef }: {
  agent: Agent | null;
  battleRef: MutableRefObject<WorldBattle | null>;
  setBattle: Dispatch<SetStateAction<WorldBattle | null>>;
  setWs: Dispatch<SetStateAction<Vitals | null>>;
  setNotice: (notice: string | null) => void;
  scheduleSave: () => void;
  setQuest: (next: (s: QuestState) => QuestState) => void;
  flagsRef: MutableRefObject<string[]>;
  tokenRef: MutableRefObject<string | undefined>;
  applyServerMaterials: (m: Record<string, number>) => void;
  setServerPower: Dispatch<SetStateAction<number | null>>;
  didRef: MutableRefObject<string | null>;
}): () => Promise<void> {
  const resync = useCallback(async () => {
    const b = battleRef.current;
    if (!agent || !b || b.phase === 'result') return;
    const { battle: cur } = await serverBattleCurrent(agent);
    if (battleRef.current !== b) return; // 読んでいる間に送った・閉じた (その結果を正とする)
    if (cur && cur.battleId === b.battleId) {
      const { errorText: _e, prevState: _p, ...rest } = b;
      const back: WorldBattle = { ...rest, state: asBattleState(cur.state), phase: 'input', busy: false };
      battleRef.current = back;
      setBattle(back);
      return;
    }
    battleRef.current = null;
    setBattle(null);
    setNotice(BATTLE_ALREADY_OVER);
    const { state, token } = await serverState(agent);
    if (token) tokenRef.current = token;
    setWs((s) => {
      if (!s) return s;
      const { mapId: _m, ...rest } = s;
      return { ...rest, ...(state.mapId ? { mapId: state.mapId } : {}), x: state.x, y: state.y, hp: state.carryHp ?? null, mp: state.carryMp ?? null };
    });
    scheduleSave();
    applyServerMaterials(state.materials ?? {});
    setServerPower(state.power ?? 0);
    setQuest(() => questStateOf(state));
    flagsRef.current = state.flags ?? [];
    if (didRef.current) void refreshJobXp(agent, didRef.current);
  }, [agent, battleRef, setBattle, setWs, setNotice, scheduleSave, setQuest, flagsRef, tokenRef, applyServerMaterials, setServerPower, didRef]);

  // 画面が前に戻ったら、入力待ちの戦闘を一度読み直す (裏にいる間に答えを取りこぼしていても、押す前に追いつく)。
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const onVisible = () => {
      const b = battleRef.current;
      if (document.visibilityState !== 'visible' || !b || b.busy || b.phase !== 'input') return;
      resync().catch((e: unknown) => console.warn('[world] battle resync failed', e));
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [battleRef, resync]);

  return resync;
}
