import { describe, it, expect } from 'vitest';
import { didFromUri, rkeyFromUri, postDetailPath } from './uri';

describe('didFromUri', () => {
  it('通常の at-uri から authority (did) を取る', () => {
    expect(didFromUri('at://did:plc:abc/app.bsky.feed.post/xyz')).toBe('did:plc:abc');
  });
  it('collection/rkey が無くても authority を取る', () => {
    expect(didFromUri('at://did:plc:abc')).toBe('did:plc:abc');
  });
  it('handle authority でも取れる', () => {
    expect(didFromUri('at://alice.example/app.bsky.feed.post/1')).toBe('alice.example');
  });
  it('at:// でない / 壊れた文字列は空文字', () => {
    expect(didFromUri('https://bsky.app/profile/x')).toBe('');
    expect(didFromUri('')).toBe('');
    expect(didFromUri('nonsense')).toBe('');
  });
});

describe('postDetailPath + didFromUri の合わせ技', () => {
  it('handle 欠落時に DID で /profile/<did>/post/<rkey> を組める', () => {
    const uri = 'at://did:plc:nao/app.bsky.feed.post/abc';
    expect(postDetailPath(didFromUri(uri), uri)).toBe('/profile/did:plc:nao/post/abc');
    expect(rkeyFromUri(uri)).toBe('abc');
  });
});
