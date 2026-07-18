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
 */
export async function entropyByte(opts: { useKuda?: boolean; timeoutMs?: number; fetchImpl?: typeof fetch } = {}): Promise<EntropyByte> {
  if (!opts.useKuda) return csprngByte();
  try {
    return await drawKudaByte(opts);
  } catch {
    return csprngByte(); // kuda 障害/枯渇/タイムアウト → CSPRNG
  }
}
