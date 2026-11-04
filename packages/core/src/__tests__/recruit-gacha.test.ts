/**
 * ギルドに来る冒険者のガチャ (D-PARTY-002)。
 * - 同じ seed なら同じ 3 人。職はかぶらず、役割 (前衛・術者・回復役) が 2 種類以上
 * - tier ごとの minLevel の幅、★の割合 (1 万回で ±2%)
 * - 表の名前は 12 字・ひとことは 40 字まで
 * - なじみの枠は、はずした人・パーティにいる人を出さない
 * - 仲間は自分の経験値と Lv を持つ (§11)。戦闘の経験値は人数で等分
 */
import { describe, expect, it } from 'vitest';
import {
  ARCHETYPES, MAX_RECRUIT_LINE, MAX_RECRUIT_NAME, RECRUIT_GACHA, RECRUIT_LINES, RECRUIT_NAMES, RECRUIT_ROLE,
  allyLevel, dailyRecruits, overLevelPower, jobLevelFromXp, partyCombatants, partyDefsOf, partyRecruitIssue, partyRecruitOf, recruitTierLevel,
  splitBattleXp, xpForAllyLevel, type DailyRecruitsInput, type RecruitDef,
} from '../index.js';

const input = (over: Partial<DailyRecruitsInput> = {}): DailyRecruitsInput => ({ seed: 12345, day: '2026-11-05', guild: 'g-1', roll: 0, tier: 1, named: [], skip: [], ...over });
const named = (id: string, archetype: RecruitDef['archetype'], minLevel?: number): RecruitDef => ({ id, name: `な${id}`, archetype, guild: 'g-1', line: 'よろしく。', ...(minLevel ? { minLevel } : {}) });

describe('dailyRecruits', () => {
  it('同じ seed なら同じ 3 人。seed が違えば違う顔ぶれ', () => {
    expect(dailyRecruits(input())).toEqual(dailyRecruits(input()));
    expect(dailyRecruits(input())).toHaveLength(3);
    const a = JSON.stringify(dailyRecruits(input({ seed: 1 })));
    expect(Array.from({ length: 20 }, (_, i) => JSON.stringify(dailyRecruits(input({ seed: i + 2 })))).some((b) => b !== a)).toBe(true);
  });

  it('id は 日付・ギルド・引き直しの回数・枠 から決まる', () => {
    expect(dailyRecruits(input({ roll: 2 })).map((c) => c.id)).toEqual(['g:2026-11-05:g-1:2:0', 'g:2026-11-05:g-1:2:1', 'g:2026-11-05:g-1:2:2']);
  });

  it('職はかぶらず、役割は 2 種類以上 (1000 通り)', () => {
    for (let s = 0; s < 1000; s++) {
      const jobs = dailyRecruits(input({ seed: s * 7919 })).map((c) => c.archetype);
      expect(new Set(jobs).size).toBe(3);
      expect(new Set(jobs.map((a) => RECRUIT_ROLE[a])).size).toBeGreaterThanOrEqual(2);
    }
  });

  it('minLevel は tier の適正 Lv + 0〜2 + ★の上乗せ (★1 +0・★2 +1・★3 +3)、Lv は +0/+1/+2', () => {
    expect([1, 2, 3, 4].map(recruitTierLevel)).toEqual([2, 5, 8, 11]);
    for (const tier of [1, 2, 3]) {
      const base = recruitTierLevel(tier);
      for (let s = 0; s < 300; s++) {
        for (const c of dailyRecruits(input({ seed: s, tier }))) {
          const jitter = c.minLevel - base - RECRUIT_GACHA.starMinLevel[c.star - 1]!;
          expect(jitter).toBeGreaterThanOrEqual(0);
          expect(jitter).toBeLessThanOrEqual(2);
          expect(c.level).toBe(base + jitter + RECRUIT_GACHA.starLevel[c.star - 1]!);
        }
      }
    }
  });

  it('★の割合は 70% / 25% / 5% (1 万回で ±2%)', () => {
    const n = [0, 0, 0];
    let all = 0;
    for (let s = 0; s < 3334; s++) for (const c of dailyRecruits(input({ seed: s }))) { n[c.star - 1]!++; all++; }
    expect(all).toBeGreaterThanOrEqual(10000);
    expect(Math.abs(n[0]! / all - 0.7)).toBeLessThan(0.02);
    expect(Math.abs(n[1]! / all - 0.25)).toBeLessThan(0.02);
    expect(Math.abs(n[2]! / all - 0.05)).toBeLessThan(0.02);
  });

  it('なじみは 2 割ほどで 1 枠目に入る (★2・minLevel は定義の値)。はずした人・パーティにいる人は出ない', () => {
    const list = [named('r-1', 'warrior', 4)];
    let hits = 0;
    for (let s = 0; s < 2000; s++) {
      const got = dailyRecruits(input({ seed: s, named: list }));
      const n = got.find((c) => c.named);
      if (n) { hits++; expect([n.id, n.star, n.minLevel, n.archetype]).toEqual(['r-1', 2, 4, 'warrior']); expect(got[0]).toBe(n); }
      const skipped = dailyRecruits(input({ seed: s, named: list, skip: ['r-1'] }));
      expect(skipped.some((c) => c.id === 'r-1')).toBe(false);
      // はずした人の枠だけが生成の人になり、ほかの枠は変わらない
      expect(skipped.slice(1)).toEqual(got.slice(1));
    }
    expect(hits / 2000).toBeGreaterThan(0.17);
    expect(hits / 2000).toBeLessThan(0.23);
  });

  it('同じギルドの 3 人で名前がかぶらない', () => {
    for (let s = 0; s < 500; s++) expect(new Set(dailyRecruits(input({ seed: s })).map((c) => c.name)).size).toBe(3);
  });
});

describe('名前とひとことの表', () => {
  it(`名前は 80 個・${MAX_RECRUIT_NAME} 字まで・重複なし。ひとことは 全職に 2〜3 行・${MAX_RECRUIT_LINE} 字まで`, () => {
    expect(RECRUIT_NAMES).toHaveLength(80);
    expect(new Set(RECRUIT_NAMES).size).toBe(80);
    for (const n of RECRUIT_NAMES) expect(n.length).toBeLessThanOrEqual(MAX_RECRUIT_NAME);
    for (const a of ARCHETYPES) {
      expect(RECRUIT_LINES[a].length).toBeGreaterThanOrEqual(2);
      expect(RECRUIT_LINES[a].length).toBeLessThanOrEqual(3);
      for (const l of RECRUIT_LINES[a]) { expect(l.length).toBeLessThanOrEqual(MAX_RECRUIT_LINE); expect(l).not.toMatch(/[\r\n{}]/); }
    }
  });
});

describe('仲間の経験値と Lv (§11)', () => {
  it('入れた仲間は 候補の Lv から始まる (その Lv になったばかりの経験値)', () => {
    for (const c of dailyRecruits(input({ tier: 3 }))) {
      const m = partyRecruitOf(c);
      expect(m.xp).toBe(xpForAllyLevel(c.archetype, c.level));
      expect(allyLevel(m.archetype, m.xp)).toBe(c.level);
      expect(allyLevel(m.archetype, m.xp - 1)).toBe(c.level - 1);
      expect(partyRecruitIssue(m)).toBeNull();
    }
  });

  it('経験値がたまると Lv が上がり、戦闘での強さもその Lv になる', () => {
    const c = dailyRecruits(input())[0]!;
    const m = partyRecruitOf(c);
    const up = { ...m, xp: xpForAllyLevel(m.archetype, c.level + 1) };
    const defs = partyDefsOf({ ids: [m.id], members: [up] }, () => undefined, 1);
    expect(defs[0]!.level).toBe(c.level + 1);
    expect(partyCombatants(defs, 1)[0]!.job).toEqual({ archetype: m.archetype, level: c.level + 1 });
  });

  it('戦闘の経験値は 人数で等分し、端数は切り捨て (3 人で 100 → 33 ずつ)', () => {
    expect(splitBattleXp(100, 3)).toBe(33);
    expect(splitBattleXp(2, 3)).toBe(0);
    expect(splitBattleXp(10, 1)).toBe(10);
  });

  it('partyDefsOf: 生成の仲間は members、なじみは recruitById と party.xp (無ければ主人公の Lv)。知らない id は落とす', () => {
    const r = named('r-1', 'miko');
    const byId = (id: string) => (id === 'r-1' ? r : undefined);
    const m = partyRecruitOf(dailyRecruits(input())[1]!);
    const defs = partyDefsOf({ ids: ['gone', m.id, 'r-1'], members: [m] }, byId, 6);
    expect(defs.map((d) => d.id)).toEqual([m.id, 'r-1']);
    expect(defs[1]!.level).toBe(6);
    const withXp = partyDefsOf({ ids: ['r-1'], xp: { 'r-1': xpForAllyLevel('miko', 9) } }, byId, 6);
    expect(withXp[0]!.level).toBe(9);
    expect(jobLevelFromXp(withXp[0]!.xp, 'miko')).toBe(9);
  });

  it('Lv の足りない候補を迎えるパワーは 足りない 1 Lv につき 5 (§14)。足りていれば 0', () => {
    expect(RECRUIT_GACHA.overLevelPowerPerLv).toBe(5);
    expect(overLevelPower(10, 6)).toBe(20);
    expect(overLevelPower(7, 6)).toBe(5);
    expect(overLevelPower(6, 6)).toBe(0);
    expect(overLevelPower(3, 6)).toBe(0);
  });
});
