/**
 * @atproto/oauth-client-node が Cloudflare Workers (nodejs_compat) 上で
 * import 解決できるかの PoC スイッチ。
 *
 * 結果 (2026-06-05): **動かない**。内部依存 undici が import 評価時に
 * process.env.NODE_DEBUG.split(',') を実行し、Workers polyfill では
 * undefined.split で TypeError になる。@atproto-labs/fetch-node も
 * https.Agent 依存で Workers 互換でない。
 *
 * よって @atproto/oauth-client (core) を Web Crypto + native fetch で
 * 自前 adapter する方向に切り替えた (docs/15-user-quest.md §認証 参照)。
 * この probe は履歴として残しておき、Workers の互換性が改善されたら
 * 再検証する。
 */

export async function probeOAuthLibrary(): Promise<{ ok: boolean; symbol: string; keys?: string[]; error?: string; stack?: string }> {
  try {
    const mod: Record<string, unknown> = await import('@atproto/oauth-client-node');
    const keys = Object.keys(mod);
    const ok = typeof mod.NodeOAuthClient === 'function';
    return { ok, symbol: ok ? 'NodeOAuthClient' : 'missing', keys };
  } catch (e) {
    const err = e as Error;
    return {
      ok: false,
      symbol: 'error',
      error: String(err?.message ?? e),
      stack: err?.stack?.slice(0, 2000),
    };
  }
}
