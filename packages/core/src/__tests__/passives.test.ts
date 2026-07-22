import { describe, it, expect } from 'vitest';
import {
  PASSIVES,
  applyDodgeCalc,
  applyPowerCalc,
  applyCritCalc,
  applyIncomingCalc,
  applyOnHit,
  applyOnLethal,
  applyElementBonus,
  applyTargetBonus,
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
    expect(jobPassives('sage', 30)).toEqual(['sage-insight']);
    expect(jobPassives('artist', 30)).toEqual(['artist-aesthete']);
    // フック未実装/inert の職 (清き心=敵魔法待ち/発明家/非戦闘) は Lv30 でもまだ空 (後続 #483)。
    expect(jobPassives('paladin', 30)).toEqual([]);
    expect(jobPassives('miko', 30)).toEqual([]);
  });

  it('playerCombatant: 実装済み職は Lv30 で passives が入り、Lv29 では空', () => {
    expect(playerCombatant('warrior', 30, 30, 'w').passives).toEqual(['warrior-blademaster']);
    expect(playerCombatant('warrior', 29, 30, 'w').passives).toEqual([]);
    expect(playerCombatant('captain', 30, 30, 'cap').passives).toEqual(['captain-command']);
    // 未実装/inert 職は Lv30 でも空 (清き心=敵魔法待ち)。キット化とは別軸。
    expect(playerCombatant('paladin', 30, 30, 'p').passives).toEqual([]);
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

  it('覇王 (shogun-overlord): 物理致死をHP1で耐え反射、ただし 1 戦闘 1 回だけ (2 回目は死ぬ)', () => {
    const shogun = c({ passives: ['shogun-overlord'], name: '将軍' });
    const atk = c({ name: '敵', hp: 100 });
    const ev = ctx();
    expect(applyOnLethal(shogun, atk, 30, ev)).toBe(true); // 初回: 生存
    expect(atk.hp).toBe(70); // 30 反射
    expect(shogun.lethalGuardUsed).toBe(true); // 発動済みフラグ
    expect(ev.events.some((e) => e.text.includes('反射'))).toBe(true);
    // 2 回目の物理致死は耐えられない (切り札は 1 回)。反射も起きない。
    const atk2 = c({ name: '敵2', hp: 100 });
    expect(applyOnLethal(shogun, atk2, 30, ctx())).toBe(false);
    expect(atk2.hp).toBe(100);
  });

  it('不動 (guardian-immovable): 物理致死を 1 回だけ確定で耐える (反射なし・運要素なし・2 回目は死ぬ)', () => {
    const g = c({ passives: ['guardian-immovable'], name: '守護者' });
    const atk = c({ name: '敵', hp: 100 });
    expect(applyOnLethal(g, atk, 40, ctx(0.99))).toBe(true); // rng に依らず確定で耐える
    expect(atk.hp).toBe(100); // 反射なし
    expect(g.lethalGuardUsed).toBe(true);
    expect(applyOnLethal(g, atk, 40, ctx(0.01))).toBe(false); // 2 回目は死ぬ
  });

  it('onLethal: オーバーキル (残HP<<ダメージ) でも survive すれば HP1 固定 (呼び出し側 battle.ts で hp=1)', () => {
    // applyOnLethal 自体は survive 可否のみ返す。ダメージ量に依らず初回は耐える (HP1 化は doAttack 側)。
    const shogun = c({ passives: ['shogun-overlord'], hp: 10, name: '将軍' });
    const atk = c({ name: '敵', hp: 500 });
    expect(applyOnLethal(shogun, atk, 9999, ctx())).toBe(true); // 超過ダメージでも初回は耐える
    expect(atk.hp).toBe(0); // 9999 反射で攻撃者は即死 (Math.max(0,...))
  });

  it('onLethal: パッシブなしは survive せず (通常どおり死ぬ)', () => {
    expect(applyOnLethal(c(), c(), 50, ctx())).toBe(false);
  });

  it('慧眼 (sage-insight): 弱点 (相性倍率>=1.5) のみ ×1.25 増幅、等倍/耐性/空 1.2 は素通し', () => {
    const sage = c({ passives: ['sage-insight'] });
    expect(applyElementBonus(1.5, sage, ctx())).toBeCloseTo(1.875); // 弱点 → さらに増幅
    expect(applyElementBonus(1.0, sage, ctx())).toBeCloseTo(1.0); // 等倍は素通し
    expect(applyElementBonus(0.5, sage, ctx())).toBeCloseTo(0.5); // 耐性は素通し (弱点でない)
    expect(applyElementBonus(1.2, sage, ctx())).toBeCloseTo(1.2); // 空の普遍優位は「弱点」でない
    expect(applyElementBonus(1.5, c(), ctx())).toBeCloseTo(1.5); // パッシブなしは no-op
  });

  it('playerCombatant: 賢者 Lv30 で慧眼が入る', () => {
    expect(playerCombatant('sage', 30, 30, 'sg').passives).toEqual(['sage-insight']);
  });

  it('審美眼 (artist-aesthete): 状態異常の敵に与ダメ ×1.3、無傷の敵は素通し', () => {
    const artist = c({ passives: ['artist-aesthete'] });
    const healthy = c({ name: '敵', statuses: [] });
    const poisoned = c({ name: '毒敵', statuses: [{ id: 'poison', turns: 3, magnitude: 5 }] });
    const dazed = c({ name: '幻惑敵', statuses: [{ id: 'accDown', turns: 3 }] }); // 芸術家が撒くデバフ
    expect(applyTargetBonus(1, artist, healthy, ctx())).toBeCloseTo(1); // 無傷 = 素通し
    expect(applyTargetBonus(1, artist, poisoned, ctx())).toBeCloseTo(1.3); // 状態異常 = 増幅
    expect(applyTargetBonus(1, artist, dazed, ctx())).toBeCloseTo(1.3);
    // バフ (atkUp) しか持たない敵は「状態異常」ではないので素通し。
    const buffed = c({ name: 'バフ敵', statuses: [{ id: 'atkUp', turns: 3 }] });
    expect(applyTargetBonus(1, artist, buffed, ctx())).toBeCloseTo(1);
    expect(applyTargetBonus(1, c(), poisoned, ctx())).toBeCloseTo(1); // パッシブなしは no-op
  });

  it('playerCombatant: 芸術家 Lv30 で審美眼が入る', () => {
    expect(playerCombatant('artist', 30, 30, 'ar').passives).toEqual(['artist-aesthete']);
  });

  it('playerCombatant: 将軍/守護者 Lv30 で onLethal パッシブが入り、切り札は毎戦闘 未使用から始まる', () => {
    const sh = playerCombatant('shogun', 30, 30, 'sh');
    expect(sh.passives).toEqual(['shogun-overlord']);
    expect(sh.lethalGuardUsed).toBeUndefined(); // 新しい戦闘 = 未発動 (once-per-battle のリセット)
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
