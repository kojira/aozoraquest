import { describe, it, expect } from 'vitest';
import { BATTLE_TUNING, playerCombatant, MONSTERS, monsterCombatant } from '../battle.js';
import { JOBS } from '../jobs.js';
import { gearBonus, gearBonusFromGear } from '../equipment.js';

describe('playerCombatant', () => {
  it('レベルが上がるとステータスと HP が伸びる', () => {
    const lv1 = playerCombatant('warrior', 1, 1, '戦士');
    const lv10 = playerCombatant('warrior', 10, 20, '戦士');
    expect(lv10.atk).toBeGreaterThan(lv1.atk);
    expect(lv10.maxHp).toBeGreaterThan(lv1.maxHp);
    expect(lv1.hp).toBe(lv1.maxHp);
  });

  // つよさ画面の「そうび +N」は combat − combatBase で内訳を出す。この差が gear
  // ボーナスそのものであることを固定する (base 引数が drift すると内訳が壊れる)
  it('装備込み − 装備なし = gearBonus (つよさ画面の内訳の不変条件)', () => {
    // baseArgs は 5 要素 (末尾 = baseStats)。gear は 7 番目の引数に入れる
    const args = ['warrior', 5, 10, '戦士', undefined] as const;
    const gear = { weapon: { id: 'wp-axe', level: 0 }, charm: { id: 'ch-life', level: 0 } };
    const withGear = playerCombatant(...args, undefined, gear);
    const bare = playerCombatant(...args);
    const bonus = gearBonusFromGear('warrior', gear);
    expect(withGear.atk - bare.atk).toBe(bonus.atk);
    expect(withGear.def - bare.def).toBe(bonus.def);
    expect(withGear.maxHp - bare.maxHp).toBe(bonus.maxHp);
    expect(bonus.maxHp).toBeGreaterThan(0); // いのちのペンダントで HP 内訳が実際に出る
  });
});

describe('成長モデル (#518)', () => {
  it('たいりょく (vit) が HP の単一の出所 — HP = hpBase + vit * hpVitScale', () => {
    // 「将軍が賢者より HP が低い」逆転 (HP が まもり 由来だった旧実装) の再発防止。
    for (const j of JOBS) {
      for (const lv of [1, 10, 30, 50]) {
        const c = playerCombatant(j.id, lv, 1, 'x');
        expect(c.maxHp, `${j.id} Lv${lv}`).toBe(
          Math.round(BATTLE_TUNING.hpBase + c.vit * BATTLE_TUNING.hpVitScale),
        );
      }
    }
    // vit の順序がそのまま HP の順序になる (同レベル比較)
    const byVit = [...JOBS].sort((a, b) => b.vit - a.vit).map((j) => j.id);
    const hps = byVit.map((id) => playerCombatant(id, 30, 1, 'x').maxHp);
    expect(hps).toEqual([...hps].sort((a, b) => b - a));
    // 将軍 > 賢者 (逆転していないこと自体を名指しで固定)
    expect(playerCombatant('shogun', 30, 1, 'x').maxHp)
      .toBeGreaterThan(playerCombatant('sage', 30, 1, 'x').maxHp);
  });

  it('レベルを上げると全職の HP が必ず伸び、他ステも数レベルで必ず動く (成長の手応え)', () => {
    // 旧モデルは jobLevelScale 4% しか乗らず、14/16 職が「HP +0」のレベルが大半だった。
    // **HP は毎レベル必ず伸びる** (vit 18〜45 × statGrow 0.05 × hpVitScale 2 = 最低 +1.8)。
    // こうげき/MP は比率が低い職 (魔法使い atk 7 = 0.35/Lv) だと毎レベルは動かない。
    // DQ でも魔法使いの ちから はほとんど伸びないので、これは仕様。3 レベルの幅で固定する。
    for (const j of JOBS) {
      for (const lv of [1, 5, 15, 29, 49]) {
        const a = playerCombatant(j.id, lv, 1, 'x');
        expect(playerCombatant(j.id, lv + 1, 1, 'x').maxHp, `${j.id} Lv${lv}→${lv + 1} HP`)
          .toBeGreaterThan(a.maxHp);
        const c3 = playerCombatant(j.id, lv + 3, 1, 'x');
        expect(c3.maxMp, `${j.id} Lv${lv}→${lv + 3} MP`).toBeGreaterThan(a.maxMp);
        expect(c3.atk, `${j.id} Lv${lv}→${lv + 3} atk`).toBeGreaterThan(a.atk);
      }
    }
  });

  it('まもりだけ伸びを抑え、守備は防具が主役になっている', () => {
    // 素の まもり は他ステより明確に伸びが遅い (docs/19 §6.4.5)。
    const g1 = playerCombatant('guardian', 1, 1, 'x');
    const g50 = playerCombatant('guardian', 50, 1, 'x');
    expect((g50.def - g1.def) / (g50.atk - g1.atk)).toBeLessThan(0.6);
    // grade1 防具 (+5) が Lv1 の素の まもり を上回る = 序盤は防具が守備の主役
    expect(gearBonus('guardian', ['ar-cloth']).def).toBeGreaterThan(g1.def);
  });

  it('statFloor があるので低 atk 職でも tier1 に damage を通せる', () => {
    // 下駄が無いと比率 7 (魔法使い) は Lv1 で atk 1 に潰れ、減算式で 0 に沈んで詰む。
    for (const j of JOBS) {
      const p = playerCombatant(j.id, 1, 1, 'x');
      const m = monsterCombatant(MONSTERS.find((x) => x.id === 'sky-slime')!, 0, () => 0.5);
      expect(p.atk * BATTLE_TUNING.atkCoef - m.def * BATTLE_TUNING.defCoef, `${j.id}`).toBeGreaterThan(0);
    }
  });

  it('プレイヤーレベルは戦闘値に一切影響しない (#507)', () => {
    for (const j of JOBS) {
      for (const jobLv of [1, 20]) {
        const a = playerCombatant(j.id, jobLv, 1, 'x');
        const b = playerCombatant(j.id, jobLv, 99, 'x');
        expect({ ...b }, `${j.id} jobLv${jobLv}`).toEqual({ ...a });
      }
    }
  });
});
