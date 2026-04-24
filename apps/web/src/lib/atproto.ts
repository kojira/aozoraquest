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

/** フォロー一覧取得時の最小型 (相性ランキング用)。 */
export interface FollowProfile {
  did: string;
  handle: string;
  displayName?: string;
  avatar?: string;
}

/**
 * フォロー一覧の先頭 1 ページ (最大 100 件) だけを取得。
 * カードのフレーバー発言者や軽量 UI 用。セッション中はメモリキャッシュ。
 */
const firstPageFollowsCache = new Map<string, FollowProfile[]>();
export async function fetchFirstPageFollows(agent: Agent, actor: string): Promise<FollowProfile[]> {
  const cached = firstPageFollowsCache.get(actor);
  if (cached) return cached;
  const res = await agent.getFollows({ actor, limit: 100 });
  const out: FollowProfile[] = res.data.follows.map((f) => ({
    did: f.did,
    handle: f.handle,
    ...(f.displayName ? { displayName: f.displayName } : {}),
    ...(f.avatar ? { avatar: f.avatar } : {}),
  }));
  firstPageFollowsCache.set(actor, out);
  return out;
}

/**
 * 指定アクターの follow 一覧を全件取得 (cursor pagination)。
 * Bluesky API は 1 ページ最大 100 件。
 */
export async function fetchFollows(agent: Agent, actor: string): Promise<FollowProfile[]> {
  const out: FollowProfile[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 50; page++) {   // 5000 件で打ち切り (安全装置)
    const res = await agent.getFollows({
      actor,
      limit: 100,
      ...(cursor !== undefined ? { cursor } : {}),
    });
    for (const f of res.data.follows) {
      out.push({
        did: f.did,
        handle: f.handle,
        ...(f.displayName ? { displayName: f.displayName } : {}),
        ...(f.avatar ? { avatar: f.avatar } : {}),
      });
    }
    cursor = res.data.cursor;
    if (!cursor) break;
  }
  return out;
}

/**
 * アクターの最新投稿 1 件の createdAt を返す。post なし or 取得失敗は null。
 * 相性ランキングの「直近 N 日以内に投稿したか」判定用の軽量 API。
 */
export async function fetchLatestPostAt(agent: Agent, actor: string): Promise<string | null> {
  try {
    const res = await agent.getAuthorFeed({ actor, limit: 1, filter: 'posts_no_replies' });
    const item = res.data.feed[0];
    if (!item) return null;
    const record = item.post.record as { createdAt?: string };
    return record.createdAt ?? item.post.indexedAt ?? null;
  } catch {
    return null;
  }
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
 * 指定 AT URI のスレッドを取得。
 * depth: 返信の深さ (各投稿の replies を何段潜るか)
 * parentHeight: 親方向にたどる最大段数
 */
export async function fetchPostThread(
  agent: Agent,
  uri: string,
  opts: { depth?: number; parentHeight?: number } = {},
) {
  const res = await agent.getPostThread({
    uri,
    depth: opts.depth ?? 6,
    parentHeight: opts.parentHeight ?? 10,
  });
  return res.data.thread;
}

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

/**
 * 画像付き投稿を作成する。画像を uploadBlob → `app.bsky.embed.images` embed
 * として post に紐付ける。
 * @param alt 画像の代替テキスト (アクセシビリティ)
 * @param tag  付与したいハッシュタグ (指定した場合 text 内から facet を抽出)
 */
export async function createPostWithImage(
  agent: Agent,
  text: string,
  blob: Blob,
  alt: string,
  tag?: string,
): Promise<void> {
  const res = await agent.uploadBlob(blob, { encoding: blob.type || 'image/png' });
  const record: Record<string, unknown> = {
    text,
    createdAt: new Date().toISOString(),
    via: VIA,
    embed: {
      $type: 'app.bsky.embed.images',
      images: [{ alt, image: res.data.blob }],
    },
  };
  if (tag) {
    const marker = `#${tag}`;
    const idx = text.indexOf(marker);
    if (idx >= 0) {
      const encoder = new TextEncoder();
      record['facets'] = [{
        index: {
          byteStart: encoder.encode(text.slice(0, idx)).length,
          byteEnd: encoder.encode(text.slice(0, idx + marker.length)).length,
        },
        features: [{ $type: 'app.bsky.richtext.facet#tag', tag }],
      }];
    }
  }
  await agent.post(record as unknown as Parameters<Agent['post']>[0]);
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
