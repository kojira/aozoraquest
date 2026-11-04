/**
 * さくせん・めいれい (D-PARTY-004 A3)。
 * - allyOrders 無しは今と同じ結果 (同じ seed で events が一致)
 * - めいれい: 選んだ手を、その仲間のとくぎ・MP で。MP 不足は たたかう。どうぐは共有の在庫から行動順に
 * - さくせん: いのちだいじに は HP 60% の味方がいれば全体回復を選ぶ (おまかせ は 50% 未満まで待つ)、
 *   じゅもんせつやく は とくぎ を選ばない、ガンガン は回復を 25% 未満まで待つ
 */
import { describe, expect, it } from 'vitest';
import { allyAutoAction, playerCombatant, resolveTurnMulti, skillsForJob, startBattle, type AllyMode, type BattleState, type Combatant } from '../index.js';

const mate = (archetype: Parameters<typeof playerCombatant>[0], level: number, name = 'なかま', over: Partial<Combatant> = {}): Combatant => ({ ...playerCombatant(archetype, level, 1, name), job: { archetype, level }, ...over });

/** 主人公 (warrior Lv8) + 仲間。敵は 2 体。 */
function party(allyList: Combatant[], seed = 3, modes?: Array<AllyMode | undefined>): BattleState {
  const base = startBattle('warrior', 8, 8, 'ゆうしゃ', 1, seed, 2, undefined, { extraEnemies: 1 });
  return { ...base, allies: [base.player, ...allyList], enemies: base.enemies!, ...(modes ? { allyModes: modes } : {}) };
}
const bell = skillsForJob('miko', 5).findIndex((k) => k.kind === 'miko-heal-bell');

describe('めいれい (allyOrders)', () => {
  it('allyOrders 無し・空は今と同じ結果 (同じ seed で events が一致)', () => {
    const s = party([mate('mage', 8, 'ソラ')]);
    expect(resolveTurnMulti(s, 'attack', 42, 0, 0, undefined, []).lastEvents).toEqual(resolveTurnMulti(s, 'attack', 42).lastEvents);
    expect(resolveTurnMulti(s, 'attack', 42, 0, 0, undefined, [undefined, undefined]).lastEvents).toEqual(resolveTurnMulti(s, 'attack', 42).lastEvents);
  });

  it('めいれい の仲間は選んだ手を行う (ぼうぎょ)', () => {
    const s = party([mate('mage', 8, 'ソラ')]);
    const next = resolveTurnMulti(s, 'guard', 42, 0, 0, undefined, [undefined, { command: 'guard', skillIndex: 0, targetIndex: 0 }]);
    expect(next.lastEvents.some((e) => e.text === 'ソラはぼうぎょのかまえ!')).toBe(true);
  });

  it('めいれい の とくぎは その仲間のとくぎと MP。MP 不足は たたかう', () => {
    const miko = mate('miko', 5, 'ミオ');
    const s = party([miko]);
    const hurt = { ...s, player: { ...s.player, hp: 3 } };
    hurt.allies = [hurt.player, miko];
    const cast = resolveTurnMulti(hurt, 'guard', 42, 0, 0, undefined, [undefined, { command: 'skill', skillIndex: bell, targetIndex: 0 }]);
    expect(cast.lastEvents.some((e) => e.text.includes('癒しの鈴'))).toBe(true);
    expect(cast.allies![1]!.mp).toBeLessThan(miko.mp);
    const dry = { ...hurt, allies: [hurt.player, { ...miko, mp: 0 }] };
    const fell = resolveTurnMulti(dry, 'guard', 42, 0, 0, undefined, [undefined, { command: 'skill', skillIndex: bell, targetIndex: 0 }]);
    expect(fell.lastEvents.some((e) => e.text.startsWith('ミオは MPが足りない!'))).toBe(true);
    expect(fell.lastEvents.some((e) => e.text.includes('癒しの鈴'))).toBe(false);
  });

  it('めいれい の やくそうは共有の在庫から減り、選んだ味方に届く', () => {
    const s = party([mate('mage', 8, 'ソラ')]);
    const hurt = { ...s, player: { ...s.player, hp: 5 }, herbs: 1 };
    hurt.allies = [hurt.player, s.allies![1]!];
    const next = resolveTurnMulti(hurt, 'guard', 42, 0, 0, undefined, [undefined, { command: 'herb', skillIndex: 0, targetIndex: 0 }]);
    expect(next.herbs).toBe(0);
    expect(next.herbsUsed).toBe(1);
    expect(next.lastEvents.some((e) => e.text.startsWith('ソラはやくそうを使った! ゆうしゃのHPが'))).toBe(true);
  });
});

describe('さくせん (allyAutoAction の tactic)', () => {
  /** 巫女の仲間と、HP 60% の主人公。 */
  function at60(tactic?: AllyMode) {
    const s = party([mate('miko', 5, 'ミオ')]);
    const player = { ...s.player, hp: Math.round(s.player.maxHp * 0.6) };
    return allyAutoAction({ ...s, player, allies: [player, s.allies![1]!] }, 1, 7, tactic);
  }

  it('いのちだいじに は HP 60% の味方がいれば全体回復を選ぶ (おまかせ は選ばない)', () => {
    expect(at60('inochi')).toMatchObject({ command: 'skill', skillIndex: bell });
    expect(at60()).not.toMatchObject({ command: 'skill', skillIndex: bell });
  });

  it('ガンガン は 30% では回復しない。25% 未満で回復', () => {
    const s = party([mate('miko', 5, 'ミオ')]);
    const hp = (r: number) => { const player = { ...s.player, hp: Math.floor(s.player.maxHp * r) }; return { ...s, player, allies: [player, s.allies![1]!] }; };
    expect(allyAutoAction(hp(0.3), 1, 7, 'gangan')).not.toMatchObject({ command: 'skill', skillIndex: bell });
    expect(allyAutoAction(hp(0.2), 1, 7, 'gangan')).toMatchObject({ command: 'skill', skillIndex: bell });
  });

  it('じゅもんせつやく は とくぎ を選ばない (敵 2 体でも全体技を使わない)', () => {
    const s = party([mate('miko', 5, 'ミオ')]);
    expect(allyAutoAction(s, 1, 7)).toMatchObject({ command: 'skill' }); // おまかせ は 風の舞
    for (let seed = 0; seed < 20; seed++) expect(allyAutoAction(s, 1, seed, 'jumon').command).not.toBe('skill');
  });

  it('いのちだいじに は 敵の「ため」に防御する', () => {
    const s = party([mate('mage', 8, 'ソラ')]);
    const charging = { ...s, enemies: s.enemies!.map((e, i) => (i === 0 ? { ...e, charging: true } : e)) };
    expect(allyAutoAction(charging, 1, 7, 'inochi').command).toBe('guard');
  });

  it('resolveTurnMulti は封印した allyModes の さくせん で仲間を動かす', () => {
    const s = party([mate('miko', 5, 'ミオ')], 3, [undefined, 'jumon']);
    const next = resolveTurnMulti(s, 'guard', 42);
    expect(next.lastEvents.some((e) => e.text.includes('風の舞'))).toBe(false);
    expect(next.allies![1]!.mp).toBe(s.allies![1]!.mp);
  });
});
