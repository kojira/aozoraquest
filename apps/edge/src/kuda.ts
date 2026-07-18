/**
 * 物理乱数 (kuda) クライアント — docs/21-server-authority §4.3。
 *
 * **既定は CSPRNG** (`crypto.getRandomValues`、Worker 内秘匿) で先読み不可を担保する。kuda
 * (`kuda.kojiran.workers.dev/drop`, ANU 量子乱数) は**付加価値の任意エントロピー源**であり、
 * プール有限・外部依存・レイテンシがあるので**戦闘のクリティカルパスに必須で置かない**。
 * 障害/枯渇/タイムアウト時は必ず CSPRNG にフォールバックする (kuda 障害 = 全戦闘停止を避ける)。
 * クライアントは介在しない (Worker→kuda のみ)。
 */

export const KUDA_URL = 'https://kuda.kojiran.workers.dev/drop';

/** kuda /drop の応答 (1 バイト 0–255 + 監査メタ)。 */
export interface KudaDrop {
  value: number;
  drop_seq: number;
  pool_seq: number;
  batch: string;
  drawn_at: string;
  pool_remaining: number;
}

/** 乱数 1 バイトの取得結果。source を監査ログに残す (§4.3)。 */
export interface EntropyByte {
  /** 0–255。 */
  value: number;
  /** どこ由来か (kuda = 物理乱数 / csprng = フォールバック)。 */
  source: 'kuda' | 'csprng';
  /** kuda 由来なら監査メタ。 */
  meta?: { drop_seq: number; batch: string; pool_remaining: number };
}

/** CSPRNG で 1 バイト。Worker 内秘匿で先読み不可。 */
export function csprngByte(): EntropyByte {
  const b = new Uint8Array(1);
  crypto.getRandomValues(b);
  return { value: b[0], source: 'csprng' };
}

/**
 * kuda から物理乱数 1 バイトを引く。タイムアウト・非2xx・不正値は throw。
 * **クリティカルパスでは直接使わず** `entropyByte` 経由でフォールバックさせること。
 */
export async function drawKudaByte(opts: { timeoutMs?: number; fetchImpl?: typeof fetch } = {}): Promise<EntropyByte> {
  const timeoutMs = opts.timeoutMs ?? 1500;
  const f = opts.fetchImpl ?? fetch;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await f(KUDA_URL, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`kuda ${res.status}`);
    const d = (await res.json()) as Partial<KudaDrop>;
    if (typeof d.value !== 'number' || !Number.isInteger(d.value) || d.value < 0 || d.value > 255) {
      throw new Error('kuda 応答が不正 (value)');
    }
    return {
      value: d.value,
      source: 'kuda',
      meta: { drop_seq: d.drop_seq ?? -1, batch: d.batch ?? '', pool_remaining: d.pool_remaining ?? -1 },
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * エントロピー 1 バイト取得。`useKuda` が真なら kuda を試み、**失敗時は CSPRNG に必ずフォールバック**
 * (fail-safe。報酬 fail-closed とは別で、乱数源の障害は戦闘を止めない)。既定は CSPRNG のみ。
 * kuda の障害は監査可能にするため `onFallback` で通知する (呼び出し側で csprng フォールバック回数を
 * 数え、kuda アウテージを可視化できるように)。
 */
export async function entropyByte(
  opts: { useKuda?: boolean; timeoutMs?: number; fetchImpl?: typeof fetch; onFallback?: (err: unknown) => void } = {},
): Promise<EntropyByte> {
  if (!opts.useKuda) return csprngByte();
  try {
    return await drawKudaByte(opts);
  } catch (err) {
    opts.onFallback?.(err); // kuda 障害/枯渇/タイムアウト → CSPRNG (可観測にする)
    return csprngByte();
  }
}

/**
 * 32bit のエントロピー seed を取得 (`resolveTurn` の turnSeed 等に使う)。**1 ターンの乱数は
 * `createRng(seed)` の 32bit seed から stream を展開するので、8bit では 256 通りしか無く総当たり
 * で先読みされうる (レビュー ★★)。必ず 32bit 分の新鮮なエントロピーを供給すること。**
 * 常に CSPRNG で 4 バイトを確保し、`useKuda` 時は物理乱数 1 バイトを最下位に XOR して混ぜる
 * (kuda 障害でも 32bit の質は CSPRNG が担保 = fail-safe)。返り値は符号なし 32bit。
 */
export async function entropyU32(
  opts: { useKuda?: boolean; timeoutMs?: number; fetchImpl?: typeof fetch; onFallback?: (err: unknown) => void } = {},
): Promise<{ value: number; source: 'kuda+csprng' | 'csprng'; meta?: EntropyByte['meta'] }> {
  const buf = new Uint8Array(4);
  crypto.getRandomValues(buf);
  let value = ((buf[0] << 24) | (buf[1] << 16) | (buf[2] << 8) | buf[3]) >>> 0;
  if (opts.useKuda) {
    const b = await entropyByte(opts); // kuda 成功なら物理 1 バイト、失敗なら csprng 1 バイト
    value = (value ^ b.value) >>> 0;
    if (b.source === 'kuda') return { value, source: 'kuda+csprng', meta: b.meta };
  }
  return { value, source: 'csprng' };
}
