import { describe, it, expect, vi } from 'vitest';
import { createPostWithImages, createPostWithImage, MAX_POST_IMAGES } from './atproto';
import type { Agent } from '@atproto/api';

function mockAgent() {
  const uploadBlob = vi.fn(async (blob: Blob) => ({ data: { blob: { $type: 'blob', mimeType: blob.type } } }));
  const post = vi.fn(async () => ({ uri: 'at://x/app.bsky.feed.post/1', cid: 'cid' }));
  return { agent: { uploadBlob, post } as unknown as Agent, uploadBlob, post };
}

const img = (type: string, alt: string) => ({ blob: new Blob([alt], { type }), alt });

describe('createPostWithImages', () => {
  it('uploads each image and builds embed.images preserving order', async () => {
    const { agent, uploadBlob, post } = mockAgent();
    await createPostWithImages(agent, 'hello', [img('image/webp', 'A'), img('image/jpeg', 'B')]);
    expect(uploadBlob).toHaveBeenCalledTimes(2);
    const record = post.mock.calls[0][0] as { embed: { $type: string; images: { alt: string }[] } };
    expect(record.embed.$type).toBe('app.bsky.embed.images');
    expect(record.embed.images.map((i) => i.alt)).toEqual(['A', 'B']);
  });

  it('caps at MAX_POST_IMAGES (4)', async () => {
    const { agent, uploadBlob, post } = mockAgent();
    const many = Array.from({ length: 6 }, (_, i) => img('image/webp', String(i)));
    await createPostWithImages(agent, '', many);
    expect(uploadBlob).toHaveBeenCalledTimes(MAX_POST_IMAGES);
    const record = post.mock.calls[0][0] as { embed: { images: unknown[] } };
    expect(record.embed.images).toHaveLength(MAX_POST_IMAGES);
  });

  it('adds a tag facet when the tag appears in text', async () => {
    const { agent, post } = mockAgent();
    await createPostWithImages(agent, 'みて #AozoraQuest', [img('image/webp', '')], 'AozoraQuest');
    const record = post.mock.calls[0][0] as { facets?: { features: { tag: string }[] }[] };
    expect(record.facets).toBeDefined();
    expect(record.facets?.[0].features[0].tag).toBe('AozoraQuest');
  });

  it('omits facets when the tag is not present in text', async () => {
    const { agent, post } = mockAgent();
    await createPostWithImages(agent, 'タグなし本文', [img('image/webp', '')], 'AozoraQuest');
    const record = post.mock.calls[0][0] as { facets?: unknown };
    expect(record.facets).toBeUndefined();
  });

  it('createPostWithImage delegates to the multi version (single image)', async () => {
    const { agent, uploadBlob, post } = mockAgent();
    await createPostWithImage(agent, 'hi', new Blob(['x'], { type: 'image/png' }), 'alt');
    expect(uploadBlob).toHaveBeenCalledTimes(1);
    const record = post.mock.calls[0][0] as { embed: { images: { alt: string }[] } };
    expect(record.embed.images).toHaveLength(1);
    expect(record.embed.images[0].alt).toBe('alt');
  });
});
