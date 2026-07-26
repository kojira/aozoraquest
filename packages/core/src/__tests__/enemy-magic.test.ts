import { describe, it, expect } from 'vitest';
import { startBattle, resolveTurn, MONSTERS_BY_ID, type BattleState } from '../index.js';

/** night-raven (tier3 caster) が出る戦闘を探す。 */
function findRavenBattle(job: 'warrior' | 'shogun' | 'paladin', jobLv: number, plLv: number): BattleState | null {
  for (let seed = 0; seed < 120; seed++) {
    const s = startBattle(job, jobLv, plLv, 'x', 3, seed, 0, undefined, { monsterId: 'night-raven' });
    if (s.monsterId === 'night-raven') return s;
  }
  return null;
}

describe('敵の魔法 (caster ability #456)', () => {
  it('caster 型の敵が存在し spell を持つ (対物理型の弱点=魔法を成立させる)', () => {
    const casters = Object.values(MONSTERS_BY_ID).filter((m) => m.ability === 'caster');
    expect(casters.length).toBeGreaterThanOrEqual(1);
    for (const c of casters) {
      expect(c.spell, c.id).toBeTruthy();
      expect(typeof c.spell!.name).toBe('string');
      expect(c.spell!.max).toBeGreaterThanOrEqual(c.spell!.min);
    }
  });

  it('caster は MP を消費して def 無視の属性魔撃を撃つ (プレイヤーが被弾)', () => {
    const s0 = findRavenBattle('warrior', 8, 12);
    expect(s0).not.toBeNull();
    let s = s0!;
    const spellName = MONSTERS_BY_ID['night-raven']!.spell!.name;
    // 高 def の壁を作り「魔法は def を無視して通る」ことを見る (物理は 1 に沈むが魔法は通る)。
    s.player.def = 999;
    let cast = false;
    for (let i = 0; i < 40 && s.outcome === 'ongoing'; i++) {
      const mpBefore = s.monster.mp;
      const hpBefore = s.player.hp;
      s = resolveTurn(s, 'guard'); // プレイヤーは防御に徹して長引かせる
      if (s.lastEvents.some((e) => e.text.includes(spellName))) {
        cast = true;
        expect(s.monster.mp).toBeLessThan(mpBefore); // MP 消費
        expect(s.player.hp).toBeLessThan(hpBefore); // 高 def でも魔法は通る (def 無視)
        break;
      }
    }
    expect(cast).toBe(true);
  });

  it('覇王 (将軍 Lv30) は物理致死は耐えるが、魔法致死では死ぬ (設計どおりの弱点)', () => {
    const s0 = findRavenBattle('shogun', 30, 30);
    expect(s0).not.toBeNull();
    let s = s0!;
    expect(s.player.passives).toContain('shogun-overlord'); // 覇王を持っている
    const spellName = MONSTERS_BY_ID['night-raven']!.spell!.name;
    // 毎ターン HP1・覇王未使用に固定してガードで受ける。覇王は物理致死を毎回耐える (once はリセット) ので、
    // **敗北するのは魔法致死のときだけ**。physicalSaved で「物理は耐えた」実績も確認する。
    let physicalSaved = false;
    let magicKilled = false;
    for (let i = 0; i < 120 && s.outcome === 'ongoing'; i++) {
      s.player.hp = 1;
      s.player.lethalGuardUsed = false; // 覇王を常に使える状態に (物理は毎回耐えるはず)
      s = resolveTurn(s, 'guard');
      const magic = s.lastEvents.some((e) => e.text.includes(spellName));
      if (s.outcome === 'lose') {
        expect(magic).toBe(true); // 敗北したなら必ず魔法致死 (物理では覇王が耐えるので死なない)
        magicKilled = true;
        break;
      }
      // 敵が実際に物理ダメージを与えた (spell でない monster ダメージイベント) のに HP1 で生存 =
      // 物理致死を覇王が耐えた実績 (guard 空振り/回避ターンでは true にしない = 厳密化)。
      const physHit = s.lastEvents.some(
        (e) => e.actor === 'monster' && typeof e.damage === 'number' && !e.text.includes(spellName),
      );
      if (!magic && physHit && s.outcome === 'ongoing') physicalSaved = true;
    }
    expect(magicKilled).toBe(true); // 魔法致死で覇王将軍が敗北した = 魔法は覇王を貫く
    expect(physicalSaved).toBe(true); // 物理致死は覇王で耐えた = 物理耐性は健在
  });

  it('清き心 (聖騎士 Lv30) は敵魔法を実戦で反射する (敵魔法 content との統合)', () => {
    const spellName = MONSTERS_BY_ID['night-raven']!.spell!.name;
    // 複数 seed × 多ターンで、清き心の反射 (25%) × 敵の詠唱 が少なくとも 1 回起きることを確認。
    // 聖騎士の HP を毎ターン満タンに戻して戦闘を長引かせ、詠唱機会を稼ぐ。
    let reflected = false;
    for (let seed = 0; seed < 20 && !reflected; seed++) {
      let s = startBattle('paladin', 30, 30, 'x', 5, seed, 0, undefined, { monsterId: 'night-raven' });
      expect(s.player.passives).toContain('paladin-purity');
      for (let i = 0; i < 60 && s.outcome === 'ongoing'; i++) {
        s.player.hp = s.player.maxHp; // 倒し切らず長引かせる (詠唱機会を稼ぐ)
        s.monster.mp = s.monster.maxMp; // 敵 MP も戻して詠唱を続けさせる
        s = resolveTurn(s, 'guard');
        if (s.lastEvents.some((e) => e.text.includes('はね返した'))) {
          reflected = true;
          break;
        }
      }
    }
    expect(reflected).toBe(true); // 敵魔法を清き心で反射した = onIncomingMagic 経路が実戦で発火
  });
});
