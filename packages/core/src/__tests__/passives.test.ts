import { describe, it, expect } from 'vitest';
import {
  PASSIVES,
  applyDodgeCalc,
  applyPowerCalc,
  applyCritCalc,
  applyIncomingCalc,
  applyOnHit,
  type HookCtx,
} from '../statuses.js';
import { jobPassives, playerCombatant, type Combatant } from '../battle.js';

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
const ctx = (rng = 0.5): HookCtx => ({ rng: () => rng, events: [] });

describe('パッシブ (#456 各職 Lv30)', () => {
  it('PASSIVES の全エントリで id がキーと一致', () => {
    for (const key of Object.keys(PASSIVES)) {
      expect(PASSIVES[key]!.id).toBe(key);
    }
  });

  it('jobPassives: Lv30 到達で innate パッシブ1つ、Lv29 以下は空', () => {
    expect(jobPassives('warrior', 30)).toEqual(['warrior-blademaster']);
    expect(jobPassives('warrior', 29)).toEqual([]);
    expect(jobPassives('mage', 30)).toEqual(['mage-barrier']);
    expect(jobPassives('ninja', 30)).toEqual(['kubikari']);
    // フック未実装の職 (慧眼/清き心/覇王 等) は Lv30 でもまだ空 (後続で追加)。
    expect(jobPassives('sage', 30)).toEqual([]);
    expect(jobPassives('paladin', 30)).toEqual([]);
    expect(jobPassives('guardian', 30)).toEqual([]);
  });

  it('playerCombatant: 実装済み職は Lv30 で passives が入り、Lv29 では空', () => {
    expect(playerCombatant('warrior', 30, 30, 'w').passives).toEqual(['warrior-blademaster']);
    expect(playerCombatant('warrior', 29, 30, 'w').passives).toEqual([]);
    expect(playerCombatant('captain', 30, 30, 'cap').passives).toEqual(['captain-command']);
    // 未実装職は Lv30 でも空 (キット化と別軸)。
    expect(playerCombatant('sage', 30, 30, 's').passives).toEqual([]);
  });

  // ── 各パッシブの効果 (dispatcher 経由) ──
  it('魔力障壁 (mage-barrier): 被ダメ ×0.85', () => {
    expect(applyIncomingCalc(1, c({ passives: ['mage-barrier'] }), ctx())).toBeCloseTo(0.85);
  });

  it('名将 (captain-command): 与ダメ ×1.1 かつ 被ダメ ×0.9', () => {
    const cap = c({ passives: ['captain-command'] });
    expect(applyPowerCalc(1, cap, ctx())).toBeCloseTo(1.1);
    expect(applyIncomingCalc(1, cap, ctx())).toBeCloseTo(0.9);
  });

  it('全知/旅の勘: 回避を底上げ (上限 0.9)', () => {
    expect(applyDodgeCalc(0.2, c({ passives: ['seer-omniscience'] }), ctx())).toBeCloseTo(0.35);
    expect(applyDodgeCalc(0.2, c({ passives: ['explorer-instinct'] }), ctx())).toBeCloseTo(0.32);
    expect(applyDodgeCalc(0.85, c({ passives: ['seer-omniscience'] }), ctx())).toBeCloseTo(0.9); // clamp
  });

  it('詩心 (poet-muse): 自己バフ中のみ 与ダメ ×1.25', () => {
    const bare = c({ passives: ['poet-muse'] });
    expect(applyPowerCalc(1, bare, ctx())).toBeCloseTo(1); // バフなし = 素通し
    // hidden は powerCalc に触らない自己バフなので poet-muse の ×1.25 を単離できる
    // (atkUp だと status 自身の ×1.3 と積算され 1.625 になる = パッシブとバフは正しく重畳)。
    const buffed = c({ passives: ['poet-muse'], statuses: [{ id: 'hidden', turns: 3 }] });
    expect(applyPowerCalc(1, buffed, ctx())).toBeCloseTo(1.25);
  });

  it('剣豪 (warrior-blademaster): rng<0.15 で会心へ引き上げ、既に会心なら維持', () => {
    const w = c({ passives: ['warrior-blademaster'] });
    expect(applyCritCalc(false, w, ctx(0.1))).toBe(true); // 確率的に会心
    expect(applyCritCalc(false, w, ctx(0.9))).toBe(false); // 外れる
    expect(applyCritCalc(true, w, ctx(0.9))).toBe(true); // 既に会心なら維持
  });

  it('首狩り (kubikari): 明確な格下 (非メタル) を低 rng で一撃、格上/メタル/等格は不発', () => {
    const ninja = c({ passives: ['kubikari'], maxHp: 100, luk: 30 });
    const weak = c({ name: 'z', maxHp: 40, luk: 5 }); // maxHp 40 <= 60 = 格下
    expect(applyOnHit(ninja, weak, ctx(0.01))).toBe(true); // 低 rng で即死
    expect(applyOnHit(ninja, weak, ctx(0.99))).toBe(false); // 高 rng で不発
    const peer = c({ name: 'p', maxHp: 80 }); // 80 > 60 = 格下でない
    expect(applyOnHit(ninja, peer, ctx(0.01))).toBe(false);
    const metal = c({ name: 'm', maxHp: 30, resistAllMagic: true }); // メタルは即死無効
    expect(applyOnHit(ninja, metal, ctx(0.01))).toBe(false);
  });

  it('パッシブなしの Combatant は全ディスパッチ no-op (回帰防止)', () => {
    const bare = c();
    expect(applyIncomingCalc(1, bare, ctx())).toBe(1);
    expect(applyPowerCalc(1, bare, ctx())).toBe(1);
    expect(applyDodgeCalc(0.2, bare, ctx())).toBe(0.2);
    expect(applyCritCalc(false, bare, ctx(0.1))).toBe(false);
    expect(applyOnHit(bare, c(), ctx(0.01))).toBe(false);
  });
});
