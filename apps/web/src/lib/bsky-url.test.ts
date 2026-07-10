import { describe, it, expect } from 'vitest';
import { bskyAppLinkToInternalPath } from './bsky-url';

describe('bskyAppLinkToInternalPath', () => {
  it('投稿 URL (handle) → 内部の投稿詳細パス', () => {
    expect(
      bskyAppLinkToInternalPath('https://bsky.app/profile/nao774.bsky.social/post/abc123'),
    ).toBe('/profile/nao774.bsky.social/post/abc123');
  });

  it('投稿 URL (DID) → 内部パス (コロンは維持)', () => {
    expect(
      bskyAppLinkToInternalPath('https://bsky.app/profile/did:plc:abc/post/xyz'),
    ).toBe('/profile/did:plc:abc/post/xyz');
  });

  it('プロフィール URL → 内部プロフィールパス', () => {
    expect(bskyAppLinkToInternalPath('https://bsky.app/profile/alice.example')).toBe(
      '/profile/alice.example',
    );
  });

  it('www.bsky.app / http でも許可', () => {
    expect(bskyAppLinkToInternalPath('http://www.bsky.app/profile/a.example')).toBe(
      '/profile/a.example',
    );
  });

  it('末尾スラッシュを許容', () => {
    expect(bskyAppLinkToInternalPath('https://bsky.app/profile/a.example/')).toBe(
      '/profile/a.example',
    );
  });

  it('フィード / リスト / スターターパックは null (外部のまま)', () => {
    expect(bskyAppLinkToInternalPath('https://bsky.app/profile/a.example/feed/whats-hot')).toBeNull();
    expect(bskyAppLinkToInternalPath('https://bsky.app/profile/a.example/lists/xyz')).toBeNull();
    expect(bskyAppLinkToInternalPath('https://bsky.app/starter-pack/a.example/xyz')).toBeNull();
  });

  it('bsky.app 以外のホストは null', () => {
    expect(bskyAppLinkToInternalPath('https://example.com/profile/a/post/b')).toBeNull();
    expect(bskyAppLinkToInternalPath('https://evil-bsky.app/profile/a')).toBeNull();
    expect(bskyAppLinkToInternalPath('https://bsky.app.evil.com/profile/a')).toBeNull();
  });

  it('http/https 以外のスキームは null (XSS 回避)', () => {
    expect(bskyAppLinkToInternalPath('javascript:alert(1)')).toBeNull();
    expect(bskyAppLinkToInternalPath('at://did:plc:abc/app.bsky.feed.post/x')).toBeNull();
  });

  it('不正な URL / profile 以外のパスは null', () => {
    expect(bskyAppLinkToInternalPath('not a url')).toBeNull();
    expect(bskyAppLinkToInternalPath('https://bsky.app/')).toBeNull();
    expect(bskyAppLinkToInternalPath('https://bsky.app/settings')).toBeNull();
    expect(bskyAppLinkToInternalPath('https://bsky.app/profile')).toBeNull();
  });
});
