import { describe, it, expect } from 'vitest';
import {
  STATUS_REGISTRY,
  applyBeforeAct,
  applyDodgeCalc,
  applyPowerCalc,
  applyCritCalc,
  applyIncomingCalc,
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
    const legacy = c({ statuses: undefined, passives: undefined });
    expect(applyBeforeAct(legacy, ctx())).toBe(false);
    expect(applyPowerCalc(1, legacy, ctx())).toBe(1);
    expect(() => tickStatuses(legacy, ctx())).not.toThrow();
  });

  // ── 各状態の効果 ──
  it('poison: turnEnd で magnitude ダメージ + turns 減衰', () => {
    const p = c({ statuses: [st('poison', 2, 5)] });
    tickStatuses(p, ctx());
    expect(p.hp).toBe(95);
    expect(p.statuses![0].turns).toBe(1);
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
    expect(p.statuses![0].turns).toBe(5);
    expect(p.statuses![0].magnitude).toBe(4);

    const t = c();
    applyStatus(t, st('tumble', 2));
    applyStatus(t, st('tumble', 9)); // ignore: 据え置き
    expect(t.statuses).toHaveLength(1);
    expect(t.statuses![0].turns).toBe(2);
  });

  it('poison は生存者のみ tick (HP0 の死体は毒で追撃しない)', () => {
    const dead = c({ hp: 0, statuses: [st('poison', 2, 5)] });
    tickStatuses(dead, ctx());
    expect(dead.hp).toBe(0); // 追撃なし
  });
});
