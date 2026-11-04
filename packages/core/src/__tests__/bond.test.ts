/**
 * きずな (D-PARTY-004)。足し算は bondAfter 1 か所。
 * - 回復は 最大 HP の 25% ごとに +1・端数は bondHeal に持ちこす・上限 150・♥ が増えた人だけ deepened
 * - 戦闘の回復は、受けた人 ≠ 使った人 のときだけ healReceived に (あふれたぶんは数えない)
 * - 本編 = シナリオの questDone に出てくるクエスト
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  bondAfter, bondHearts, isMainQuest, setNpcs, playerCombatant, questBondPoints, resolveTurnMulti, setGameQuests, setScenario, startBattle, skillsForJob,
  type BattleState, type Combatant,
} from '../index.js';

const mate = (archetype: Parameters<typeof playerCombatant>[0], level: number, name = 'なかま'): Combatant => ({ ...playerCombatant(archetype, level, 1, name), job: { archetype, level } });

/** 主人公 (巫女 Lv5: 癒しの鈴 = 味方全体 20%) + 仲間 1 人。敵は動かない。 */
function mikoParty(ally: Combatant, heroHp?: number): BattleState {
  const base = startBattle('miko', 5, 5, 'ゆうしゃ', 1, 3, 0);
  const player = { ...base.player, ...(heroHp !== undefined ? { hp: heroHp } : {}) };
  const monster = { ...base.monster, atk: 0, int: 0, hp: 99999, maxHp: 99999 };
  return { ...base, player, monster, allies: [player, ally], enemies: [monster] };
}
const bellIndex = skillsForJob('miko', 5).findIndex((k) => k.kind === 'miko-heal-bell');

describe('bondAfter', () => {
  it('最大 HP の 50% ぶん回復を受けると +2。端数は bondHeal に持ちこし、次で +1 になる', () => {
    const r = bondAfter({ ids: ['a'] }, [{ id: 'a', healRatio: 0.5 }]);
    expect(r.bond).toEqual({ a: 2 });
    expect(r.bondHeal).toBeUndefined();
    const r2 = bondAfter({ ids: ['a'], ...r }, [{ id: 'a', healRatio: 0.2 }]);
    expect(r2.bond).toEqual({ a: 2 });
    expect(r2.bondHeal).toEqual({ a: 200 });
    const r3 = bondAfter({ ids: ['a'], ...r2 }, [{ id: 'a', healRatio: 0.1 }]);
    expect(r3.bond).toEqual({ a: 3 });
    expect(r3.bondHeal).toEqual({ a: 50 });
  });

  it('150 で止まる。ids にいない人は数えない', () => {
    const r = bondAfter({ ids: ['a'], bond: { a: 149 } }, [{ id: 'a', points: 10 }, { id: 'z', points: 10 }]);
    expect(r.bond).toEqual({ a: 150 });
  });

  it('♥ が増えた人だけ deepened (20・60・150)', () => {
    const r = bondAfter({ ids: ['a', 'b'], bond: { a: 19, b: 20 } }, [{ id: 'a', points: 1 }, { id: 'b', points: 1 }]);
    expect(r.deepened).toEqual([{ id: 'a', hearts: 1 }]);
    expect([0, 19, 20, 59, 60, 149, 150].map(bondHearts)).toEqual([0, 0, 1, 1, 2, 2, 3]);
  });
});

describe('戦闘の回復の記録 (healReceived)', () => {
  it('主人公の全体回復で、仲間に戻った HP ÷ 最大 HP が記録される。主人公自身のぶんは数えない', () => {
    const ally = mate('warrior', 5);
    ally.hp = 1;
    const s = resolveTurnMulti(mikoParty(ally, 1), 'skill', 11, bellIndex, 0);
    const a = s.allies![1]!;
    expect(s.healReceived?.[0] ?? 0).toBe(0);
    expect(s.healReceived?.[1]).toBeCloseTo((a.hp - 1) / a.maxHp, 6);
    expect(a.hp).toBeGreaterThan(1);
  });

  it('あふれたぶんは数えない (満タンの仲間は 0)', () => {
    const s = resolveTurnMulti(mikoParty(mate('warrior', 5), 1), 'skill', 11, bellIndex, 0);
    expect(s.healReceived?.[1] ?? 0).toBe(0);
  });

  it('仲間が自分を回復したぶん (全体回復の自分の分) は数えない', () => {
    const miko = mate('miko', 5, 'みこ');
    miko.hp = 1;
    const base = mikoParty(miko, 1);
    // 主人公はぼうぎょ。仲間の巫女が 癒しの鈴 (味方が 50% 未満) を使う。
    const s = resolveTurnMulti(base, 'guard', 77);
    expect(s.lastEvents.some((e) => e.text.includes('癒しの鈴'))).toBe(true);
    expect(s.healReceived?.[1] ?? 0).toBe(0);
    expect(s.healReceived?.[0]).toBeGreaterThan(0);
  });
});

describe('本編のクエスト', () => {
  afterEach(() => { setScenario(null); setGameQuests(null); setNpcs(null); });
  it('シナリオの questDone にあるクエストは本編 (+10)、ほかは +5', () => {
    const q = (id: string) => ({ id, title: id, npcId: 'n', intro: ['a'], done: ['b'], objective: { kind: 'collect' as const, itemId: 'herb', count: 1 } });
    setNpcs([{ id: 'n', name: 'むらびと', x: 1, y: 1, lines: ['やあ'] }]);
    setGameQuests([q('main'), q('side')]);
    setScenario([{ id: 'e', title: '章', when: [{ kind: 'questDone', questId: 'main' }], setFlags: ['ch'] }]);
    expect(isMainQuest('main')).toBe(true);
    expect(isMainQuest('side')).toBe(false);
    expect(questBondPoints('main')).toBe(10);
    expect(questBondPoints('side')).toBe(5);
  });
});
