import { describe, it, expect, vi } from 'vitest';
import { createPostWithImages, MAX_POST_IMAGES } from './atproto';
import type { Agent } from '@atproto/api';

interface PostRecord {
  text: string;
  embed?: { $type: string; images: { alt: string }[] };
  facets?: { features: { tag?: string }[] }[];
}

function mockAgent() {
  let posted: PostRecord | undefined;
  const uploadBlob = vi.fn(async (blob: Blob) => ({ data: { blob: { $type: 'blob', mimeType: blob.type } } }));
  const post = vi.fn(async (record: unknown) => {
    posted = record as PostRecord;
    return { uri: 'at://x/app.bsky.feed.post/1', cid: 'cid' };
  });
  return { agent: { uploadBlob, post } as unknown as Agent, uploadBlob, post, posted: () => posted };
}

const img = (type: string, alt: string) => ({ blob: new Blob([alt], { type }), alt });

describe('createPostWithImages', () => {
  it('uploads each image and builds embed.images preserving order', async () => {
    const m = mockAgent();
    await createPostWithImages(m.agent, 'hello', [img('image/webp', 'A'), img('image/jpeg', 'B')]);
    expect(m.uploadBlob).toHaveBeenCalledTimes(2);
    const rec = m.posted();
    expect(rec?.embed?.$type).toBe('app.bsky.embed.images');
    expect(rec?.embed?.images.map((i) => i.alt)).toEqual(['A', 'B']);
  });

  it('caps at MAX_POST_IMAGES (4)', async () => {
    const m = mockAgent();
    const many = Array.from({ length: 6 }, (_, i) => img('image/webp', String(i)));
    await createPostWithImages(m.agent, '', many);
    expect(m.uploadBlob).toHaveBeenCalledTimes(MAX_POST_IMAGES);
    expect(m.posted()?.embed?.images).toHaveLength(MAX_POST_IMAGES);
  });

  it('adds a tag facet when the tag appears in text', async () => {
    const m = mockAgent();
    await createPostWithImages(m.agent, 'みて #AozoraQuest', [img('image/webp', '')], 'AozoraQuest');
    const facets = m.posted()?.facets;
    expect(facets).toBeDefined();
    expect(facets?.[0]?.features?.[0]?.tag).toBe('AozoraQuest');
  });

  it('omits facets when the tag is not present in text', async () => {
    const m = mockAgent();
    await createPostWithImages(m.agent, 'タグなし本文', [img('image/webp', '')], 'AozoraQuest');
    expect(m.posted()?.facets).toBeUndefined();
  });

  it('posts a single image correctly', async () => {
    const m = mockAgent();
    await createPostWithImages(m.agent, 'hi', [img('image/png', 'alt')]);
    expect(m.uploadBlob).toHaveBeenCalledTimes(1);
    expect(m.posted()?.embed?.images.map((i) => i.alt)).toEqual(['alt']);
  });

  it('omits the embed entirely for an empty image list (text-only post)', async () => {
    const m = mockAgent();
    await createPostWithImages(m.agent, 'text only', []);
    expect(m.uploadBlob).not.toHaveBeenCalled();
    expect(m.posted()?.embed).toBeUndefined();
    expect(m.posted()?.text).toBe('text only');
  });
});
