/**
 * Bluesky 公式 (bsky.app) の投稿 / プロフィール URL を、あおぞらくえすと内部の
 * ルートパスに変換する。あおぞらで開けるのは投稿詳細とプロフィールのみ:
 *
 *   https://bsky.app/profile/<actor>               → /profile/<actor>
 *   https://bsky.app/profile/<actor>/post/<rkey>   → /profile/<actor>/post/<rkey>
 *
 * feed / lists / starter-pack など、あおぞらに対応ルートが無いものは null を返し、
 * 呼び出し側は従来どおり外部リンク (別タブ) として扱う。<actor> は handle でも DID でも可。
 *
 * パスの組み立ては postDetailPath / mention リンクと同じく **エンコードしない**
 * (handle は DNS 名・DID はコロンを含むがパスセグメントとして合法。react-router が解決する)。
 */
export function bskyAppLinkToInternalPath(url: string): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null; // 相対 URL や不正文字列
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  const host = u.hostname.toLowerCase();
  if (host !== 'bsky.app' && host !== 'www.bsky.app') return null;

  const parts = u.pathname.split('/').filter((s) => s.length > 0);
  // 対応するのは /profile/... 配下のみ
  if (parts[0] !== 'profile' || parts.length < 2) return null;
  const actor = safeDecode(parts[1]);
  if (!actor) return null;

  if (parts.length === 2) {
    // プロフィール
    return `/profile/${actor}`;
  }
  if (parts.length === 4 && parts[2] === 'post') {
    const rkey = safeDecode(parts[3]);
    if (!rkey) return null;
    return `/profile/${actor}/post/${rkey}`;
  }
  // /profile/<actor>/feed/... や /lists/... 等はあおぞら未対応 → 外部
  return null;
}

function safeDecode(s: string | undefined): string {
  if (!s) return '';
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}
