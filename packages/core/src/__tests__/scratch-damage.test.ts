import { describe, it, expect } from 'vitest';
import { startBattle, runAutoBattle, resolveTurn, BATTLE_TUNING, MONSTERS, monsterCombatant } from '../index.js';

/**
 * **かすりダメージ** (オーナー報告 2026-07-27
 * 「レベル5でこの装備だと tier1 だと敵なしで賢者なのに余裕で殴り殺しできます」)。
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

  it('grade2 防具の Lv5 賢者は tier1 で無敵にならない (回復なしの連戦が有限)', () => {
    let worst = 0;
    for (let t = 0; t < 20; t++) {
      let hp: number | undefined, mp: number | undefined, n = 0;
      // 300 戦まで見て、そこまで無傷なら「実質無限」= 退行とみなす。
      for (let b = 0; b < 300; b++) {
        const s = startBattle('sage', 5, 1, 'x', 1, t * 977 + b, 0,
          hp !== undefined ? { hp, mp: mp! } : undefined, { gear: GRADE2_ROBE });
        const r = runAutoBattle(s);
        if (r.outcome !== 'win') break;
        n++; hp = r.player.hp; mp = r.player.mp;
      }
      worst = Math.max(worst, n);
    }
    expect(worst, '回復なしで 300 戦連勝できるなら不死身 (かすりが効いていない)').toBeLessThan(300);
  });

  it('比率は攻撃力比例で、0 は ironDef だけの特権', () => {
    expect(BATTLE_TUNING.minDamage).toBe(0);
    expect(BATTLE_TUNING.scratchRatio).toBeGreaterThan(0);
    // メタル以外に ironDef を付けていない (付けた敵は不死身の抜け道になる)
    const iron = MONSTERS.filter((m) => m.flatDef !== undefined).map((m) => m.id);
    expect(iron).toEqual(['stray-slime']);
  });
});
