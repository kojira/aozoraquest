import { describe, it, expect } from 'vitest';
import { applyBattleOutcome, type BattleOutcomeInput } from '../src/battle-reward';
import { MONSTERS, battleXpFor, BATTLE_TUNING } from '@aozoraquest/core';
import { emptyState, type GameState } from '../src/game-state';

const base = (over: Partial<GameState> = {}): GameState => ({ ...emptyState('did:plc:alice', '2026-07-19T00:00:00.000Z'), power: 5, ...over });
// tier1 の実在モンスター (ドロップ表を持つ) を使う。
const mon = MONSTERS.find((m) => m.tier === 1 && m.drops.length > 0)!;
const input = (over: Partial<BattleOutcomeInput> = {}): BattleOutcomeInput => ({ outcome: 'win', monsterId: mon.id, archetype: 'warrior', luk: 10, rewardSeed: 12345, lossSeed: 67890, rewarded: true, ...over });

describe('battle-reward (fail-closed 報酬確定)', () => {
  it('rewarded=false は勝敗どちらも何も変えない (パワー無し=練習)', () => {
    const s = base({ power: 0, playerXp: 100 });
    for (const outcome of ['win', 'lose', 'draw', 'fled'] as const) {
      const { next, awarded } = applyBattleOutcome(s, input({ outcome, rewarded: false }));
      expect(next).toBe(s); // 参照ごと不変
      expect(awarded).toEqual({});
    }
  });

  it('勝ち: +XP (player/job 両方) + ドロップ + パワー1消費', () => {
    const s = base({ power: 3, playerXp: 50, jobXp: { warrior: 20 } });
    const { next, awarded } = applyBattleOutcome(s, input({ outcome: 'win' }));
    const xp = battleXpFor(mon.id);
    expect(next.playerXp).toBe(50 + xp);
    expect(next.jobXp.warrior).toBe(20 + xp);
    expect(next.power).toBe(2); // 3-1
    expect(awarded.xp).toBe(xp);
    expect(awarded.powerSpent).toBe(1);
    // ドロップは materials に加算 (item→個数)
    for (const item of awarded.drops ?? []) expect(next.materials[item]).toBeGreaterThanOrEqual(1);
  });

  it('勝ち: 決定的 (同じ seed なら同じドロップ) = リトライ安全', () => {
    const s = base();
    const a = applyBattleOutcome(s, input({ outcome: 'win' }));
    const b = applyBattleOutcome(s, input({ outcome: 'win' }));
    expect(a.awarded.drops).toEqual(b.awarded.drops);
    expect(a.next).toEqual(b.next);
  });

  it('負け: 素材ロス + パワー1消費 + 僅かな xpLose (§5)', () => {
    const s = base({ power: 2, playerXp: 80, jobXp: { warrior: 20 }, materials: { herb: 3, ore: 2 } });
    const { next, awarded } = applyBattleOutcome(s, input({ outcome: 'lose' }));
    expect(next.playerXp).toBe(80 + BATTLE_TUNING.xpLose); // 負けでも少し XP (player/job 両方)
    expect(next.jobXp.warrior).toBe(20 + BATTLE_TUNING.xpLose);
    expect(awarded.xp).toBe(BATTLE_TUNING.xpLose);
    expect(next.power).toBe(1); // 2-1
    expect(awarded.powerSpent).toBe(1);
    // materialsLost があれば materials が減っている
    if ((awarded.materialsLost ?? []).length) {
      const totalBefore = 3 + 2;
      const totalAfter = Object.values(next.materials).reduce((a, b) => a + b, 0);
      expect(totalAfter).toBeLessThan(totalBefore);
    }
  });

  it('素材が 0 になったらキーごと消す (負の在庫を作らない)', () => {
    const s = base({ materials: { herb: 1 } });
    const { next } = applyBattleOutcome(s, input({ outcome: 'lose', luk: 0 }));
    for (const v of Object.values(next.materials)) expect(v).toBeGreaterThan(0);
  });

  it('引き分け / 逃走は決着扱いにしない (パワーも消費しない)', () => {
    const s = base({ power: 3 });
    for (const outcome of ['draw', 'fled'] as const) {
      const { next, awarded } = applyBattleOutcome(s, input({ outcome }));
      expect(next.power).toBe(3);
      expect(awarded).toEqual({});
    }
  });
});
