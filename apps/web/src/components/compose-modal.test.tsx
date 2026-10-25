// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useEffect } from 'react';

const { createPost, createPostWithImages } = vi.hoisted(() => ({
  createPostWithImages: vi.fn(async (..._args: unknown[]) => ({ uri: 'at://me/app.bsky.feed.post/3', cid: 'c3' })),
  createPost: vi.fn(async (..._args: unknown[]) => ({ uri: 'at://me/app.bsky.feed.post/4', cid: 'c4' })),
}));
vi.mock('@/lib/atproto', () => ({ createPost, createPostWithImages, MAX_POST_IMAGES: 4 }));
vi.mock('@/lib/session', () => ({ useSession: () => ({ agent: {}, did: 'did:plc:me' }) }));
vi.mock('@/lib/post-processor', () => ({ processSelfPost: vi.fn(async () => null) }));
vi.mock('@/lib/points', () => ({ bumpPower: vi.fn() }));

import { ComposeProvider, useCompose, type ComposeOpenOptions } from './compose-modal';

const replyTo = {
  root: { uri: 'at://r/app.bsky.feed.post/1', cid: 'rc' },
  parent: { uri: 'at://p/app.bsky.feed.post/2', cid: 'pc' },
  author: 'someone.example',
  text: 'もとの投稿',
};

function Opener({ opts }: { opts: ComposeOpenOptions }) {
  const { openCompose } = useCompose();
  useEffect(() => { openCompose(opts); }, [openCompose, opts]);
  return null;
}

describe('ComposeDialog の返信 (#820)', () => {
  afterEach(() => { cleanup(); vi.clearAllMocks(); });

  it('返信でも「画像を添付」ボタンが出る', () => {
    render(<ComposeProvider><Opener opts={{ replyTo }} /></ComposeProvider>);
    expect(screen.getByText('返信')).toBeTruthy();
    expect(screen.getByRole('button', { name: '画像を添付' })).toBeTruthy();
  });

  it('画像つきの返信は、返信先を渡して createPostWithImages を呼ぶ', async () => {
    URL.createObjectURL = vi.fn(() => 'blob:x');
    URL.revokeObjectURL = vi.fn();
    const image = { blob: new Blob(['a'], { type: 'image/webp' }), alt: 'A', source: 'user' as const };
    render(<ComposeProvider><Opener opts={{ replyTo, image }} /></ComposeProvider>);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '返信する' })); });
    await waitFor(() => expect(createPostWithImages).toHaveBeenCalledTimes(1));
    const call = createPostWithImages.mock.calls[0] as unknown[];
    expect(call[4]).toEqual({ root: replyTo.root, parent: replyTo.parent });
    expect(createPost).not.toHaveBeenCalled();
  });
});
