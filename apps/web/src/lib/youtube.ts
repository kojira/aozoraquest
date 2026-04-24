/**
 * YouTube URL から動画 ID を取り出す。対応形式:
 *   - https://www.youtube.com/watch?v=<id>
 *   - https://youtube.com/watch?v=<id>
 *   - https://youtu.be/<id>
 *   - https://www.youtube.com/shorts/<id>
 *   - https://www.youtube.com/embed/<id>
 *   - https://m.youtube.com/watch?v=<id>
 * 一致しなければ null。
 */
export function youtubeId(url: string): string | null {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, '').replace(/^m\./, '');
    if (host === 'youtu.be') {
      const id = u.pathname.slice(1).split('/')[0] ?? '';
      return isValidId(id) ? id : null;
    }
    if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
      if (u.pathname === '/watch') {
        const id = u.searchParams.get('v') ?? '';
        return isValidId(id) ? id : null;
      }
      const m = u.pathname.match(/^\/(?:shorts|embed|live)\/([^/]+)/);
      if (m) return isValidId(m[1]!) ? m[1]! : null;
    }
    return null;
  } catch {
    return null;
  }
}

function isValidId(id: string): boolean {
  return /^[A-Za-z0-9_-]{6,20}$/.test(id);
}

export function youtubeEmbedUrl(id: string): string {
  return `https://www.youtube-nocookie.com/embed/${id}`;
}
