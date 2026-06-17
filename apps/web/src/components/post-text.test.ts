import { describe, it, expect } from 'vitest';
import { segmentPost, safeLinkUri, type Facet, type FacetFeature } from './post-text';

// byte index は UTF-8。テスト用に文字列の byte offset を測るヘルパ。
const enc = new TextEncoder();
const byteLen = (s: string) => enc.encode(s).length;

/** text 内の marker の byte 範囲で facet を作る。 */
function facetAt(text: string, marker: string, feature: FacetFeature): Facet {
  const idx = text.indexOf(marker);
  return {
    index: { byteStart: byteLen(text.slice(0, idx)), byteEnd: byteLen(text.slice(0, idx + marker.length)) },
    features: [feature],
  };
}

describe('segmentPost', () => {
  it('facet が無い投稿の URL を自動リンクする', () => {
    const segs = segmentPost('見て https://example.com/x すごい');
    expect(segs).toEqual([
      { kind: 'text', text: '見て ' },
      { kind: 'link', text: 'https://example.com/x', uri: 'https://example.com/x' },
      { kind: 'text', text: ' すごい' },
    ]);
  });

  it('【本丸】#tag facet だけ付いた投稿でも、facet の隙間の URL を自動リンクする', () => {
    // クエスト発行投稿の再現: tag facet は付くが URL は facet 化されていない
    const text = '【クエスト】完了報告 https://aozoraquest.app/board/at%3A%2F#aozoraquest';
    const facets = [facetAt(text, '#aozoraquest', { $type: 'app.bsky.richtext.facet#tag', tag: 'aozoraquest' })];
    const segs = segmentPost(text, facets);
    // URL が link セグメントになっていること (= 以前は text のままだった不具合)
    expect(segs.some((s) => s.kind === 'link' && s.uri === 'https://aozoraquest.app/board/at%3A%2F')).toBe(true);
    // #aozoraquest は tag セグメント
    expect(segs.some((s) => s.kind === 'tag' && s.tag === 'aozoraquest')).toBe(true);
    // 全セグメントを連結すると原文に戻る (欠落しない)
    expect(segs.map((s) => s.text).join('')).toBe(text);
  });

  it('link facet をそのままリンク化する', () => {
    const text = 'aaa link bbb';
    const facets = [facetAt(text, 'link', { $type: 'app.bsky.richtext.facet#link', uri: 'https://t.co/abc' })];
    const segs = segmentPost(text, facets);
    expect(segs).toContainEqual({ kind: 'link', text: 'link', uri: 'https://t.co/abc' });
  });

  it('mention facet を handle 付き mention にする', () => {
    const text = 'hi @alice.bsky.social !';
    const facets = [facetAt(text, '@alice.bsky.social', { $type: 'app.bsky.richtext.facet#mention', did: 'did:plc:xxx' })];
    const segs = segmentPost(text, facets);
    expect(segs).toContainEqual({ kind: 'mention', text: '@alice.bsky.social', handle: 'alice.bsky.social' });
  });

  it('複数 facet の前後と隙間をすべて埋め、原文が復元できる', () => {
    const text = 'a #tagA b https://x.io c #tagB';
    const facets = [
      facetAt(text, '#tagA', { $type: 'app.bsky.richtext.facet#tag', tag: 'tagA' }),
      facetAt(text, '#tagB', { $type: 'app.bsky.richtext.facet#tag', tag: 'tagB' }),
    ];
    const segs = segmentPost(text, facets);
    expect(segs.map((s) => s.text).join('')).toBe(text);
    expect(segs.some((s) => s.kind === 'link' && s.uri === 'https://x.io')).toBe(true);
    expect(segs.filter((s) => s.kind === 'tag')).toHaveLength(2);
  });

  it('壊れた facet (範囲外) は無視しつつ本文を欠落させない', () => {
    const text = 'hello world';
    const facets: Facet[] = [{ index: { byteStart: 100, byteEnd: 200 }, features: [] }];
    const segs = segmentPost(text, facets);
    expect(segs.map((s) => s.text).join('')).toBe(text);
  });

  it('@mention と #tag を facet 無しで自動リンク', () => {
    const segs = segmentPost('@bob.test と #ねこ');
    expect(segs).toContainEqual({ kind: 'mention', text: '@bob.test', handle: 'bob.test' });
    expect(segs).toContainEqual({ kind: 'tag', text: '#ねこ', tag: 'ねこ' });
  });

  // ─── XSS: facet の uri は投稿者が自由に付けられるので scheme を検証する ───
  it('link facet の uri が javascript: のときはリンク化せず素のテキストにする', () => {
    const text = 'click here';
    const facets = [facetAt(text, 'here', { $type: 'app.bsky.richtext.facet#link', uri: 'javascript:alert(document.cookie)' })];
    const segs = segmentPost(text, facets);
    // link セグメントを作らない (= <a href="javascript:..."> が描画されない)
    expect(segs.some((s) => s.kind === 'link')).toBe(false);
    // 原文は欠落しない
    expect(segs.map((s) => s.text).join('')).toBe(text);
  });

  it('link facet の uri が data: のときもリンク化しない', () => {
    const text = 'x data y';
    const facets = [facetAt(text, 'data', { $type: 'app.bsky.richtext.facet#link', uri: 'data:text/html,<script>alert(1)</script>' })];
    const segs = segmentPost(text, facets);
    expect(segs.some((s) => s.kind === 'link')).toBe(false);
  });

  it('link facet の http/https はこれまで通りリンク化する', () => {
    const text = 'a link b';
    for (const uri of ['https://example.com/x', 'http://example.com']) {
      const facets = [facetAt(text, 'link', { $type: 'app.bsky.richtext.facet#link', uri })];
      expect(segmentPost(text, facets)).toContainEqual({ kind: 'link', text: 'link', uri });
    }
  });
});

describe('safeLinkUri', () => {
  it('http/https はそのまま返す', () => {
    expect(safeLinkUri('https://example.com/x')).toBe('https://example.com/x');
    expect(safeLinkUri('http://example.com')).toBe('http://example.com');
  });

  it('javascript: / data: / vbscript: / mailto: は null', () => {
    expect(safeLinkUri('javascript:alert(1)')).toBeNull();
    expect(safeLinkUri('data:text/html,x')).toBeNull();
    expect(safeLinkUri('vbscript:msgbox(1)')).toBeNull();
    expect(safeLinkUri('mailto:a@b.com')).toBeNull();
  });

  it('空白/制御文字による scheme 回避 (java\\tscript:) も null', () => {
    expect(safeLinkUri(' javascript:alert(1)')).toBeNull();
    expect(safeLinkUri('java\tscript:alert(1)')).toBeNull();
    expect(safeLinkUri('JavaScript:alert(1)')).toBeNull();
  });

  it('相対 URL や不正な文字列は null', () => {
    expect(safeLinkUri('/foo/bar')).toBeNull();
    expect(safeLinkUri('not a url')).toBeNull();
    expect(safeLinkUri('')).toBeNull();
  });
});
