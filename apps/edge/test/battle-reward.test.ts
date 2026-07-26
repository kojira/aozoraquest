import { describe, it, expect } from 'vitest';
import { applyBattleOutcome, type BattleOutcomeInput } from '../src/battle-reward';
import { MONSTERS, battleXpFor, jobXpToNextLevelFor, BATTLE_TUNING } from '@aozoraquest/core';
import { emptyState, type GameState } from '../src/game-state';

const base = (over: Partial<GameState> = {}): GameState => ({ ...emptyState('did:plc:alice', '2026-07-19T00:00:00.000Z'), power: 5, ...over });
// tier1 の実在モンスター (ドロップ表を持つ) を使う。
const mon = MONSTERS.find((m) => m.tier === 1 && m.drops.length > 0)!;
const input = (over: Partial<BattleOutcomeInput> = {}): BattleOutcomeInput => ({ outcome: 'win', monsterId: mon.id, archetype: 'warrior', luk: 10, rewardSeed: 12345, lossSeed: 67890, rewarded: true, ...over });

describe('battle-reward (fail-closed 報酬確定)', () => {
  it('rewarded=false は state を一切変えない (パワー無し=練習)', () => {
    const s = base({ power: 0, playerXp: 100 });
    for (const outcome of ['win', 'lose', 'draw', 'fled', 'monster-fled'] as const) {
      const { next } = applyBattleOutcome(s, input({ outcome, rewarded: false }));
      expect(next).toBe(s); // 参照ごと不変
    }
  });

  it('rewarded=false でも決着したなら unrewarded を返す (無言で終わらせない)', () => {
    // 「勝ったのに何も起きない」を黙って通すと、経験値が入ったように見えて実は
    // 入っていない、という最悪の見え方になる (オーナー指摘 2026-07-26)。
    const s = base({ power: 0 });
    for (const outcome of ['win', 'lose', 'draw', 'fled'] as const) {
      expect(applyBattleOutcome(s, input({ outcome, rewarded: false })).awarded, outcome).toEqual({ unrewarded: true });
    }
    // 敵が逃げたのは決着していないので、理由を出す対象でもない
    expect(applyBattleOutcome(s, input({ outcome: 'monster-fled', rewarded: false })).awarded).toEqual({});
  });

  it('勝ち: +XP (player/job 両方) + ドロップ + パワー1消費', () => {
    const s = base({ power: 3, playerXp: 50, jobXp: { warrior: 20 } });
    const { next, awarded } = applyBattleOutcome(s, input({ outcome: 'win' }));
    const xp = battleXpFor(mon.id);
    expect(next.playerXp).toBe(50); // #507/#508: プレイヤー XP は増えない (戦闘力に影響しないため)
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

  it('群れ勝ち (#453): enemyIds の頭数分 XP を合算し各敵でドロップ試行', () => {
    const s = base({ power: 3, playerXp: 0, jobXp: {} });
    const ids = [mon.id, mon.id, mon.id]; // 3体
    const { next, awarded } = applyBattleOutcome(s, input({ outcome: 'win', enemyIds: ids }));
    const expectXp = ids.reduce((a, id) => a + battleXpFor(id), 0);
    expect(next.jobXp.warrior).toBe(expectXp); // 3体分の XP 合算 (ジョブ XP のみ)
    expect(next.playerXp).toBe(0); // プレイヤー XP は増えない (#507/#508)
    expect(next.jobXp.warrior).toBe(expectXp);
    expect(awarded.xp).toBe(expectXp);
    expect(next.power).toBe(2); // パワー消費は 1 戦闘 1 回 (頭数に依らない)
    // 各敵で別 seed のドロップ試行 → 単体戦より総ドロップ数は増える傾向 (seed 固定なので決定的)。
    const solo = applyBattleOutcome(s, input({ outcome: 'win' }));
    expect(awarded.xp!).toBeGreaterThan(solo.awarded.xp!); // 3体 > 1体
  });

  it('群れ勝ち: 異なる id の敵は各 id の XP を正しく合算 (id 取り違えなし)', () => {
    const withDrops = MONSTERS.filter((m) => m.tier === 1 && m.drops.length > 0);
    const [a, b] = [withDrops[0]!, withDrops[1]!];
    const s = base({ playerXp: 0, jobXp: {} });
    const { next } = applyBattleOutcome(s, input({ outcome: 'win', enemyIds: [a.id, b.id] }));
    expect(next.jobXp.warrior).toBe(battleXpFor(a.id) + battleXpFor(b.id)); // A+B の XP (取り違えなら 2*A 等になる)
    expect(next.playerXp).toBe(0); // プレイヤー XP は増えない (#507/#508)
  });

  it('群れ報酬の後方互換: enemyIds 省略 = enemyIds:[monsterId] = 従来の単体計算', () => {
    const s = base();
    const omitted = applyBattleOutcome(s, input({ outcome: 'win' }));
    const single = applyBattleOutcome(s, input({ outcome: 'win', enemyIds: [mon.id] }));
    expect(omitted.next).toEqual(single.next); // 完全一致 (rewardSeed をそのまま使う)
    expect(omitted.awarded).toEqual(single.awarded);
  });

  it('負け: 素材ロス + パワー1消費 + 僅かな xpLose (§5)', () => {
    const s = base({ power: 2, playerXp: 80, jobXp: { warrior: 20 }, materials: { herb: 3, ore: 2 } });
    const { next, awarded } = applyBattleOutcome(s, input({ outcome: 'lose' }));
    expect(next.jobXp.warrior).toBe(20 + BATTLE_TUNING.xpLose); // 負けでも少しジョブ XP
    expect(next.playerXp).toBe(80); // プレイヤー XP は増えない (#507/#508)
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

  it('引き分け / 逃走 / 敵の逃走は決着扱いにしない (XP・ドロップ・パワー消費なし)', () => {
    // rewarded=true でも monster-fled は無報酬 = はぐれメタルに逃げられたら XP も素材もゼロ。
    const s = base({ power: 3, playerXp: 100, jobXp: { warrior: 20 }, materials: { herb: 2 } });
    for (const outcome of ['draw', 'fled', 'monster-fled'] as const) {
      const { next, awarded } = applyBattleOutcome(s, input({ outcome }));
      expect(next.power).toBe(3); // パワー温存
      expect(next.playerXp).toBe(100); // XP 変わらず
      expect(next.jobXp.warrior).toBe(20);
      expect(next.materials).toEqual({ herb: 2 }); // 素材変わらず
      expect(awarded).toEqual({});
    }
  });
});

describe('レベルアップで HP/MP 全回復 (#534)', () => {
  const at = (jobXp: number): GameState => ({
    did: 'did:plc:x', power: 10, playerXp: 0, jobXp: { warrior: jobXp }, materials: {},
    gear: [], x: 0, y: 0, carryHp: 3, carryMp: 1, version: 2, updatedAt: '',
  });
  const win = (state: GameState) => applyBattleOutcome(state, {
    outcome: 'win', monsterId: 'sky-slime', archetype: 'warrior', luk: 0,
    rewardSeed: 1, lossSeed: 2, rewarded: true,
  });

  it('Lv が上がった決着では leveledUp が返る', () => {
    // warrior の Lv2 しきい値の 1 手前から、そらいろスライム (XP3) を倒して超える
    const th = jobXpToNextLevelFor('warrior', 0).next;
    const r = win(at(th - 1));
    expect(r.awarded.leveledUp).toEqual({ from: 1, to: 2 });
  });

  it('Lv が上がらない決着では leveledUp を返さない', () => {
    const r = win(at(0));
    expect(r.awarded.leveledUp).toBeUndefined();
  });

  it('負けでも Lv が上がれば leveledUp が返る (僅かな XP が入るため)', () => {
    const th = jobXpToNextLevelFor('warrior', 0).next;
    const r = applyBattleOutcome(at(th - 1), {
      outcome: 'lose', monsterId: 'sky-slime', archetype: 'warrior', luk: 0,
      rewardSeed: 1, lossSeed: 2, rewarded: true,
    });
    expect(r.awarded.leveledUp).toEqual({ from: 1, to: 2 });
  });

  it('パワー無し (練習) では Lv も上がらない', () => {
    const th = jobXpToNextLevelFor('warrior', 0).next;
    const r = applyBattleOutcome(at(th - 1), {
      outcome: 'win', monsterId: 'sky-slime', archetype: 'warrior', luk: 0,
      rewardSeed: 1, lossSeed: 2, rewarded: false,
    });
    expect(r.awarded.leveledUp).toBeUndefined();
    expect(r.next.jobXp).toEqual({ warrior: th - 1 });
  });
});
