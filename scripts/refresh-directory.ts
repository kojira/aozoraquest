/**
 * 発見ディレクトリ (app.aozoraquest.directory) を #aozoraquest 投稿から自動更新する。
 *
 * admin UI の「検索から更新 → 保存 (PDS に書き込み)」
 * (apps/admin/src/routes/directory.tsx) を headless で行うバージョン。
 * GitHub Actions の cron (毎時) から実行する想定。
 *
 * 認証: 管理者アカウントの **app password** (BLUESKY_ADMIN_APP_PASSWORD)。
 * 検索 (searchPosts) 自体は公開 API だが、ディレクトリの putRecord は
 * 管理者 PDS への書き込みなので createSession (login) が要る。
 *
 * 方針: 自動ジョブは **追加のみ**。手動で削除したエントリを毎時復活させない
 * よう、既存 users は保持して新規 DID を append するだけ
 * (削除は admin UI で行う)。新規 0 件なら putRecord を打たない
 * (updatedAt を毎時無駄に書き換えない)。
 *
 * 書き込み仕様は apps/admin/src/lib/pds.ts と完全一致させること
 * (record に `$type: collection` を付ける)。
 */
import { AtpAgent } from '@atproto/api';

interface Entry {
  did: string;
  addedAt: string;
  note?: string;
}
interface DirectoryRecord {
  users: Entry[];
  updatedAt: string;
}

// admin PDS の service URL。bsky.social ホストのアカウントは entryway が
// login 後に実 PDS へルーティングするので既定で動くが、**セルフホスト /
// サードパーティ PDS の管理者アカウントの場合は当該ホストを必ず指定する**
// (さもないと login 失敗 or 誤った repo を参照する)。
const SERVICE = process.env.BLUESKY_SERVICE ?? 'https://bsky.social';
const IDENTIFIER = process.env.BLUESKY_ADMIN_IDENTIFIER;
const APP_PASSWORD = process.env.BLUESKY_ADMIN_APP_PASSWORD;
const NSID_ROOT = process.env.NSID_ROOT ?? 'app.aozoraquest';
// web 側 (runtime-config.ts) が読む primary admin DID。書き込み先 (この
// スクリプトが login する DID) と一致しないと、毎時「成功」でも web に一切
// 反映されない silent failure になる。設定されていれば突合して守る。
const EXPECTED_ADMIN_DIDS = (process.env.ADMIN_DIDS ?? process.env.VITE_ADMIN_DIDS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const OPTIN_TAG = process.env.OPTIN_TAG ?? 'aozoraquest';
const MAX_PAGES = Math.max(1, Number(process.env.MAX_PAGES ?? '5') || 5);
const COLLECTION = `${NSID_ROOT}.directory`;
const RKEY = 'self';

function isNotFound(e: unknown): boolean {
  const err = e as { name?: string; message?: string };
  if (err?.name === 'RecordNotFoundError') return true;
  return /RecordNotFound|not found|could not locate|InvalidRequest/i.test(err?.message ?? '');
}

async function main(): Promise<void> {
  // 認証情報が未設定なら no-op で正常終了する。
  // (secrets を設定する前から cron が毎時「失敗 (赤 X)」になるのを避ける。
  //  設定後は普通に実行される。)
  if (!IDENTIFIER || !APP_PASSWORD) {
    console.warn(
      '[refresh-directory] BLUESKY_ADMIN_IDENTIFIER / BLUESKY_ADMIN_APP_PASSWORD が未設定のため skip します。' +
        ' GitHub の Settings → Environments → main に secret を設定してください。',
    );
    return;
  }

  const agent = new AtpAgent({ service: SERVICE });
  await agent.login({ identifier: IDENTIFIER, password: APP_PASSWORD });
  const did = agent.assertDid;
  console.log(`[refresh-directory] logged in as ${did} (${SERVICE}), collection=${COLLECTION}`);

  // 書き込み先 (login した DID) が web の読み取り先 (VITE_ADMIN_DIDS primary)
  // と一致するか検証する。取り違えると毎時「成功」でも web に反映されない
  // ので、設定されていてズレていたら fail させて可視化する。
  if (EXPECTED_ADMIN_DIDS.length > 0 && !EXPECTED_ADMIN_DIDS.includes(did)) {
    console.error(
      `[refresh-directory] ログイン DID (${did}) が ADMIN_DIDS (${EXPECTED_ADMIN_DIDS.join(', ')}) に含まれません。` +
        ' BLUESKY_ADMIN_IDENTIFIER と VITE_ADMIN_DIDS が同一アカウントを指しているか確認してください。',
    );
    process.exit(1);
  }

  // 既存ディレクトリレコード (なければ空) を取得
  let existingUsers: Entry[] = [];
  try {
    const res = await agent.com.atproto.repo.getRecord({ repo: did, collection: COLLECTION, rkey: RKEY });
    const val = res.data.value as Partial<DirectoryRecord>;
    if (Array.isArray(val.users)) existingUsers = val.users as Entry[];
    console.log(`[refresh-directory] 既存 ${existingUsers.length} 人`);
  } catch (e) {
    if (!isNotFound(e)) throw e;
    console.log('[refresh-directory] 既存レコードなし。新規作成します');
  }

  const seen = new Set(existingUsers.map((u) => u.did));
  const users: Entry[] = [...existingUsers];

  // #aozoraquest 検索を最大 MAX_PAGES ページ走査 (admin UI と同じ上限)
  let cursor: string | undefined;
  let totalPosts = 0;
  const uniqueAuthors = new Set<string>();
  let added = 0;
  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await agent.app.bsky.feed.searchPosts({
      q: `#${OPTIN_TAG}`,
      limit: 100,
      ...(cursor !== undefined ? { cursor } : {}),
    });
    totalPosts += res.data.posts.length;
    for (const post of res.data.posts) {
      const author = post.author?.did;
      if (!author) continue;
      uniqueAuthors.add(author);
      if (seen.has(author)) continue;
      seen.add(author);
      users.push({ did: author, addedAt: new Date().toISOString(), note: 'auto' });
      added++;
    }
    const next = res.data.cursor;
    if (!next || next === cursor) break;
    cursor = next;
  }

  console.log(
    `[refresh-directory] posts=${totalPosts} uniqueAuthors=${uniqueAuthors.size} 新規=${added} 合計=${users.length}`,
  );

  if (added === 0) {
    console.log('[refresh-directory] 新規オプトインなし。書き込みを skip します');
    return;
  }

  const record: DirectoryRecord = { users, updatedAt: new Date().toISOString() };
  await agent.com.atproto.repo.putRecord({
    repo: did,
    collection: COLLECTION,
    rkey: RKEY,
    // apps/admin/src/lib/pds.ts と同じく $type を付与する
    record: { ...record, $type: COLLECTION },
  });
  console.log(`[refresh-directory] ${users.length} 人を ${COLLECTION}/${RKEY} に書き込みました`);
}

main().catch((e) => {
  console.error('[refresh-directory] FAILED:', e);
  process.exit(1);
});
