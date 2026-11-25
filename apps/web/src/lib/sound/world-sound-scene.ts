/**
 * ワールドのいまの場面から曲を決める (D-SOUND-001 §3)。
 * - 戦闘: ストーリーの敵 (storyOnly・ストーリー戦) は boss、ほかは battle。決着の画面は、勝ちなら victory、負けなら曲なし (defeat のジングル)。
 * - 街と建物の中は town、外を歩いているときは field。
 * jingle: 決着で鳴らすジングルと、その鍵 (同じ決着で 2 回鳴らさない)。
 */
import { MONSTERS_BY_ID, type BattleState } from '@aozoraquest/core';
import type { JingleId, SongId } from './songs';

export interface WorldSoundBattle {
  battleId: string;
  phase: 'input' | 'message' | 'result';
  state: Pick<BattleState, 'monsterId' | 'outcome' | 'story'>;
  awarded?: { leveledUp?: unknown; allyLeveledUp?: readonly unknown[] } | undefined;
}

export interface WorldSound { scene: SongId | null; jingle: { id: JingleId; key: string } | null }

export function worldSound(loaded: boolean, battle: WorldSoundBattle | null, indoors: boolean): WorldSound {
  if (!loaded) return { scene: null, jingle: null };
  if (!battle) return { scene: indoors ? 'town' : 'field', jingle: null };
  if (battle.phase === 'result') {
    if (battle.state.outcome === 'lose') return { scene: null, jingle: { id: 'defeat', key: `${battle.battleId}:defeat` } };
    const up = !!battle.awarded?.leveledUp || !!battle.awarded?.allyLeveledUp?.length;
    return { scene: 'victory', jingle: up ? { id: 'levelup', key: `${battle.battleId}:levelup` } : null };
  }
  const boss = !!battle.state.story || !!MONSTERS_BY_ID[battle.state.monsterId]?.storyOnly;
  return { scene: boss ? 'boss' : 'battle', jingle: null };
}
