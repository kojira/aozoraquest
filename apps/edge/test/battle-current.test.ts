/**
 * 戦闘の読み直し (#1006)。スマホでブラウザを裏に回すと、ターンの答えが画面に届かないまま
 * サーバーではターンが進む。画面は古い番号で送り続けて 409 から抜けられなかった。
 * - 片づいたターンを同じ番号で送り直すと 409。current はサーバーのいまの番号と state を返す
 * - 読むだけで、ターンを進めない・seed を返さない (やり直し不可はそのまま)
 * - 戦闘が無い (決着ずみ・置き換え) なら battle: null
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { setMonsterOverrides, setStory, storyBattleById, type GearSelection, type MonsterDef } from '@aozoraquest/core';
import { TEST_MONSTERS } from '../../../packages/core/src/__tests__/helpers/monster-fixture';
import { handleTurn, sealEncounter } from '../src/battle-resolver';
import { handleBattleCurrent } from '../src/battle-current';
import { GS, LETTER, makeEnv, NOW, pds, USER } from './support/party-env';

const mon = (id: string): MonsterDef => ({ id, name: id, species: 'slime', level: 1, tier: 1, stats: [3, 40, 6, 2, 4], hp: 400, drops: [], intro: 'て。' });
/** 属性の防具 (染まり 0.5 = 記録では小数を文字列で持つ。#998) を着た主人公。 */
const DYED: GearSelection = { armor: { id: 'ar-star-robe', level: 0 } };

describe('戦闘の読み直し GET /api/battle/current (#1006)', () => {
  const orig = globalThis.fetch;
  beforeAll(() => {
    setMonsterOverrides([mon('a'), mon('b'), mon('c')]);
    setStory({ battles: [{ id: 'b2', monsterId: 'a', count: 2, winFlag: 'w' }], recruits: [{ id: 'r-1', name: 'カイト', archetype: 'sage', guild: 'g', line: 'よろしく。' }] });
  });
  afterAll(() => { setStory(null); setMonsterOverrides(TEST_MONSTERS); });
  afterEach(() => { globalThis.fetch = orig; });

  async function seal() {
    const env = await makeEnv();
    const m = pds(GS({ flags: [LETTER], party: { ids: ['r-1'] }, gearSel: DYED }));
    globalThis.fetch = m.fn;
    const enc = await sealEncounter(env, USER, m.gs(), 10, 10, 1, NOW, undefined, undefined, undefined, storyBattleById('b2'));
    return { env, enc, m };
  }

  it('染まりの防具・敵 2 体・仲間つきで、とくぎを交えて何ターンも続けられる', async () => {
    const { env, enc } = await seal();
    expect(enc.state.enemies).toHaveLength(2);
    expect(enc.state.allies).toHaveLength(2);
    expect(enc.state.player.armorDye).toEqual({ void: 0.5 });
    for (let t = 0; t < 5; t++) {
      const r = await handleTurn(env, USER, enc.battleId, t, t % 2 ? 'skill' : 'attack', NOW + t, undefined, 0, 1);
      expect(r.state.turn).toBe(t + 1);
    }
  });

  it('答えが届かなかったターン T を送り直すと 409。current は T+1 と state を返し、そこから続けられる', async () => {
    const { env, enc } = await seal();
    const lost = await handleTurn(env, USER, enc.battleId, 0, 'attack', NOW); // 画面には届かなかった答え
    await expect(handleTurn(env, USER, enc.battleId, 0, 'skill', NOW + 1)).rejects.toMatchObject({ status: 409 });
    const cur = await handleBattleCurrent(env, USER);
    expect(cur.battle).toMatchObject({ battleId: enc.battleId, turn: 1 });
    expect(cur.battle!.state.turn).toBe(1);
    expect(cur.battle!.state.player.hp).toBe(lost.state.player.hp);
    expect('seed' in cur.battle!.state).toBe(false); // 先読み不可のまま
    const next = await handleTurn(env, USER, cur.battle!.battleId, cur.battle!.turn, 'attack', NOW + 2);
    expect(next.state.turn).toBe(2);
  });

  it('読み直しはターンを進めない (何度読んでも同じ番号・ガードは書き換わらない)', async () => {
    const { env, enc, m } = await seal();
    await handleTurn(env, USER, enc.battleId, 0, 'attack', NOW);
    const before = JSON.stringify(m.guard());
    await handleBattleCurrent(env, USER);
    const again = await handleBattleCurrent(env, USER);
    expect(again.battle!.turn).toBe(1);
    expect(JSON.stringify(m.guard())).toBe(before);
  });

  it('戦闘が無い (決着ずみ・置き換え) なら battle: null。送り直しは 409 のまま', async () => {
    const env = await makeEnv();
    globalThis.fetch = pds(GS()).fn;
    expect(await handleBattleCurrent(env, USER)).toEqual({ battle: null });
    await expect(handleTurn(env, USER, 'b-gone', 3, 'attack', NOW)).rejects.toMatchObject({ status: 409 });
  });
});
