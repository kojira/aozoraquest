import { describe, it, expect } from 'vitest';
import {
  STATUS_REGISTRY,
  applyBeforeAct,
  applyDodgeCalc,
  applyPowerCalc,
  applyCritCalc,
  applyIncomingCalc,
  applyOnDamaged,
  applyModifyHit,
  tickStatuses,
  clearActedStatuses,
  clearHitStatuses,
  applyStatus,
  type HookCtx,
  type StatusInstance,
} from '../statuses.js';
import type { Combatant } from '../battle.js';

function c(over: Partial<Combatant> = {}): Combatant {
  return {
    name: 'c',
    maxHp: 100,
    hp: 100,
    maxMp: 10,
    mp: 10,
    atk: 20,
    def: 10,
    agi: 15,
    int: 20,
    luk: 10,
    vit: 0,
    guarding: false,
    parrying: false,
    charging: false,
    focus: 0,
    statuses: [],
    passives: [],
    ...over,
  };
}
const ctx = (): HookCtx => ({ rng: () => 0.5, events: [] });
const st = (id: StatusInstance['id'], turns = 3, magnitude?: number): StatusInstance =>
  magnitude === undefined ? { id, turns } : { id, turns, magnitude };

describe('状態異常エンジン (#452)', () => {
  it('全 StatusId が STATUS_REGISTRY に登録され id が一致', () => {
    for (const id of Object.keys(STATUS_REGISTRY) as Array<keyof typeof STATUS_REGISTRY>) {
      expect(STATUS_REGISTRY[id].id).toBe(id);
    }
  });

  // ── no-op 保証 (behavior-preserving の要) ──
  it('状態なしなら全ディスパッチが入力そのまま (no-op)', () => {
    const bare = c();
    expect(applyBeforeAct(bare, ctx())).toBe(false);
    expect(applyDodgeCalc(0.2, bare, ctx())).toBe(0.2);
    expect(applyPowerCalc(1, bare, ctx())).toBe(1);
    expect(applyCritCalc(false, bare, ctx())).toBe(false);
    expect(applyIncomingCalc(1, bare, ctx())).toBe(1);
    const before = bare.hp;
    tickStatuses(bare, ctx());
    expect(bare.hp).toBe(before);
  });

  it('statuses undefined (旧 sealed state) でも落ちず no-op', () => {
    const legacy = c();
    delete (legacy as { statuses?: unknown }).statuses;
    delete (legacy as { passives?: unknown }).passives;
    expect(applyBeforeAct(legacy, ctx())).toBe(false);
    expect(applyPowerCalc(1, legacy, ctx())).toBe(1);
    expect(() => tickStatuses(legacy, ctx())).not.toThrow();
  });

  // ── 各状態の効果 ──
  it('poison: turnEnd で magnitude ダメージ + turns 減衰', () => {
    const p = c({ statuses: [st('poison', 2, 5)] });
    tickStatuses(p, ctx());
    expect(p.hp).toBe(95);
    expect(p.statuses![0]!.turns).toBe(1);
    tickStatuses(p, ctx());
    expect(p.hp).toBe(90);
    expect(p.statuses).toHaveLength(0); // turns 0 で除去
  });

  it('sleep/stun/tumble/restraint: beforeAct で行動不可', () => {
    for (const id of ['sleep', 'stun', 'tumble', 'restraint'] as const) {
      expect(applyBeforeAct(c({ statuses: [st(id)] }), ctx())).toBe(true);
    }
  });

  it('tumble: 被ダメ 1.2 倍', () => {
    expect(applyIncomingCalc(1, c({ statuses: [st('tumble')] }), ctx())).toBeCloseTo(1.2);
  });

  it('hidden: 回避を底上げ・行動 or 被弾で解除', () => {
    expect(applyDodgeCalc(0.1, c({ statuses: [st('hidden')] }), ctx())).toBe(0.75);
    const acted = c({ statuses: [st('hidden')] });
    clearActedStatuses(acted);
    expect(acted.statuses).toHaveLength(0);
    const hit = c({ statuses: [st('hidden')] });
    clearHitStatuses(hit);
    expect(hit.statuses).toHaveLength(0);
  });

  it('critCharge: 確定会心・行動で解除', () => {
    expect(applyCritCalc(false, c({ statuses: [st('critCharge')] }), ctx())).toBe(true);
    const ch = c({ statuses: [st('critCharge')] });
    clearActedStatuses(ch);
    expect(ch.statuses).toHaveLength(0);
  });

  it('restraint: 被弾では解けない (clearHit no-op) が行動では解ける', () => {
    const hit = c({ statuses: [st('restraint')] });
    clearHitStatuses(hit);
    expect(hit.statuses).toHaveLength(1); // 被弾で解けない
    clearActedStatuses(hit);
    expect(hit.statuses).toHaveLength(0);
  });

  it('atkUp/atkDown: 威力倍率 (magnitude 上書き可)', () => {
    expect(applyPowerCalc(1, c({ statuses: [st('atkUp')] }), ctx())).toBeCloseTo(1.3);
    expect(applyPowerCalc(1, c({ statuses: [st('atkDown', 3, 0.5)] }), ctx())).toBeCloseTo(0.5);
  });

  it('defUp/defDown: 被ダメ倍率', () => {
    expect(applyIncomingCalc(1, c({ statuses: [st('defUp')] }), ctx())).toBeCloseTo(0.7);
    expect(applyIncomingCalc(1, c({ statuses: [st('defDown')] }), ctx())).toBeCloseTo(1.3);
  });

  it('agiUp/agiDown: 回避倍率', () => {
    expect(applyDodgeCalc(0.2, c({ statuses: [st('agiUp')] }), ctx())).toBeCloseTo(0.3);
    expect(applyDodgeCalc(0.2, c({ statuses: [st('agiDown')] }), ctx())).toBeCloseTo(0.12);
  });

  // ── 付与 (restack) ──
  it('applyStatus: refresh は turns を伸ばす / ignore は据え置き', () => {
    const p = c();
    applyStatus(p, st('poison', 2, 3));
    applyStatus(p, st('poison', 5, 4)); // refresh: turns=max, magnitude 更新
    expect(p.statuses).toHaveLength(1);
    expect(p.statuses![0]!.turns).toBe(5);
    expect(p.statuses![0]!.magnitude).toBe(4);

    const t = c();
    applyStatus(t, st('tumble', 2));
    applyStatus(t, st('tumble', 9)); // ignore: 据え置き
    expect(t.statuses).toHaveLength(1);
    expect(t.statuses![0]!.turns).toBe(2);
  });

  it('thorns: 物理被弾で攻撃者に反射 (onDamaged)', () => {
    const guard = c({ statuses: [st('thorns', 3, 0.3)] });
    const attacker = c({ name: 'atk', hp: 100 });
    applyOnDamaged(guard, attacker, 20, ctx()); // 20 ダメージ食らった → 攻撃者に 20×0.3=6 反射
    expect(attacker.hp).toBe(94);
  });

  it('ironWall: 被ダメをほぼ 0 に (incomingCalc ×0.05)', () => {
    expect(applyIncomingCalc(1, c({ statuses: [st('ironWall', 1)] }), ctx())).toBeCloseTo(0.05);
  });

  it('accDown: 攻撃側の hitBonus を下げる (modifyHit)', () => {
    expect(applyModifyHit(0, c({ statuses: [st('accDown', 3)] }), ctx())).toBeCloseTo(-0.2);
    expect(applyModifyHit(0.1, c({ statuses: [st('accDown', 3, 0.3)] }), ctx())).toBeCloseTo(-0.2);
    expect(applyModifyHit(0, c(), ctx())).toBe(0); // なしは no-op
  });

  it('poison は生存者のみ tick (HP0 の死体は毒で追撃しない)', () => {
    const dead = c({ hp: 0, statuses: [st('poison', 2, 5)] });
    tickStatuses(dead, ctx());
    expect(dead.hp).toBe(0); // 追撃なし
  });

  it('applyStatus した状態は付与ターンの tick を fresh スキップし、次の tick から効く', () => {
    const target = c({ hp: 100 });
    applyStatus(target, st('poison', 2, 5));
    // 付与ターン末の tick: fresh を畳むだけ (ダメージ・減衰なし)。
    tickStatuses(target, ctx());
    expect(target.hp).toBe(100); // 付与ターンは毒ダメージ無し
    expect(target.statuses![0]!.turns).toBe(2); // 減衰なし
    expect(target.statuses![0]!.fresh).toBe(false);
    // 次ターン以降は通常どおり効く。
    tickStatuses(target, ctx());
    expect(target.hp).toBe(95);
    expect(target.statuses![0]!.turns).toBe(1);
  });

  it('doomMark は restack ignore: 再付与でカウントダウンが巻き戻らない', () => {
    const target = c();
    applyStatus(target, st('doomMark', 3, 25));
    tickStatuses(target, ctx()); // fresh 畳み (turns 3)
    tickStatuses(target, ctx()); // turns 3→2
    const before = target.statuses![0]!.turns;
    applyStatus(target, st('doomMark', 3, 99)); // 再付与 → ignore で無視
    expect(target.statuses![0]!.turns).toBe(before); // 巻き戻らない
    expect(target.statuses![0]!.magnitude).toBe(25); // 上書きされない
  });

  it('doomMark: カウントダウンの末に magnitude の大ダメージが炸裂', () => {
    const target = c({ hp: 100 });
    applyStatus(target, st('doomMark', 3, 25));
    // 付与ターン (fresh) は畳むだけ・ダメージなし。
    tickStatuses(target, ctx());
    expect(target.hp).toBe(100);
    // 以後 turns 3→2→1 とカウントダウン、turns===1 の tick で炸裂。
    tickStatuses(target, ctx()); // turns 3→2 (近づいている)
    expect(target.hp).toBe(100);
    tickStatuses(target, ctx()); // turns 2→1 (近づいている)
    expect(target.hp).toBe(100);
    tickStatuses(target, ctx()); // turns 1 → 炸裂 25 → 除去
    expect(target.hp).toBe(75);
    expect(target.statuses ?? []).toHaveLength(0);
  });

  it('turns:1 の麻痺は fresh スキップで付与ターンを生き延び、次ターンで消える', () => {
    const target = c();
    applyStatus(target, st('stun', 1));
    tickStatuses(target, ctx()); // 付与ターン: fresh 畳むのみ → 残る
    expect(target.statuses?.some((s) => s.id === 'stun')).toBe(true);
    tickStatuses(target, ctx()); // 次ターン: turns 1→0 で除去
    expect(target.statuses ?? []).toHaveLength(0);
  });
});
