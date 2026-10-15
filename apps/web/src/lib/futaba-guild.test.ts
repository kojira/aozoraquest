/** ギルドの受付は NPC データ (guildReception) で決まる (Refs #718)。 */
import { afterEach, describe, expect, it } from 'vitest';
import { setInteriors, worldOverlay, starterTownInterior, starterTownNpcs, STARTER_TOWN_GUILD, validateNpcs, type NpcDef } from '@aozoraquest/core';
import { isFutabaGuild } from './futaba-guild';

const town = worldOverlay().spawn;
const bluesky = (): NpcDef => starterTownNpcs().find((n) => n.id === 'futaba-bluesky')!;
const { guildReception: _g, ...plain } = bluesky();

describe('isFutabaGuild (guildReception)', () => {
  afterEach(() => setInteriors([], []));

  it('guildReception: true で扉のマスに立つ NPC は受付', () => {
    setInteriors([starterTownInterior(town)], []);
    expect(bluesky().guildReception).toBe(true);
    expect(isFutabaGuild(bluesky())).toBe(true);
  });

  it('同じ id・同じ扉でも guildReception が無ければ通常の NPC', () => {
    setInteriors([starterTownInterior(town)], []);
    expect(isFutabaGuild(plain)).toBe(false);
  });

  it('id に依らず guildReception で決まる。扉でないマス・マップ未読込なら通常の NPC', () => {
    expect(isFutabaGuild(bluesky())).toBe(false);
    setInteriors([starterTownInterior(town)], []);
    expect(isFutabaGuild({ ...bluesky(), id: 'other-receptionist' })).toBe(true);
    expect(isFutabaGuild({ ...bluesky(), x: STARTER_TOWN_GUILD.frontX, y: STARTER_TOWN_GUILD.frontY })).toBe(false);
  });

  it('core の検証は true 以外の値を弾く', () => {
    expect(() => validateNpcs([{ ...bluesky(), guildReception: 'yes' as unknown as true }])).toThrow('ギルドの受付');
    expect(() => validateNpcs([bluesky()])).not.toThrow();
  });
});
