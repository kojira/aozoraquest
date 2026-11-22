/**
 * サーバーが PDS に書く記録 (battleGuard・gameState) に**整数以外の数値を入れない** (#998)。
 * AT Protocol のデータモデルは小数を持てず、PDS は putRecord を 400 で拒む。遭遇では「encounter failed
 * (移動は通す)」で敵が黙って消えていた (防具の染まり armorDye 0.5)。小数の出やすい戦闘を一通り通して、
 * 書こうとした記録を全部見る: 染まった防具 (主人公・仲間)、ボスの型 (patternSets)、群れ。
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { setMonsterOverrides, setStory, storyBattleById, type MonsterDef } from '@aozoraquest/core';
import { TEST_MONSTERS } from '../../../packages/core/src/__tests__/helpers/monster-fixture';
import { handleTurn, sealEncounter } from '../src/battle-resolver';
import { GS, LETTER, makeEnv, NOW, pds, USER } from './support/party-env';

/** 記録の中の整数以外の数値 (場所つき)。 */
function nonIntegers(v: unknown, path = '$'): string[] {
  if (typeof v === 'number') return Number.isInteger(v) ? [] : [`${path}=${v}`];
  if (Array.isArray(v)) return v.flatMap((x, i) => nonIntegers(x, `${path}[${i}]`));
  if (v && typeof v === 'object') return Object.entries(v).flatMap(([k, x]) => nonIntegers(x, `${path}.${k}`));
  return [];
}

/** party-env の PDS に、putRecord で書こうとした記録を全部ためる。 */
function recordingPds(seed: Parameters<typeof pds>[0]) {
  const m = pds(seed);
  const written: Array<{ collection: string; record: unknown }> = [];
  const fn = (async (url: string, init?: RequestInit) => {
    if (url.includes('putRecord')) written.push(JSON.parse(init!.body as string) as { collection: string; record: unknown });
    return m.fn(url, init);
  }) as unknown as typeof fetch;
  return { ...m, fn, written };
}

const mon = (id: string, over: Partial<MonsterDef> = {}): MonsterDef => ({ id, name: id, species: 'slime', level: 1, tier: 1, stats: [7, 5, 6, 2, 4], hp: 5, drops: [{ item: 'herb', chance: 0.5 }], intro: 'て。', ...over });
const TELL = 'とうろうの火が、しろくふくらんでいく…';
const BOSS = mon('pt-boss', { storyOnly: true, hp: 60, stats: [3, 3, 3, 3, 3], drops: [], patternSets: [
  { patterns: [{ weight: 1, steps: [{ move: 'attack' }, { move: 'smash', name: 'おおあかり', power: 0.55, tell: TELL }] }] },
  { below: 0.5, say: 'のびた…', patterns: [{ weight: 1, steps: [{ move: 'smash', name: 'おおあかり', power: 0.55, tell: TELL }, { move: 'drain', name: 'すいとり', power: 0.5, heal: 0.5, tell: 'すいこむ…' }] }] },
] } as Partial<MonsterDef>);
/** 主人公も仲間も、染まった防具 (ほしのころも void 0.5) と強化した小物を着る。 */
const DYED = { armor: { id: 'ar-star-robe', level: 3 } };

describe('PDS に書く記録に小数を入れない (#998)', () => {
  const orig = globalThis.fetch;
  beforeAll(() => {
    setMonsterOverrides([mon('a'), mon('b'), mon('c'), BOSS]);
    setStory({ battles: [{ id: 'b-boss', monsterId: 'pt-boss', count: 1, winFlag: 'beat-boss', canFlee: false }, { id: 'b-pack', monsterId: 'a', count: 3, winFlag: 'beat-pack' }],
      recruits: [{ id: 'r-1', name: 'カイト', archetype: 'warrior', guild: 'g-bluesky', line: 'よろしく。' }] });
  });
  afterAll(() => { setStory(null); setMonsterOverrides(TEST_MONSTERS); });
  afterEach(() => { globalThis.fetch = orig; });

  for (const [name, battleId] of [['ボスの型', 'b-boss'], ['群れ', 'b-pack'], ['ふつうの遭遇', undefined]] as const) {
    it(`${name}: 封印から決着まで、battleGuard と gameState に小数が無い`, async () => {
      const env = await makeEnv();
      const state = GS({ flags: [LETTER], gearSel: DYED, party: { ids: ['r-1'], gear: { 'r-1': DYED } }, carryHp: 20, x: 40, y: 40 });
      const m = recordingPds(state);
      globalThis.fetch = m.fn;
      const enc = await sealEncounter(env, USER, state, 40, 40, 7, NOW, undefined, undefined, undefined, battleId ? storyBattleById(battleId) : undefined);
      expect(enc.state.player.armorDye).toBeDefined(); // 小数の出る形で戦っている
      for (let turn = 0; turn < 60; turn++) {
        const r = await handleTurn(env, USER, enc.battleId, turn, turn % 3 === 2 ? 'guard' : 'attack', NOW, undefined, 0, 0);
        if (r.outcome !== 'ongoing') break;
      }
      expect(m.written.some((w) => w.collection.endsWith('.battleGuard'))).toBe(true);
      expect(m.written.some((w) => w.collection.endsWith('.gameState'))).toBe(true);
      expect(m.written.flatMap((w) => nonIntegers(w.record, w.collection))).toEqual([]);
    });
  }
});
