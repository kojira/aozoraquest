import type { Agent } from '@atproto/api';
import { BLUESKY_API_PAGE_LIMIT, DIAGNOSIS_MIN_POST_TEXT_LENGTH, DIAGNOSIS_POST_LIMIT, TIMELINE_PAGE_LIMIT } from '@aozoraquest/core';

/** クライアント識別子。TOKIMEKI 方式で post record 最上位に書き込む。 */
export const VIA = 'AozoraQuest';

/** 診断パイプラインで使う「本文 + 時刻」。 */
export interface DiagnosisPost {
  text: string;
  /** 投稿の createdAt (record) または indexedAt (feed) の ISO 文字列 */
  at: string;
}

/**
 * 自分の直近投稿を N 件取得 (リポスト・引用を除外)。
 * タイムスタンプ付きで返す (診断の時間軸考慮用)。
 */
export async function fetchMyPosts(agent: Agent, limit: number = DIAGNOSIS_POST_LIMIT): Promise<DiagnosisPost[]> {
  const did = agent.assertDid;
  const posts: DiagnosisPost[] = [];
  let cursor: string | undefined;

  while (posts.length < limit) {
    const res = await agent.getAuthorFeed({
      actor: did,
      limit: Math.min(BLUESKY_API_PAGE_LIMIT, limit - posts.length),
      ...(cursor !== undefined ? { cursor } : {}),
      filter: 'posts_no_replies',
    });
    for (const item of res.data.feed) {
      const post = item.post;
      const record = post.record as { text?: string; createdAt?: string; reply?: unknown };
      if (typeof record.text === 'string' && record.text.length >= DIAGNOSIS_MIN_POST_TEXT_LENGTH) {
        const at = record.createdAt ?? post.indexedAt ?? new Date().toISOString();
        posts.push({ text: record.text, at });
      }
    }
    cursor = res.data.cursor;
    if (!cursor) break;
  }
  return posts.slice(0, limit);
}

/**
 * 他ユーザーの直近投稿を診断用に N 件取得 (タイムスタンプ付き)。
 * 認証済みセッションで getAuthorFeed を呼ぶ (ブラウザ内で完結)。
 */
export async function fetchUserPostsForDiagnosis(
  agent: Agent,
  actor: string,
  limit: number = DIAGNOSIS_POST_LIMIT,
): Promise<DiagnosisPost[]> {
  const posts: DiagnosisPost[] = [];
  let cursor: string | undefined;

  while (posts.length < limit) {
    const res = await agent.getAuthorFeed({
      actor,
      limit: Math.min(BLUESKY_API_PAGE_LIMIT, limit - posts.length),
      ...(cursor !== undefined ? { cursor } : {}),
      filter: 'posts_no_replies',
    });
    for (const item of res.data.feed) {
      const post = item.post;
      const record = post.record as { text?: string; createdAt?: string };
      if (typeof record.text === 'string' && record.text.length >= DIAGNOSIS_MIN_POST_TEXT_LENGTH) {
        const at = record.createdAt ?? post.indexedAt ?? new Date().toISOString();
        posts.push({ text: record.text, at });
      }
    }
    cursor = res.data.cursor;
    if (!cursor) break;
  }
  return posts.slice(0, limit);
}

/**
 * タイムライン (フォロー中) を 1 ページ取得。
 */
export async function fetchTimeline(agent: Agent, cursor?: string) {
  return agent.getTimeline({ limit: TIMELINE_PAGE_LIMIT, ...(cursor !== undefined ? { cursor } : {}) });
}

/**
 * 指定 DID の直近投稿 (診断・共鳴 TL 用)。
 */
export async function fetchAuthorPosts(agent: Agent, did: string, limit: number = 20): Promise<string[]> {
  const res = await agent.getAuthorFeed({ actor: did, limit, filter: 'posts_no_replies' });
  const out: string[] = [];
  for (const item of res.data.feed) {
    const record = item.post.record as { text?: string };
    if (typeof record.text === 'string' && record.text.length >= DIAGNOSIS_MIN_POST_TEXT_LENGTH) {
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

export interface StrongRef { uri: string; cid: string }
export interface ReplyRef { root: StrongRef; parent: StrongRef }

/**
 * 投稿を作成。reply を渡すとスレッド返信になる。
 * クライアント識別のため `via: VIA` を record top-level に付加 (TOKIMEKI 互換)。
 */
export async function createPost(agent: Agent, text: string, reply?: ReplyRef) {
  const base: { text: string; createdAt: string; via: string; reply?: ReplyRef } = {
    text,
    createdAt: new Date().toISOString(),
    via: VIA,
  };
  if (reply) base.reply = reply;
  return agent.post(base as unknown as Parameters<Agent['post']>[0]);
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
    const err = e as { name?: string; message?: string };
    if (err?.name === 'RecordNotFoundError') return null;
    const msg = err?.message ?? '';
    if (/RecordNotFound|not found|could not locate/i.test(msg)) return null;
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
  const record = {
    text,
    createdAt: new Date().toISOString(),
    via: VIA,
    ...(facets.length > 0 ? { facets } : {}),
  };
  await agent.post(record as unknown as Parameters<Agent['post']>[0]);
}
