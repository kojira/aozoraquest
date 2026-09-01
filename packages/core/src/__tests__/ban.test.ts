import { describe, expect, it } from 'vitest';
import { BANS_RKEY, bansCollection, isBanned } from '../ban.js';

describe('bansCollection', () => {
  it('NSID の根に config.bans を続ける (web の ADMIN_COL と edge の loader が同じ値を組む)', () => {
    expect(bansCollection('app.aozoraquest')).toBe('app.aozoraquest.config.bans');
    expect(BANS_RKEY).toBe('self');
  });
});

describe('isBanned', () => {
  it('空のリストでは誰も BAN されない', () => {
    expect(isBanned([], 'did:plc:a')).toBe(false);
  });

  it('リストに入っている DID だけ true', () => {
    const bans = ['did:plc:bad'];
    expect(isBanned(bans, 'did:plc:bad')).toBe(true);
    expect(isBanned(bans, 'did:plc:good')).toBe(false);
  });

  it('未ログイン (did 無し) は false', () => {
    expect(isBanned(['did:plc:bad'], undefined)).toBe(false);
    expect(isBanned(['did:plc:bad'], null)).toBe(false);
    expect(isBanned(['did:plc:bad'], '')).toBe(false);
  });
});
