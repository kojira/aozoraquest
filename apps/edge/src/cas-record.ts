/**
 * サーバー repo の 1 レコードを CAS (swapRecord) で読み直して書き直すループ。GameState (game-state.ts) と
 * 街の棚 townStock (market-stock.ts, D-MARKET-001) が同じものを使う。
 *
 * - InvalidSwap (別リクエストが割り込んで CID が変わった) なら最新を読み直して mutate をやり直す
 * - mutate が**受け取った値をそのまま返した**ら「変更なし」で、書かない (#548)。
 *   レコードがまだ無いときに書くかどうかは `writeWhenCreated` で決める (GameState は作ること自体が変更)
 * - mutate は副作用を持たない純関数であること (リトライで何度も呼ばれる)
 */
import { PdsError } from './pds';
import { serverPutRecord, type ServerPdsEnv } from './server-pds';

export interface CasRecordLoop<T extends object> {
  collection: string;
  rkey: string;
  /** 現在時刻 (epoch 秒)。DPoP/token 期限に使う。 */
  now: number;
  retries: number;
  /** 最新のレコード (無ければ null)。 */
  read: () => Promise<{ value: T; cid: string } | null>;
  /** レコードが無いときの初期値。 */
  fresh: () => Promise<T>;
  mutate: (current: T) => T;
  /** 書く直前の値 (version・updatedAt を刻むなど)。 */
  stamp: (next: T) => T;
  /** レコードが無いとき、mutate が変更なしでも作るか。 */
  writeWhenCreated: boolean;
}

export async function casRecordLoop<T extends object>(env: ServerPdsEnv, loop: CasRecordLoop<T>): Promise<T> {
  for (let attempt = 0; attempt <= loop.retries; attempt++) {
    const existing = await loop.read();
    const current = existing?.value ?? (await loop.fresh());
    const mutated = loop.mutate(current);
    if (mutated === current && (existing || !loop.writeWhenCreated)) return current; // 変更なし: 書かない
    const next = loop.stamp(mutated);
    // 既存があればその CID を期待 (CAS)、無ければ null (新規作成のみ) で二重作成も防ぐ。
    try {
      await serverPutRecord(env, loop.now, loop.collection, loop.rkey, next, existing ? existing.cid : null);
      return next;
    } catch (e) {
      if (e instanceof PdsError && e.xrpcError === 'InvalidSwap') {
        if (attempt < loop.retries) continue; // 競合 → 再読込して mutate をやり直し
        throw new PdsError('CAS リトライ上限 (競合が解消しない)', 409, 'CasExhausted');
      }
      throw e; // 非 InvalidSwap (ServerWriteError 含む) は即 throw
    }
  }
  throw new PdsError('unreachable'); // ループは必ず return/throw する
}
