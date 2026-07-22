import { describe, it, expect } from 'vitest';
import {
  PASSIVES,
  applyDodgeCalc,
  applyPowerCalc,
  applyCritCalc,
  applyIncomingCalc,
  applyOnHit,
  applyOnLethal,
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
    expect(jobPassives('shogun', 30)).toEqual(['shogun-overlord']);
    expect(jobPassives('guardian', 30)).toEqual(['guardian-immovable']);
    // フック未実装の職 (慧眼/清き心/審美眼/発明家/非戦闘) は Lv30 でもまだ空 (後続 #483)。
    expect(jobPassives('sage', 30)).toEqual([]);
    expect(jobPassives('paladin', 30)).toEqual([]);
    expect(jobPassives('artist', 30)).toEqual([]);
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

  it('全知/旅の勘: 回避を底上げ (通常上限 0.32 は超えるが EVASION_PASSIVE_CAP 0.55 で頭打ち)', () => {
    // 通常帯: dodgeMax(0.32) を超えて底上げ = 回避職の identity。
    expect(applyDodgeCalc(0.2, c({ passives: ['seer-omniscience'] }), ctx())).toBeCloseTo(0.35);
    expect(applyDodgeCalc(0.2, c({ passives: ['explorer-instinct'] }), ctx())).toBeCloseTo(0.32);
    // cap 帯: 0.45 + 0.15 = 0.6 → 0.55 で頭打ち (絶対回避化を防ぐ)。
    expect(applyDodgeCalc(0.45, c({ passives: ['seer-omniscience'] }), ctx())).toBeCloseTo(0.55);
    // 既に cap 超の高回避 (将来のかくれみ 0.75 等) はパッシブで下げない (max 保護)。
    expect(applyDodgeCalc(0.75, c({ passives: ['seer-omniscience'] }), ctx())).toBeCloseTo(0.75);
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

  it('覇王 (shogun-overlord): 物理致死をHP1で耐え、受けた分を攻撃者へ反射', () => {
    const shogun = c({ passives: ['shogun-overlord'], name: '将軍' });
    const atk = c({ name: '敵', hp: 100 });
    const ev = ctx();
    expect(applyOnLethal(shogun, atk, 30, ev)).toBe(true); // 生存
    expect(atk.hp).toBe(70); // 30 反射
    expect(ev.events.some((e) => e.text.includes('反射'))).toBe(true);
  });

  it('不動 (guardian-immovable): 物理致死を 50% で耐える (反射なし)', () => {
    const g = c({ passives: ['guardian-immovable'], name: '守護者' });
    const atk = c({ name: '敵', hp: 100 });
    expect(applyOnLethal(g, atk, 40, ctx(0.3))).toBe(true); // rng<0.5 = 耐える
    expect(atk.hp).toBe(100); // 反射なし
    expect(applyOnLethal(g, atk, 40, ctx(0.7))).toBe(false); // rng>=0.5 = 死ぬ
  });

  it('onLethal: パッシブなしは survive せず (通常どおり死ぬ)', () => {
    expect(applyOnLethal(c(), c(), 50, ctx())).toBe(false);
  });

  it('playerCombatant: 将軍/守護者 Lv30 で onLethal パッシブが入る', () => {
    expect(playerCombatant('shogun', 30, 30, 'sh').passives).toEqual(['shogun-overlord']);
    expect(playerCombatant('guardian', 30, 30, 'gd').passives).toEqual(['guardian-immovable']);
  });

  it('パッシブなしの Combatant は全ディスパッチ no-op (回帰防止)', () => {
    const bare = c();
    expect(applyIncomingCalc(1, bare, ctx())).toBe(1);
    expect(applyPowerCalc(1, bare, ctx())).toBe(1);
    expect(applyDodgeCalc(0.2, bare, ctx())).toBe(0.2);
    expect(applyCritCalc(false, bare, ctx(0.1))).toBe(false);
    expect(applyOnHit(bare, c(), ctx(0.01))).toBe(false);
    expect(applyOnLethal(bare, c(), 50, ctx())).toBe(false);
  });
});
