/**
 * 仲間の回復 (D-PARTY-003)。
 * - 味方 1 人の回復とくぎ (聖光の癒し など) は、パーティ戦では選んだ味方に効く。1 人戦は自分
 * - やくそう・そらのしずく・治療のどうぐ (cleanse) も選んだ味方に
 * - 選んだ味方がターン中に先に倒れたら主人公に
 * - 仲間の AI: 味方 1 人の回復とくぎは HP の割合がいちばん低い味方 (主人公を含む) に
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  BATTLE_TUNING, activeEquipment, activeItems, allyAutoAction, playerCombatant, resolveTurn, resolveTurnMulti, setItemOverrides, startBattle,
  type BattleState, type Combatant, type ItemDefData,
} from '../index.js';

const mate = (archetype: Parameters<typeof playerCombatant>[0], level: number, name: string): Combatant => ({ ...playerCombatant(archetype, level, 1, name), job: { archetype, level } });

/** 主人公 (聖騎士 Lv5) + 仲間 2 人 vs 動かない敵 1 体。仲間は動かない (agi 0・ぼうぎょ相当)。 */
function partyBattle(extra: Partial<BattleState> = {}): BattleState {
  const base = startBattle('paladin', 5, 5, 'ゆうしゃ', 1, 3, 2, undefined, { tonics: 2 });
  const monster = { ...base.monster, atk: 0, agi: 0, hp: 99999, maxHp: 99999 };
  const a1 = { ...mate('warrior', 5, 'カイト'), hp: 5 };
  const a2 = { ...mate('mage', 5, 'ソラ'), hp: 4, mp: 0 };
  const player = { ...base.player, hp: 6 };
  return { ...base, player, monster, allies: [player, a1, a2], enemies: [monster], ...extra };
}

const healIndex = (s: BattleState) => s.playerSkills.findIndex((k) => k.kind === 'paladin-heal');

describe('味方 1 人の回復とくぎ (D-PARTY-003)', () => {
  it('主人公の 聖光の癒し を 仲間 1 (生きている味方の 1 番目) に使うと、仲間 1 が回復し 主人公は回復しない', () => {
    const s = partyBattle();
    const i = healIndex(s);
    expect(i).toBeGreaterThan(0);
    const next = resolveTurnMulti(s, 'skill', 7, i, 1);
    const ally = next.allies![1]!;
    expect(ally.hp).toBe(Math.min(ally.maxHp, 5 + Math.round(ally.maxHp * 0.3)));
    expect(next.allies![0]!.hp).toBe(6);
    expect(next.lastEvents.some((e) => e.text === `カイトは聖光の癒し! HPが${Math.round(ally.maxHp * 0.3)}回復。`)).toBe(true);
  });

  it('1 人戦では今までどおり自分に効く', () => {
    const base = startBattle('paladin', 5, 5, 'ゆうしゃ', 1, 3, 0);
    const s = { ...base, player: { ...base.player, hp: 3 }, monster: { ...base.monster, atk: 0 } };
    const next = resolveTurn(s, 'skill', 7, healIndex(s));
    expect(next.player.hp).toBe(Math.min(s.player.maxHp, 3 + Math.round(s.player.maxHp * 0.3)));
  });

  it('選んだ仲間が主人公より先に倒れていたら、主人公に効く', () => {
    const s0 = partyBattle();
    const fast = { ...s0.monster, agi: 9999, atk: 9999, hp: 99999 };
    // 敵はランダムな味方を殴る。仲間 1 だけが生き残れない (主人公と仲間 2 は def が高く倒れない) ようにする。
    const a1 = { ...s0.allies![1]!, hp: 1, def: 0 };
    const player = { ...s0.player, def: 99999, hp: 6 };
    const a2 = { ...s0.allies![2]!, def: 99999 };
    let hit = false;
    for (let seed = 0; seed < 80 && !hit; seed++) {
      const s = { ...s0, player, monster: fast, allies: [player, a1, a2], enemies: [fast] };
      const next = resolveTurnMulti(s, 'skill', seed, healIndex(s), 1);
      if (next.allies![1]!.hp > 0) continue;
      hit = true;
      expect(next.allies![0]!.hp).toBeGreaterThan(6);
      expect(next.allies![2]!.hp).toBe(4);
    }
    expect(hit).toBe(true);
  });
});

describe('どうぐを仲間に (D-PARTY-003)', () => {
  afterEach(() => setItemOverrides(null));

  it('やくそうを 仲間 2 に使うと 仲間 2 の HP が増え、主人公は増えない', () => {
    const s = partyBattle();
    const next = resolveTurnMulti(s, 'herb', 7, 0, 2);
    const a2 = next.allies![2]!;
    expect(a2.hp).toBe(Math.min(a2.maxHp, 4 + Math.round(a2.maxHp * BATTLE_TUNING.herbHealRatio)));
    expect(next.allies![0]!.hp).toBe(6);
    expect(next.herbs).toBe(1);
    expect(next.lastEvents.some((e) => e.text.startsWith('ゆうしゃはやくそうを使った! ソラのHPが'))).toBe(true);
  });

  it('そらのしずくを 仲間 2 に使うと 仲間 2 の MP が増える', () => {
    const s = partyBattle();
    const next = resolveTurnMulti(s, 'tonic', 7, 0, 2);
    expect(next.allies![2]!.mp).toBeGreaterThan(0);
    expect(next.allies![0]!.mp).toBe(s.allies![0]!.mp);
    expect(next.tonics).toBe(1);
  });

  it('治療のどうぐ (cleanse の self) を 仲間 1 に使うと 仲間 1 の弱体が消え、主人公の弱体は残る', () => {
    const cure: ItemDefData = { id: 'test-cure', name: 'なおしそう', battle: { effects: [{ kind: 'cleanse', target: 'self' }] } };
    setItemOverrides({ items: [...activeItems(), cure], equipment: [...activeEquipment()] });
    const s0 = partyBattle({ battleItems: { 'test-cure': 1 } });
    const poison = [{ id: 'poison' as const, turns: 3, magnitude: 1 }];
    const player = { ...s0.player, statuses: poison };
    const a1 = { ...s0.allies![1]!, hp: 50, statuses: poison };
    const next = resolveTurnMulti({ ...s0, player, allies: [player, a1, s0.allies![2]!] }, 'item', 7, 0, 1, 'test-cure');
    expect(next.allies![1]!.statuses ?? []).toEqual([]);
    expect((next.allies![0]!.statuses ?? []).some((x) => x.id === 'poison')).toBe(true);
  });
});

describe('仲間の AI の回復 (D-PARTY-003)', () => {
  it('味方 1 人の回復とくぎを持つ仲間は、HP の割合がいちばん低い味方に使う (主人公を含む)', () => {
    const s0 = partyBattle();
    const healer = mate('paladin', 5, 'ハル');
    const hero = { ...s0.player, hp: s0.player.maxHp };
    const a1 = { ...s0.allies![1]!, hp: Math.floor(s0.allies![1]!.maxHp * 0.4) };
    const a2 = { ...s0.allies![2]!, hp: 1 };
    const s = { ...s0, player: hero, allies: [hero, healer, a1, a2] };
    const a = allyAutoAction(s, 1);
    expect(a).toEqual({ command: 'skill', skillIndex: 1, targetIndex: 3 }); // [誓い, 聖光の癒し, 光の加護] の 1、生きている味方の 3 番目

    const next = resolveTurnMulti(s, 'guard', 7);
    expect(next.allies![3]!.hp).toBeGreaterThan(1);
  });

  it('だれも HP 50% を切っていなければ回復しない', () => {
    const s0 = partyBattle();
    const healer = mate('paladin', 5, 'ハル');
    const full = (c: Combatant) => ({ ...c, hp: c.maxHp });
    const s = { ...s0, player: full(s0.player), allies: [full(s0.player), healer, full(s0.allies![1]!)] };
    const a = allyAutoAction(s, 1);
    expect(a.command === 'skill' ? a.skillIndex : -1).not.toBe(1);
  });
});
