import { describe, it, expect } from 'vitest';
import { startBattle, runAutoBattle, resolveTurn, BATTLE_TUNING, MONSTERS, monsterCombatant } from '../index.js';

/**
 * **かすりダメージ**。
 *
 * `minDamage = 0` はメタル系の identity のために入れたものだが、**プレイヤーの守備でも
 * 同じ崖に届いてしまっていた**。grade2 の防具 1 点で Lv5 の守備が 2 → 18 になり、
 * tier1 のモンスター (実効 atk 最大 9) は `9×0.9 < 18×0.45` で 1 も通らない。
 * 実測で被ダメ 0・無傷率 100%・**連戦 300 戦打ち切りまで無敗** = 実質不死身だった。
 *
 * ここで固定するのは 2 つの相反する要求:
 *  - メタル系は**今までどおり通常攻撃 0** (identity を壊さない)
 *  - 普通の守備力で 0 に沈むのは**禁止** (装備で不死身にならない)
 */

const GRADE2_ROBE = { armor: { id: 'ar-scholar', level: 1 } } as const;

describe('かすりダメージ (装備で不死身にならない)', () => {
  it('メタル系は通常攻撃が 0 のまま (かすりの対象外)', () => {
    const metal = monsterCombatant(MONSTERS.find((m) => m.id === 'stray-slime')!, 0, () => 0.5);
    expect(metal.ironDef).toBe(true);

    // 実際に殴ってみて、会心以外は 1 も通っていないこと。最高レベルの物理職で試す。
    // `lastEvents` は 1 ターンぶんしか残らないので、たたかうを 1 手ずつ進めて毎ターン見る。
    let nonCritHits = 0, critHits = 0, turns = 0;
    for (let seed = 0; seed < 300; seed++) {
      let s = startBattle('shogun', 30, 1, 'x', 2, seed, 0, undefined, { monsterId: 'stray-slime' });
      for (let i = 0; i < 12 && s.outcome === 'ongoing'; i++) {
        const before = s.monster.hp;
        s = resolveTurn(s, 'attack');
        turns++;
        const dealt = before - s.monster.hp;
        if (dealt <= 0) continue;
        // 会心 (守備無視) だけが貫通できる。それ以外でダメージが入っていたら identity 崩壊。
        if (s.lastEvents.some((e) => e.actor === 'player' && e.text.includes('会心の一撃'))) critHits++;
        else nonCritHits++;
      }
    }
    expect(turns, 'そもそも殴れていない = テストが空回り').toBeGreaterThan(300);
    expect(critHits, '会心は通るはず (通らないならテストが敵を取り違えている)').toBeGreaterThan(0);
    expect(nonCritHits, 'メタルに会心以外でダメージが通ってはいけない').toBe(0);
  });

  it('grade2 防具の Lv5 賢者でも tier1 の敵の攻撃が通る (無傷率 100% にならない)', () => {
    // **「連戦が有限か」で測ってはいけない。** レベルアップ全回復があるので、わずかでも
    // 削られる状態なら連戦数は「レベルが上がる速さ」で決まってしまい、かすりが効いて
    // いるかどうかを見ていない。**1 戦あたり削られるか**を直接見る。
    let unhurt = 0, lost = 0;
    const N = 200;
    for (let t = 0; t < N; t++) {
      const s = startBattle('sage', 5, 1, 'x', 1, t * 7919, 0, undefined, { gear: GRADE2_ROBE });
      const r = runAutoBattle(s);
      const d = s.player.maxHp - r.player.hp;
      if (d === 0) unhurt++;
      lost += d;
    }
    // 修正前は 200/200 が無傷・被ダメ合計 0 だった (守備 18 に対し tier1 の実効 atk は 5〜6 で
    // `6×0.9 < 18×0.45` → 1 も通らない)。装備で有利になるのは当然だが、**一度も当たらない**
    // のは別物なので、そこだけを固定する。
    expect(lost, 'grade2 防具を着けると tier1 から 1 ダメージも受けない = 不死身').toBeGreaterThan(0);
    expect(unhurt / N, '無傷率が 100% = かすりが効いていない').toBeLessThan(0.95);
  });

  it('ぼうぎょすると被ダメが増える、が起きない (床を減算の段階に置いていること)', () => {
    // 床を全ての軽減倍率の**後**に max で入れると、0 沈み域でぼうぎょ半減・属性耐性・
    // 被ダメ軽減パッシブが丸ごと無効になり、素受けより被ダメが大きくなる組み合わせが
    // 実際に 66 通り存在した (レビュー実測: ぬまの大蛇 atk15 vs def28 → 素受け 1 / ぼうぎょ 2)。
    const t = BATTLE_TUNING;
    const dmg = (atkV: number, defV: number, guard: boolean, roll: number) => {
      const floor = atkV * t.scratchRatio; // ironDef でない相手
      let d = Math.max(floor, atkV * t.atkCoef - defV * t.defCoef) * roll;
      if (guard) d *= t.guardReduction;
      return Math.max(0, Math.round(d));
    };
    const inversions: string[] = [];
    for (const m of MONSTERS) {
      if (m.flatDef !== undefined) continue;
      const a = monsterCombatant(m, 0, () => 0.5).atk;
      for (let def = 0; def <= 140; def++) {
        for (const roll of [0.85, 0.925, 1.0, 1.075, 1.15]) {
          if (dmg(a, def, true, roll) > dmg(a, def, false, roll)) inversions.push(`${m.name} atk${a} def${def}`);
        }
      }
    }
    expect(inversions.slice(0, 3), 'ぼうぎょで被ダメが増える組み合わせ').toEqual([]);
  });

  it('比率は攻撃力比例で、0 は ironDef だけの特権', () => {
    expect(BATTLE_TUNING.minDamage).toBe(0);
    expect(BATTLE_TUNING.scratchRatio).toBeGreaterThan(0);
    // メタル以外に ironDef を付けていない (付けた敵は不死身の抜け道になる)
    const iron = MONSTERS.filter((m) => m.flatDef !== undefined).map((m) => m.id);
    expect(iron).toEqual(['stray-slime']);
  });
});
