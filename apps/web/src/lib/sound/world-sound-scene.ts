/**
 * ワールドのいまの場面から曲を決める (D-SOUND-001 §3)。
 * - 戦闘: イービル・マスク (敵の id) は final、ほかのストーリーの敵 (storyOnly・ストーリー戦) は boss、ほかは battle。
 *   決着の画面は、勝ちなら victory、負けなら曲なし (defeat のジングル)。
 * - はじめての開始 (導入の会話) は title、カジノの画面を開いている間は casino。
 * - 街と建物の中は town、外は地方の危険度 (tier) で field (1–2)・field2 (3–5)・field3 (6–8)。
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

/** イービル・マスク (と、その 2 つめの姿)。 */
export const FINAL_BOSS_IDS: readonly string[] = ['mask-1', 'mask-2'];

/** 外を歩いているときの曲。tier は tierForRegion の危険度 (1–8)。 */
export function fieldSong(tier: number): SongId {
  return tier >= 6 ? 'field3' : tier >= 3 ? 'field2' : 'field';
}

export interface WorldSoundPlace {
  /** 現在地を読み込めたか (読み込み前は曲なし)。 */
  loaded: boolean;
  battle: WorldSoundBattle | null;
  /** 街か建物の中。 */
  indoors: boolean;
  /** 外の危険度 (tierForRegion)。 */
  tier: number;
  /** はじめての開始の会話 (openingLines) の間。 */
  opening: boolean;
  /** カジノの画面を開いている間。 */
  casino: boolean;
}

export function worldSound({ loaded, battle, indoors, tier, opening, casino }: WorldSoundPlace): WorldSound {
  if (!loaded) return { scene: null, jingle: null };
  if (!battle) return { scene: opening ? 'title' : casino ? 'casino' : indoors ? 'town' : fieldSong(tier), jingle: null };
  if (battle.phase === 'result') {
    if (battle.state.outcome === 'lose') return { scene: null, jingle: { id: 'defeat', key: `${battle.battleId}:defeat` } };
    const up = !!battle.awarded?.leveledUp || !!battle.awarded?.allyLeveledUp?.length;
    return { scene: 'victory', jingle: up ? { id: 'levelup', key: `${battle.battleId}:levelup` } : null };
  }
  if (FINAL_BOSS_IDS.includes(battle.state.monsterId)) return { scene: 'final', jingle: null };
  const boss = !!battle.state.story || !!MONSTERS_BY_ID[battle.state.monsterId]?.storyOnly;
  return { scene: boss ? 'boss' : 'battle', jingle: null };
}
