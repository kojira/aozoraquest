import { describe, it, expect } from 'vitest';
import type { AppBskyFeedDefs } from '@atproto/api';
import { extractPostQuote, extractPostImages } from './post-embed';

/** テスト用に post.embed だけ差し替えた最小の PostView を作る。 */
function postWithEmbed(embed: unknown): AppBskyFeedDefs.PostView {
  return {
    uri: 'at://did:plc:me/app.bsky.feed.post/self',
    cid: 'cid',
    author: { did: 'did:plc:me', handle: 'me.example', viewer: {}, labels: [] },
    record: { text: '本文', $type: 'app.bsky.feed.post' },
    indexedAt: '2026-07-10T00:00:00.000Z',
    ...(embed ? { embed: embed as AppBskyFeedDefs.PostView['embed'] } : {}),
  } as AppBskyFeedDefs.PostView;
}

const viewRecord = {
  $type: 'app.bsky.embed.record#viewRecord',
  uri: 'at://did:plc:nao/app.bsky.feed.post/abc',
  cid: 'qcid',
  author: { did: 'did:plc:nao', handle: 'nao774.bsky.social', displayName: 'nao' },
  value: {
    $type: 'app.bsky.feed.post',
    text: 'でもそれはそれとして公式が本筋として…',
    createdAt: '2026-07-10T13:00:00.000Z',
    facets: [
      {
        index: { byteStart: 0, byteEnd: 4 },
        features: [{ $type: 'app.bsky.richtext.facet#link', uri: 'https://example.com' }],
      },
    ],
  },
  embeds: [],
};

describe('extractPostQuote', () => {
  it('embed が無ければ null', () => {
    expect(extractPostQuote(postWithEmbed(null))).toBeNull();
  });

  it('画像だけの embed は引用ではないので null', () => {
    const embed = { $type: 'app.bsky.embed.images#view', images: [] };
    expect(extractPostQuote(postWithEmbed(embed))).toBeNull();
  });

  it('record#view の viewRecord を post として抽出 (author/text/facets)', () => {
    const embed = { $type: 'app.bsky.embed.record#view', record: viewRecord };
    const q = extractPostQuote(postWithEmbed(embed));
    expect(q?.kind).toBe('post');
    if (q?.kind !== 'post') throw new Error('expected post');
    expect(q.uri).toBe('at://did:plc:nao/app.bsky.feed.post/abc');
    expect(q.author.handle).toBe('nao774.bsky.social');
    expect(q.author.displayName).toBe('nao');
    expect(q.text).toContain('公式が本筋');
    expect(q.facets?.length).toBe(1);
    expect(q.images).toEqual([]);
    expect(q.createdAt).toBe('2026-07-10T13:00:00.000Z');
  });

  it('recordWithMedia#view は record.record を辿って引用を抽出しつつ、media 画像は extractPostImages で拾える', () => {
    const embed = {
      $type: 'app.bsky.embed.recordWithMedia#view',
      record: { $type: 'app.bsky.embed.record#view', record: viewRecord },
      media: {
        $type: 'app.bsky.embed.images#view',
        images: [{ thumb: 't', fullsize: 'f', alt: 'a' }],
      },
    };
    const post = postWithEmbed(embed);
    const q = extractPostQuote(post);
    expect(q?.kind).toBe('post');
    // media 側の画像は「この投稿自身の画像」として拾われる (引用カードではなく本体グリッド)
    expect(extractPostImages(post)).toHaveLength(1);
  });

  it('引用先が自前で持つ画像 (embeds) はサムネとして拾う', () => {
    const embed = {
      $type: 'app.bsky.embed.record#view',
      record: {
        ...viewRecord,
        embeds: [
          { $type: 'app.bsky.embed.images#view', images: [{ thumb: 't', fullsize: 'f', alt: '' }] },
        ],
      },
    };
    const q = extractPostQuote(postWithEmbed(embed));
    if (q?.kind !== 'post') throw new Error('expected post');
    expect(q.images).toHaveLength(1);
  });

  it('未取得系 (notFound/blocked/detached) は unavailable', () => {
    const mk = (t: string) => ({ $type: 'app.bsky.embed.record#view', record: { $type: t, uri: 'at://x/y/z' } });
    expect(extractPostQuote(postWithEmbed(mk('app.bsky.embed.record#viewNotFound')))).toEqual({
      kind: 'unavailable',
      reason: 'notFound',
    });
    expect(extractPostQuote(postWithEmbed(mk('app.bsky.embed.record#viewBlocked')))).toEqual({
      kind: 'unavailable',
      reason: 'blocked',
    });
    expect(extractPostQuote(postWithEmbed(mk('app.bsky.embed.record#viewDetached')))).toEqual({
      kind: 'unavailable',
      reason: 'detached',
    });
  });

  it('フィード / リスト埋め込みは other (ラベル付き)', () => {
    const feed = {
      $type: 'app.bsky.embed.record#view',
      record: { $type: 'app.bsky.feed.defs#generatorView', displayName: 'みんなのフィード' },
    };
    const q = extractPostQuote(postWithEmbed(feed));
    expect(q?.kind).toBe('other');
    if (q?.kind !== 'other') throw new Error('expected other');
    expect(q.label).toContain('みんなのフィード');

    const list = {
      $type: 'app.bsky.embed.record#view',
      record: { $type: 'app.bsky.graph.defs#listView', name: '仲間リスト' },
    };
    const ql = extractPostQuote(postWithEmbed(list));
    expect(ql?.kind).toBe('other');
    if (ql?.kind !== 'other') throw new Error('expected other');
    expect(ql.label).toContain('仲間リスト');
  });

  it('未知の record union $type は null (壊さない)', () => {
    const embed = { $type: 'app.bsky.embed.record#view', record: { $type: 'com.example.unknown#view' } };
    expect(extractPostQuote(postWithEmbed(embed))).toBeNull();
  });

  it('uri が無い viewRecord は null (壊れたデータ)', () => {
    const embed = {
      $type: 'app.bsky.embed.record#view',
      record: { $type: 'app.bsky.embed.record#viewRecord', author: {}, value: {} },
    };
    expect(extractPostQuote(postWithEmbed(embed))).toBeNull();
  });
});
