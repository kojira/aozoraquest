/**
 * パーティ (D-PARTY-001 P1)。
 * - 主人公が倒れたら、仲間が残っていても負け
 * - 仲間 (job を持つ味方) は職のとくぎで自動で動く: 全体回復 → 全体技 → 1 対 1 の autoBattleAction
 * - job の無い味方 (召喚など) は今のまま通常攻撃
 * - TurnEvent.hp.allies は仲間がいるときだけ
 * - ギルドの冒険者 (world.story の recruits) の検証と、紹介できる人の絞り込み
 * - 入れられる人数は章の終わりのフラグで 2 → 3 → 4
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  allyAutoAction, partyCapacity, partyCombatants, playerCombatant, recruitLevelOk, recruitsAt, resolveTurnMulti, setStory, startBattle, validateStory, worldRefs,
  StoryDataError, type BattleState, type Combatant, type RecruitDef,
} from '../index.js';

/** 主人公 (warrior Lv8) + 仲間 1 人 vs 敵 1〜2 体。 */
function party(ally: Combatant, extraEnemies = 0, seed = 3): BattleState {
  const base = startBattle('warrior', 8, 8, 'ゆうしゃ', 1, seed, 0, undefined, extraEnemies ? { extraEnemies } : {});
  const enemies = base.enemies ?? [base.monster];
  return { ...base, allies: [base.player, ally], enemies };
}

const mate = (archetype: Parameters<typeof playerCombatant>[0], level: number, name = 'なかま'): Combatant => ({ ...playerCombatant(archetype, level, 1, name), job: { archetype, level } });

describe('resolveTurnMulti のパーティ', () => {
  it('主人公が倒れたら、仲間が生きていても lose', () => {
    const ally = { ...mate('guardian', 8), maxHp: 99999, hp: 99999 };
    let s = party(ally);
    s = { ...s, player: { ...s.player, hp: 1, def: 0 }, monster: { ...s.monster, atk: 999, hp: 99999, maxHp: 99999 } };
    s = { ...s, allies: [s.player, ally], enemies: [s.monster] };
    for (let i = 0; i < 40 && s.outcome === 'ongoing'; i++) {
      s = resolveTurnMulti(s, 'guard');
      if (s.player.hp <= 0) break;
    }
    expect(s.player.hp).toBe(0);
    expect(s.outcome).toBe('lose');
    expect(s.allies![1]!.hp).toBeGreaterThan(0);
  });

  it('巫女の仲間は、味方が HP 50% を切っていると 癒しの鈴 を使う', () => {
    const miko = mate('miko', 5, 'みこ');
    let s = party(miko);
    s = { ...s, player: { ...s.player, hp: 2 }, monster: { ...s.monster, atk: 0, hp: 99999, maxHp: 99999 } };
    s = { ...s, allies: [s.player, miko], enemies: [s.monster] };
    const next = resolveTurnMulti(s, 'guard', 77);
    expect(next.lastEvents.some((e) => e.text.includes('癒しの鈴'))).toBe(true);
    expect(next.allies![1]!.mp).toBeLessThan(miko.mp);
  });

  it('job の無い味方は今のまま通常攻撃', () => {
    const plain = { ...playerCombatant('warrior', 8, 1, 'しょうかん') };
    const next = resolveTurnMulti(party(plain), 'guard', 5);
    expect(next.lastEvents.some((e) => e.text.startsWith('しょうかんのこうげき!'))).toBe(true);
  });

  it('TurnEvent.hp.allies は仲間がいるときだけ、味方ごとの HP', () => {
    const next = resolveTurnMulti(party(mate('warrior', 8)), 'attack', 9);
    for (const e of next.lastEvents) expect(e.hp!.allies).toHaveLength(2);
    expect(next.lastEvents.at(-1)!.hp!.allies).toEqual(next.allies!.map((a) => a.hp));
    const solo = resolveTurnMulti(startBattle('warrior', 8, 8, 'ゆうしゃ', 1, 3, 0, undefined, { extraEnemies: 1 }), 'attack', 9);
    for (const e of solo.lastEvents) expect(e.hp!.allies).toBeUndefined();
  });
});

describe('allyAutoAction', () => {
  it('敵が 2 体以上で全体技があれば全体技 (巫女 Lv5 の 風の舞)', () => {
    const s = party(mate('miko', 5), 1);
    const a = allyAutoAction(s, 1);
    expect(a.command).toBe('skill');
    expect(s.allies![1]!.job && a.skillIndex).toBeGreaterThan(0);
    const name = ['神楽の祈り', '癒しの鈴', '風の舞'][a.skillIndex];
    expect(name).toBe('風の舞');
  });

  it('全体回復は全体技より先 (味方の誰かが HP 50% 未満)', () => {
    const s0 = party(mate('miko', 5), 1);
    const s = { ...s0, allies: [{ ...s0.player, hp: 1 }, s0.allies![1]!] };
    const a = allyAutoAction(s, 1);
    expect(a).toMatchObject({ command: 'skill', skillIndex: 1 });
  });

  it('それ以外は HP がいちばん低い敵をねらう (生きている敵の中の番号)', () => {
    const s0 = party(mate('warrior', 8), 2);
    const enemies = s0.enemies!.map((e, i) => ({ ...e, hp: [30, 0, 4][i]!, maxHp: 30 }));
    const a = allyAutoAction({ ...s0, enemies, monster: enemies[0]! }, 1);
    expect(a.targetIndex).toBe(1); // 生きている [30, 4] の 2 番目
  });
});

describe('partyCombatants', () => {
  const r = (id: string, archetype: RecruitDef['archetype']): RecruitDef => ({ id, name: id, archetype, guild: 'g', line: 'よろしく。' });

  it('Lv は主人公のジョブ Lv、job を持つ。倒れた仲間は出ない。HP/MP の持ちこし', () => {
    const list = partyCombatants([r('a', 'mage'), r('b', 'miko'), r('c', 'warrior')], 6, { hp: { b: 0, c: 3 }, mp: { c: 1 } });
    expect(list.map((c) => c.name)).toEqual(['a', 'c']);
    expect(list[0]!.job).toEqual({ archetype: 'mage', level: 6 });
    expect(list[0]!.hp).toBe(list[0]!.maxHp);
    expect([list[1]!.hp, list[1]!.mp]).toEqual([3, 1]);
  });

  it('からだが空なら Lv1 から ぬののふく を着る (D-PARTY-004 §9)', () => {
    const lv1 = partyCombatants([r('a', 'mage')], 1)[0]!;
    const lv5 = partyCombatants([r('a', 'mage')], 5)[0]!;
    expect(lv1.def).toBe(playerCombatant('mage', 1, 1, 'a').def + 5);
    expect(lv5.def).toBe(playerCombatant('mage', 5, 1, 'a').def + 5);
  });
});

describe('partyCapacity', () => {
  it('第1章の終わりで 2 人、第3章の終わりで 3 人、第5章の終わりで 4 人', () => {
    expect(partyCapacity([])).toBe(1);
    expect(partyCapacity(['futaba_letter_done'])).toBe(2);
    expect(partyCapacity(['futaba_letter_done', 'yuuhi_feather_done'])).toBe(3);
    expect(partyCapacity(['futaba_letter_done', 'yuuhi_feather_done', 'soyogi_feather_done'])).toBe(4);
  });
});

describe('recruits (world.story)', () => {
  afterEach(() => setStory(null));
  const ok: RecruitDef = { id: 'r-kaito', name: 'カイト', archetype: 'warrior', guild: 'homura-bluesky', requireFlags: ['homura_slimes_done'], line: '力しごとなら まかせて。' };

  it('職・フラグ・ギルド・名前・ひとことを検証する', () => {
    expect(() => validateStory({ recruits: [ok] })).not.toThrow();
    const bad: Array<Record<string, unknown>> = [
      { archetype: 'hero' }, { requireFlags: ['Bad Flag'] }, { guild: '' }, { name: '' }, { name: '{c:x}' }, { line: '' }, { line: 'あ'.repeat(41) },
    ];
    for (const over of bad) expect(() => validateStory({ recruits: [{ ...ok, ...over } as RecruitDef] }), JSON.stringify(over)).toThrow(StoryDataError);
    expect(() => validateStory({ recruits: [ok, ok] })).toThrow(StoryDataError);
  });

  it('recruitsAt: そのギルドで、フラグがそろった人だけ', () => {
    setStory({ recruits: [ok, { ...ok, id: 'r-2', guild: 'kodama-bluesky', requireFlags: [] }] });
    expect(recruitsAt('homura-bluesky', []).map((x) => x.id)).toEqual([]);
    expect(recruitsAt('homura-bluesky', ['homura_slimes_done']).map((x) => x.id)).toEqual(['r-kaito']);
    expect(recruitsAt('kodama-bluesky', []).map((x) => x.id)).toEqual(['r-2']);
  });

  it('minLevel は 1〜99 の整数だけ。recruitLevelOk は主人公のジョブ Lv と比べ、recruitsAt は Lv が足りない人も出す', () => {
    for (const minLevel of [1, 99]) expect(() => validateStory({ recruits: [{ ...ok, minLevel }] })).not.toThrow();
    for (const minLevel of [0, 100, 2.5, '5']) expect(() => validateStory({ recruits: [{ ...ok, minLevel } as unknown as RecruitDef] }), String(minLevel)).toThrow(StoryDataError);
    expect(recruitLevelOk({ ...ok, minLevel: 5 }, 4)).toBe(false);
    expect(recruitLevelOk({ ...ok, minLevel: 5 }, 5)).toBe(true);
    expect(recruitLevelOk(ok, 1)).toBe(true);
    setStory({ recruits: [{ ...ok, minLevel: 99 }] });
    expect(recruitsAt('homura-bluesky', ['homura_slimes_done']).map((x) => x.id)).toEqual(['r-kaito']);
  });

  it('ギルドの NPC への参照が worldRefs に挙がる', () => {
    setStory({ recruits: [ok] });
    expect(worldRefs('npc').filter((x) => x.id === 'homura-bluesky').map((x) => x.from)).toEqual(['冒険者「カイト」']);
  });
});

describe('仲間がいても、1 体だけの fleer は逃げる (1 人戦と同じ)', () => {
  it('敵が 1 体で、その敵が逃げる手を選んだら monster-fled', () => {
    let fled = false;
    for (let seed = 0; seed < 60 && !fled; seed++) {
      const base = startBattle('warrior', 8, 8, 'ゆうしゃ', 2, seed, 0, undefined, { monsterId: 'stray-slime' });
      let s: BattleState = { ...base, allies: [base.player, mate('guardian', 8)], enemies: [base.monster] };
      for (let i = 0; i < 10 && s.outcome === 'ongoing'; i++) s = resolveTurnMulti(s, 'guard');
      if (s.outcome === 'monster-fled') fled = s.lastEvents.some((e) => e.text.includes('逃げだした'));
    }
    expect(fled).toBe(true);
  });

  it('ストーリー戦の敵と、群れ (敵 2 体以上) の fleer は逃げない', () => {
    for (let seed = 0; seed < 30; seed++) {
      const story = startBattle('warrior', 8, 8, 'ゆうしゃ', 2, seed, 0, undefined, { monsterId: 'stray-slime', story: { canFlee: true } });
      let s: BattleState = { ...story, allies: [story.player, mate('guardian', 8)], enemies: [story.monster] };
      for (let i = 0; i < 6 && s.outcome === 'ongoing'; i++) s = resolveTurnMulti(s, 'guard');
      expect(s.outcome).not.toBe('monster-fled');
      const pack = startBattle('warrior', 8, 8, 'ゆうしゃ', 2, seed, 0, undefined, { monsterId: 'stray-slime', extraEnemies: 1 });
      let p: BattleState = { ...pack, allies: [pack.player, mate('guardian', 8)] };
      for (let i = 0; i < 6 && p.outcome === 'ongoing'; i++) p = resolveTurnMulti(p, 'guard');
      expect(p.outcome).not.toBe('monster-fled');
    }
  });
});

describe('主人公のねらう敵は、ターンの頭で選んだ敵 (D-PARTY-001 レビュー)', () => {
  /** 速い仲間 (agi 999) が先に 敵0 (HP 1) を倒す。主人公 (agi 500) はそのあと動く。敵は動きが遅く 攻撃しない。 */
  function race(): BattleState {
    const ally = { ...mate('warrior', 8, 'はやて'), agi: 999, atk: 999 };
    const s0 = party(ally, 2);
    const enemies = s0.enemies!.map((e, i) => ({ ...e, name: `敵${i}`, agi: 0, atk: 0, def: 0, hp: i === 0 ? 1 : 500, maxHp: 500 }));
    const player = { ...s0.player, agi: 500, atk: 60, luk: 0 };
    return { ...s0, player, allies: [player, ally], enemies, monster: enemies[0]! };
  }

  it('仲間が先に 敵0 を倒しても、targetIndex=1 は はじめに選んだ 敵1 に当たる (2 は 敵2 で、空振りしない)', () => {
    for (const [targetIndex, hitName] of [[1, '敵1'], [2, '敵2']] as const) {
      const next = resolveTurnMulti(race(), 'attack', 4, 0, targetIndex);
      expect(next.enemies![0]!.hp).toBe(0);
      const hero = next.lastEvents.filter((e) => e.text.startsWith('ゆうしゃのこうげき!'));
      expect(hero).toHaveLength(1);
      expect(hero[0]!.text).toContain(`${hitName}に`);
    }
  });

  it('選んだ敵が先に倒れていたら、生きている先頭の敵に当たる', () => {
    const s = race();
    const next = resolveTurnMulti(s, 'attack', 4, 0, 0);
    const hero = next.lastEvents.filter((e) => e.text.startsWith('ゆうしゃのこうげき!'));
    expect(hero[0]!.text).toContain('敵1に');
  });
});
