/**
 * 回復の量の幅と うん (D-HEAL-RANGE-001)。
 * どうぐ・とくぎ・起こしたときの HP は もとの量 × 0.85〜1.15 の整数 (1 以上)。使う人の うん で上振れし、幅は超えない。
 * 全回復のとくぎは幅なしで最大 HP。戦闘はターンの乱数で決まる (同じシードなら同じ)。
 */
import { describe, expect, it } from 'vitest';
import {
  BATTLE_TUNING, SKILLS, createRng, itemHealAmount, playerCombatant, resolveTurnMulti, rolledHeal, spreadHeal, startBattle,
  type BattleState, type Combatant,
} from '../index.js';

const lo = (base: number) => Math.round(base * (1 - BATTLE_TUNING.healSpread));
/** 上の端は 1.15 の すこし手前まで (u < 1) なので、ちょうど .5 は切り下がる (やくそう 10 は 9〜11)。 */
const hi = (base: number) => Math.round(base * (1 + BATTLE_TUNING.healSpread) - 1e-9);
const meanFactor = (luk: number, n = 20000) => {
  const rng = createRng(12345);
  let sum = 0;
  for (let i = 0; i < n; i++) sum += spreadHeal(1000, luk, rng);
  return sum / n / 1000;
};

describe('spreadHeal (幅と うん)', () => {
  it('幅は ±healSpread (0.15)', () => {
    expect(BATTLE_TUNING.healSpread).toBe(0.15);
  });

  it('どの うん でも幅の中に収まり、シードを変えると下限と上限が出る', () => {
    for (const luk of [0, 30, 60, 100, 250]) {
      const seen = new Set<number>();
      for (let seed = 0; seed < 3000; seed++) {
        const v = spreadHeal(10, luk, createRng(seed));
        expect(v).toBeGreaterThanOrEqual(lo(10));
        expect(v).toBeLessThanOrEqual(hi(10));
        seen.add(v);
      }
      expect(seen.has(hi(10)), `luk ${luk} の上限`).toBe(true);
      if (luk <= 60) expect(seen.has(lo(10)), `luk ${luk} の下限`).toBe(true);
    }
  });

  it('同じシードなら同じ量', () => {
    for (let seed = 0; seed < 50; seed++) expect(spreadHeal(70, 40, createRng(seed))).toBe(spreadHeal(70, 40, createRng(seed)));
  });

  it('うん が高いほど平均が上がる (0 で約 1.00、60 で約 1.07、100 で約 1.10)', () => {
    const m0 = meanFactor(0), m60 = meanFactor(60), m100 = meanFactor(100);
    expect(m0).toBeGreaterThan(0.99);
    expect(m0).toBeLessThan(1.01);
    expect(m60).toBeGreaterThan(1.06);
    expect(m60).toBeLessThan(1.085);
    expect(m100).toBeGreaterThan(1.085);
    expect(m100).toBeLessThan(1.11);
    expect(m60).toBeGreaterThan(m0);
    expect(m100).toBeGreaterThan(m60);
  });

  it('少ない量でも 1 以上', () => {
    for (let seed = 0; seed < 200; seed++) expect(spreadHeal(1, 0, createRng(seed))).toBe(1);
  });
});

describe('rolledHeal (とくぎ・どうぐの heal 効果)', () => {
  it('割合の回復は maxHp × 割合 の幅の中、全回復は いつも maxHp', () => {
    for (let seed = 0; seed < 500; seed++) {
      const v = rolledHeal({ kind: 'heal', ratio: 0.35 }, 200, 30, createRng(seed));
      expect(v).toBeGreaterThanOrEqual(lo(70));
      expect(v).toBeLessThanOrEqual(hi(70));
      expect(rolledHeal(SKILLS['full-heal-one']!.effects[0] as never, 200, 100, createRng(seed))).toBe(200);
      expect(rolledHeal(SKILLS['full-heal-all']!.effects[0] as never, 200, 0, createRng(seed))).toBe(200);
    }
  });

  it('itemHealAmount は roll を渡すと幅つき、渡さなければ もとの量', () => {
    expect(itemHealAmount('herb')).toBe(BATTLE_TUNING.herbHealAmount);
    const v = itemHealAmount('herb', { luk: 0, rng: createRng(1) });
    expect(v).toBeGreaterThanOrEqual(lo(BATTLE_TUNING.herbHealAmount));
    expect(v).toBeLessThanOrEqual(hi(BATTLE_TUNING.herbHealAmount));
  });
});

const mate = (archetype: Parameters<typeof playerCombatant>[0], level: number, name: string): Combatant => ({ ...playerCombatant(archetype, level, 1, name), job: { archetype, level } });

/** 主人公 (巫女 Lv25) + 弱った仲間 2 人 vs 動かない敵。 */
function hurtParty(seed: number): BattleState {
  const base = startBattle('miko', 25, 1, 'ゆうしゃ', 1, seed, 3, undefined, { tonics: 0 });
  const monster = { ...base.monster, atk: 0, agi: 0, hp: 99999, maxHp: 99999 };
  const a1 = { ...mate('warrior', 25, 'カイト'), hp: 1 };
  const a2 = { ...mate('mage', 25, 'ソラ'), hp: 1 };
  return { ...base, player: { ...base.player, hp: 1 }, monster, allies: [{ ...base.player, hp: 1 }, a1, a2], enemies: [monster] };
}

describe('戦闘 (ターンの乱数で決まる)', () => {
  it('とくぎの回復: 幅の中で、同じシードなら同じ、シードで変わる', () => {
    const s = hurtParty(3);
    const i = s.playerSkills.findIndex((k) => k.kind === 'miko-heal-bell');
    expect(i).toBeGreaterThanOrEqual(0);
    const seen = new Set<number>();
    for (let seed = 0; seed < 60; seed++) {
      const kaito = resolveTurnMulti(s, 'skill', seed, i, 0).allies![1]!;
      const base = Math.round(kaito.maxHp * 0.2);
      expect(kaito.hp - 1).toBeGreaterThanOrEqual(lo(base));
      expect(kaito.hp - 1).toBeLessThanOrEqual(hi(base));
      expect(resolveTurnMulti(s, 'skill', seed, i, 0).allies![1]!.hp).toBe(kaito.hp);
      seen.add(kaito.hp);
    }
    expect(seen.size).toBeGreaterThan(1);
  });

  it('全回復のとくぎ (みんな) は いつも最大 HP まで', () => {
    const s = hurtParty(3);
    const i = s.playerSkills.findIndex((k) => k.kind === 'full-heal-all');
    expect(i).toBeGreaterThanOrEqual(0);
    for (let seed = 0; seed < 20; seed++) {
      const next = resolveTurnMulti(s, 'skill', seed, i, 0);
      for (const a of next.allies!) expect(a.hp).toBe(a.maxHp);
    }
  });

  it('やくそう: 使う人の うん で上振れする (シードをそろえて うん だけ変える)', () => {
    let low = 0, high = 0;
    for (let seed = 0; seed < 300; seed++) {
      const s = hurtParty(seed);
      const withLuk = (luk: number): BattleState => { const p = { ...s.player, luk }; return { ...s, player: p, allies: [p, ...s.allies!.slice(1)] }; };
      low += resolveTurnMulti(withLuk(0), 'herb', seed, 0, 0).player.hp;
      high += resolveTurnMulti(withLuk(100), 'herb', seed, 0, 0).player.hp;
    }
    expect(high).toBeGreaterThan(low);
  });
});
