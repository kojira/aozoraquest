import type { Agent } from '@atproto/api';

/**
 * 自分の直近投稿を N 件取得 (リポスト・引用を除外)。
 */
export async function fetchMyPosts(agent: Agent, limit: number = 150): Promise<string[]> {
  const did = agent.assertDid;
  const texts: string[] = [];
  let cursor: string | undefined;

  while (texts.length < limit) {
    const res = await agent.getAuthorFeed({
      actor: did,
      limit: Math.min(100, limit - texts.length),
      ...(cursor !== undefined ? { cursor } : {}),
      filter: 'posts_no_replies',
    });
    for (const item of res.data.feed) {
      const post = item.post;
      const record = post.record as { text?: string; reply?: unknown };
      if (typeof record.text === 'string' && record.text.length >= 10) {
        texts.push(record.text);
      }
    }
    cursor = res.data.cursor;
    if (!cursor) break;
  }
  return texts.slice(0, limit);
}

/**
 * タイムライン (フォロー中) を 1 ページ取得。
 */
export async function fetchTimeline(agent: Agent, cursor?: string) {
  return agent.getTimeline({ limit: 30, ...(cursor !== undefined ? { cursor } : {}) });
}

/**
 * 指定 DID の直近投稿 (診断・共鳴 TL 用)。
 */
export async function fetchAuthorPosts(agent: Agent, did: string, limit: number = 20): Promise<string[]> {
  const res = await agent.getAuthorFeed({ actor: did, limit, filter: 'posts_no_replies' });
  const out: string[] = [];
  for (const item of res.data.feed) {
    const record = item.post.record as { text?: string };
    if (typeof record.text === 'string' && record.text.length >= 10) {
      out.push(record.text);
    }
  }
  return out;
}

/**
 * 指定 DID のフィードをそのまま (表示用に) 取得。
 */
export async function fetchAuthorFeed(agent: Agent, did: string, limit: number = 10) {
  const res = await agent.getAuthorFeed({ actor: did, limit, filter: 'posts_no_replies' });
  return res.data.feed;
}

/**
 * 投稿を作成。
 */
export async function createPost(agent: Agent, text: string) {
  return agent.post({ text, createdAt: new Date().toISOString() });
}

/**
 * AT Protocol レコードを書く。
 */
export async function putRecord(agent: Agent, collection: string, rkey: string, record: object) {
  const did = agent.assertDid;
  return agent.com.atproto.repo.putRecord({
    repo: did,
    collection,
    rkey,
    record: { ...record, $type: collection },
  });
}

export async function getRecord<T = unknown>(agent: Agent, repo: string, collection: string, rkey: string): Promise<T | null> {
  try {
    const res = await agent.com.atproto.repo.getRecord({ repo, collection, rkey });
    return res.data.value as T;
  } catch (e) {
    const msg = (e as { message?: string })?.message ?? '';
    if (/RecordNotFound|not found/i.test(msg)) return null;
    throw e;
  }
}

/** ハッシュタグ facet 付き投稿 (検索 API で拾えるようにする) */
export async function createTaggedPost(agent: Agent, text: string, tag: string): Promise<void> {
  const marker = `#${tag}`;
  const idx = text.indexOf(marker);
  const encoder = new TextEncoder();
  const facets = idx >= 0 ? [{
    index: {
      byteStart: encoder.encode(text.slice(0, idx)).length,
      byteEnd: encoder.encode(text.slice(0, idx + marker.length)).length,
    },
    features: [{ $type: 'app.bsky.richtext.facet#tag', tag }],
  }] : [];
  await agent.post({
    text,
    createdAt: new Date().toISOString(),
    ...(facets.length > 0 ? { facets } : {}),
  });
}
