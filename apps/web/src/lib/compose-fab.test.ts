import { describe, it, expect } from 'vitest';
import { composeFabAllowedOnPath } from './compose-fab';

describe('composeFabAllowedOnPath', () => {
  it('shows the FAB on timeline / content routes', () => {
    expect(composeFabAllowedOnPath('/')).toBe(true);
    expect(composeFabAllowedOnPath('/notifications')).toBe(true);
    expect(composeFabAllowedOnPath('/search')).toBe(true);
    expect(composeFabAllowedOnPath('/board')).toBe(true);
    expect(composeFabAllowedOnPath('/profile/alice.bsky.social')).toBe(true);
    expect(composeFabAllowedOnPath('/board/at://did:plc:x/app.aozoraquest.userQuest/1')).toBe(true);
  });

  it('hides the FAB on form / auth / legal routes', () => {
    expect(composeFabAllowedOnPath('/onboarding')).toBe(false);
    expect(composeFabAllowedOnPath('/settings')).toBe(false);
    expect(composeFabAllowedOnPath('/board/new')).toBe(false);
    expect(composeFabAllowedOnPath('/oauth/callback')).toBe(false);
    expect(composeFabAllowedOnPath('/tos')).toBe(false);
    expect(composeFabAllowedOnPath('/privacy')).toBe(false);
    expect(composeFabAllowedOnPath('/me/card')).toBe(false);
  });

  it('hides on sub-paths of hidden prefixes', () => {
    // location.pathname はクエリ/ハッシュを含まない前提 (それらは location.search/hash)
    expect(composeFabAllowedOnPath('/settings/account')).toBe(false);
    expect(composeFabAllowedOnPath('/me/card/preview')).toBe(false);
  });

  it('does not false-match a different route that merely shares a prefix string', () => {
    // /board/new is hidden, but /board and /board/<uri> are allowed
    expect(composeFabAllowedOnPath('/board')).toBe(true);
    // a hypothetical /settings-like path that is not the settings route
    expect(composeFabAllowedOnPath('/settingsfoo')).toBe(true);
  });
});
