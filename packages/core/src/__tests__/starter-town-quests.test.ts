import { afterEach, expect, it } from 'vitest';
import { starterTownNpcs } from '../interior-samples.js';
import { starterTownQuests } from '../starter-town-quests.js';
import { setNpcs } from '../npc-data.js';
import { gameQuestByNpc, setGameQuests } from '../quest-data.js';

afterEach(() => { setGameQuests(null); setNpcs(null); });
it('ギルドは既存3依頼とは別の素材納品で、消費と承認済み報酬を受注前に説明する', () => {
  setNpcs(starterTownNpcs());
  setGameQuests(starterTownQuests());
  const q = gameQuestByNpc('futaba-bluesky');
  expect(q?.title).toBe('道具の手入れに');
  expect(q?.objective).toEqual({ kind: 'collect', itemId: 'slime-drop', count: 2 });
  expect(q?.reward).toEqual({ itemId: 'herb', count: 2, power: 5 });
  expect(q?.intro.join('\n')).toContain('村の道具屋');
  expect(q?.intro.join('\n')).toContain('2こ わたします');
  expect(starterTownQuests().slice(0, 3).map(q => q.id)).toEqual(['futaba-slimes', 'futaba-herbs', 'futaba-wings']);
});
