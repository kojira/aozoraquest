import { describe, it, expect, vi } from 'vitest';
import { pushInternalPath, type ColumnNav } from './column-detail';

function mockNav() {
  const nav: ColumnNav = {
    openPost: vi.fn(),
    openPostByParts: vi.fn(),
    openProfile: vi.fn(),
  };
  return nav;
}

describe('pushInternalPath', () => {
  it('/profile/<actor>/post/<rkey> → openPostByParts', () => {
    const nav = mockNav();
    expect(pushInternalPath(nav, '/profile/nao.bsky.social/post/abc')).toBe(true);
    expect(nav.openPostByParts).toHaveBeenCalledWith('nao.bsky.social', 'abc');
    expect(nav.openProfile).not.toHaveBeenCalled();
  });

  it('/profile/<actor> → openProfile', () => {
    const nav = mockNav();
    expect(pushInternalPath(nav, '/profile/alice.example')).toBe(true);
    expect(nav.openProfile).toHaveBeenCalledWith('alice.example');
  });

  it('DID actor / percent-encoded を decode して渡す', () => {
    const nav = mockNav();
    pushInternalPath(nav, '/profile/did%3Aplc%3Aabc/post/xyz');
    expect(nav.openPostByParts).toHaveBeenCalledWith('did:plc:abc', 'xyz');
  });

  it('対応外パス (feed/lists/空/余分) は false・nav を呼ばない', () => {
    const nav = mockNav();
    expect(pushInternalPath(nav, '/profile/a/feed/x')).toBe(false);
    expect(pushInternalPath(nav, '/profile')).toBe(false);
    expect(pushInternalPath(nav, '/settings')).toBe(false);
    expect(pushInternalPath(nav, '/profile/a/post/x/y')).toBe(false);
    expect(nav.openPostByParts).not.toHaveBeenCalled();
    expect(nav.openProfile).not.toHaveBeenCalled();
  });
});
