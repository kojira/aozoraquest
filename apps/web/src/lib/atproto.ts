import { RichText, type Agent } from '@atproto/api';
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
  /** 相互フォロー (相手も viewer をフォロー返ししているか)。
   *  ※ actor が viewer 自身の場合のみ意味を持つ (viewer.followedBy 由来)。 */
  isMutual?: boolean;
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
    ...(f.viewer?.followedBy ? { isMutual: true } : {}),
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
        ...(f.viewer?.followedBy ? { isMutual: true } : {}),
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

/** 通知一覧の 1 ページ取得 (cursor 式)。 */
export async function listNotifications(agent: Agent, cursor?: string) {
  const res = await agent.app.bsky.notification.listNotifications({
    limit: 30,
    ...(cursor !== undefined ? { cursor } : {}),
  });
  return res.data;
}

export async function getUnreadNotificationCount(agent: Agent): Promise<number> {
  try {
    const res = await agent.app.bsky.notification.getUnreadCount({});
    return res.data.count ?? 0;
  } catch {
    return 0;
  }
}

/** 通知を見たことをサーバーに通知 (これで getUnreadCount が 0 に戻る)。 */
export async function updateNotificationsSeen(
  agent: Agent,
  seenAt: string = new Date().toISOString(),
): Promise<void> {
  try {
    await agent.app.bsky.notification.updateSeen({ seenAt });
  } catch (e) {
    console.warn('[notifications] updateSeen failed', e);
  }
}

/** 複数の投稿 URI をまとめて取得 (getPosts は 1 リクエスト 25 件まで)。 */
export async function fetchPosts(agent: Agent, uris: string[]) {
  if (uris.length === 0) return [];
  const unique = Array.from(new Set(uris));
  const chunks: string[][] = [];
  for (let i = 0; i < unique.length; i += 25) chunks.push(unique.slice(i, i + 25));
  const results = await Promise.all(
    chunks.map((batch) => agent.app.bsky.feed.getPosts({ uris: batch })),
  );
  return results.flatMap((r) => r.data.posts);
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
  const base: { text: string; createdAt: string; via: string; reply?: ReplyRef; facets?: unknown[] } = {
    text,
    createdAt: new Date().toISOString(),
    via: VIA,
  };
  if (reply) base.reply = reply;
  const facets = await detectPostFacets(agent, text);
  if (facets) base.facets = facets;
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

/** AT Protocol レコードを削除する (自分の repo のみ)。E2E のクリーンアップ等に使う。 */
export async function deleteRecord(agent: Agent, collection: string, rkey: string) {
  const did = agent.assertDid;
  return agent.com.atproto.repo.deleteRecord({ repo: did, collection, rkey });
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
 * 投稿本文から richtext facet (URL リンク / @メンション / #ハッシュタグ) を自動検出する。
 * - URL → `facet#link` (他クライアントでもクリック可能になる)
 * - @handle → `facet#mention` (handle を DID に解決。要ネットワーク)
 * - #tag → `facet#tag` (検索 API で拾える)
 * detectFacets は内部で正しい byte index を計算するので、手組みより堅牢。
 * 失敗しても投稿自体は止めない (facet 無しで投稿)。
 */
async function detectPostFacets(agent: Agent, text: string): Promise<unknown[] | undefined> {
  if (!text) return undefined;
  const rt = new RichText({ text });
  try {
    await rt.detectFacets(agent);
  } catch (e) {
    console.warn('[atproto] facet 検出に失敗 (facet 無しで投稿)', e);
    return undefined;
  }
  if (!rt.facets || rt.facets.length === 0) return undefined;
  // detectFacets は handle を解決できなかった mention に did:'' を残す。
  // 空 did の mention facet をそのまま post すると壊れた facet が PDS に書かれる
  // (通知投稿は必ず @handle を含むので、相手が離脱/改名/解決失敗だと発生する) ため除外する。
  const MENTION = 'app.bsky.richtext.facet#mention';
  const clean = rt.facets.filter((f) =>
    f.features.every((ft) => {
      const feat = ft as { $type?: string; did?: string };
      return feat.$type !== MENTION || (typeof feat.did === 'string' && feat.did.length > 0);
    }),
  );
  return clean.length > 0 ? clean : undefined;
}

/** Bluesky の 1 投稿あたり画像添付上限。 */
export const MAX_POST_IMAGES = 4;

/**
 * 画像付き投稿を作成する。最大 {@link MAX_POST_IMAGES} 枚を uploadBlob して
 * `app.bsky.embed.images` embed として post に紐付ける (画像は配列順で表示)。
 * @param images 各 {blob, alt}。alt は a11y 用 (空でも可)
 * @param tag    互換のため残置。facet (リンク/メンション/#tag) は detectPostFacets が
 *               text から自動検出するので、ハッシュタグもこの引数なしで facet 化される。
 */
export async function createPostWithImages(
  agent: Agent,
  text: string,
  images: Array<{ blob: Blob; alt: string }>,
  tag?: string,
): Promise<void> {
  void tag; // facet 検出は自動化済み。引数は呼び出し側互換のため受けるだけ。
  // 呼び出し側 (UI) を信頼せず lib 側でも 4 枚に切り詰める最終ガード。
  const picked = images.slice(0, MAX_POST_IMAGES);
  const record: Record<string, unknown> = {
    text,
    createdAt: new Date().toISOString(),
    via: VIA,
  };
  if (picked.length > 0) {
    // 並列アップロード (map は順序を保持するので表示順は維持される)
    const uploaded = await Promise.all(
      picked.map(async ({ blob, alt }) => {
        const res = await agent.uploadBlob(blob, { encoding: blob.type || 'image/png' });
        return { alt, image: res.data.blob };
      }),
    );
    record['embed'] = { $type: 'app.bsky.embed.images', images: uploaded };
  }
  // picked が空なら embed を付けない (空 images embed は不正なので作らない)。
  const facets = await detectPostFacets(agent, text);
  if (facets) record['facets'] = facets;
  await agent.post(record as unknown as Parameters<Agent['post']>[0]);
}

/** ハッシュタグ facet 付き投稿 (検索 API で拾えるようにする)。
 *  text に含まれる #tag / URL / @mention をまとめて facet 化する。 */
export async function createTaggedPost(agent: Agent, text: string, tag: string): Promise<void> {
  void tag; // #tag は text に含まれている前提。facet 化は detectPostFacets が自動で行う。
  const facets = await detectPostFacets(agent, text);
  const record = {
    text,
    createdAt: new Date().toISOString(),
    via: VIA,
    ...(facets ? { facets } : {}),
  };
  await agent.post(record as unknown as Parameters<Agent['post']>[0]);
}
