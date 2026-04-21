/**
 * 管理者判定と発券。
 * ADMIN_DIDS のビルド時定数と、Bluesky OAuth ログイン結果を突き合わせる。
 */

export function getAdminDids(): string[] {
  const raw = import.meta.env.VITE_ADMIN_DIDS ?? '';
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

export function getPrimaryAdminDid(): string | null {
  return getAdminDids()[0] ?? null;
}

export function isAdmin(did: string | null | undefined): boolean {
  if (!did) return false;
  return getAdminDids().includes(did);
}
