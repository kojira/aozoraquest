/**
 * フィールドの回復の幅 (D-HEAL-RANGE-001)。量はサーバーの乱数 (kuda の entropyU32) から決まり、
 * 戦闘と同じ式 (itemHealAmount / rolledHeal) で、使う人の うん が効く。画面は量を送らない。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BATTLE_TUNING, EQUIPMENT, activeItems, createRng, setItemOverrides, itemHealAmount, jobLevelFromXp, normalizeStats, partyMemberCombatant, playerCombatant, playerLevelFromXp, rolledHeal, statVectorToArray, xpForAllyLevel,
  type PartyRecruit,
} from '@aozoraquest/core';
import { GS, makeEnv, NOW, pds, USER } from './support/party-env';

const roll = vi.hoisted(() => ({ value: 0 }));
vi.mock('../src/kuda', () => ({ entropyU32: vi.fn(async () => ({ value: roll.value, source: 'csprng' })) }));
const { handleFieldSkill, handleItem } = await import('../src/field-heal');
const { handleFieldUse } = await import('../src/field-revive');
const kuda = await import('../src/kuda');

const POTION = { id: 'kizu-gusuri', name: 'きずぐすり', battle: { effects: [{ kind: 'heal' as const, amount: 20 }] } };
const PAL: PartyRecruit = { id: 'g:p', name: 'ハル', archetype: 'paladin', star: 2, minLevel: 1, line: 'よろしく。', xp: xpForAllyLevel('paladin', 5) };
/** party-env の診断 (warrior・jobXp 400) と同じ組み立ての主人公。 */
const hero = () => playerCombatant('warrior', jobLevelFromXp(400, 'warrior'), playerLevelFromXp(0), USER, statVectorToArray(normalizeStats({ atk: 30, def: 25, agi: 15, int: 15, luk: 15 })));

describe('フィールドの回復の幅 (D-HEAL-RANGE-001)', () => {
  const orig = globalThis.fetch;
  afterEach(() => { globalThis.fetch = orig; });

  it('やくそう: サーバーの乱数と主人公の うん で決まり、種が同じなら同じ量', async () => {
    const seen = new Set<number>();
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      roll.value = seed;
      const env = await makeEnv();
      const m = pds(GS({ materials: { herb: 1 }, carryHp: 1 }));
      globalThis.fetch = m.fn;
      const r = await handleItem(env, USER, 'herb', NOW);
      expect(r.healed).toBe(itemHealAmount('herb', { luk: hero().luk, rng: createRng(seed) }));
      expect(r.healed).toBeGreaterThanOrEqual(Math.round(BATTLE_TUNING.herbHealAmount * 0.85));
      expect(r.healed).toBeLessThanOrEqual(Math.round(BATTLE_TUNING.herbHealAmount * 1.15));
      seen.add(r.healed);
    }
    expect(seen.size).toBeGreaterThan(1);
    expect(kuda.entropyU32).toHaveBeenCalled();
  });

  it('回復のとくぎ: 唱えた人の うん とサーバーの乱数 (rolledHeal と同じ値)', async () => {
    roll.value = 77;
    const env = await makeEnv();
    const m = pds(GS({ carryHp: 2, party: { ids: ['g:p'], members: [PAL] } }));
    globalThis.fetch = m.fn;
    const r = await handleFieldSkill(env, USER, { caster: 'g:p', skillId: 'paladin-heal', target: 'hero', rkey: 'k1' }, NOW);
    const caster = partyMemberCombatant({ ...PAL, level: 5 }, 5);
    const want = Math.min(hero().maxHp - 2, rolledHeal({ kind: 'heal', ratio: 0.3, target: 'oneAlly' }, hero().maxHp, caster.luk, createRng(77)));
    expect(r.healed[0]!.amount).toBe(want);
  });

  it('/api/world/use の回復のどうぐも サーバーの乱数と うん で決まる', async () => {
    setItemOverrides({ items: [...activeItems(), POTION], equipment: [...EQUIPMENT] });
    try {
      roll.value = 9;
      const env = await makeEnv();
      const m = pds(GS({ materials: { 'kizu-gusuri': 1 }, carryHp: 1 }));
      globalThis.fetch = m.fn;
      const r = await handleFieldUse(env, USER, { itemId: 'kizu-gusuri', target: 'hero', rkey: 'u1' }, NOW, 'app.aozoraquest');
      expect(r.amount).toBe(itemHealAmount('kizu-gusuri', { luk: hero().luk, rng: createRng(9) }));
      expect(r.amount).toBeGreaterThanOrEqual(17);
      expect(r.amount).toBeLessThanOrEqual(23);
      expect(m.gs().carryHp).toBe(1 + r.amount);
    } finally {
      setItemOverrides(null);
    }
  });
});
