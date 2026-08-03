import type { Agent } from '@atproto/api';
import { CraftLogError, writeCraftLog } from './crafting';

/**
 * **書けなかった記帳をあとで書き直すための保留キュー** (#642)。
 *
 * なんでも屋の制作・合成・ひきとり・すてるは、サーバーが結果を確定したあとで
 * ユーザー PDS に履歴を書く。所持の権威はサーバーなのでこの書き込みが落ちても
 * 品は消えないが、黙って捨てると
 *
 *   - 履歴が永久に欠ける (サーバーから所持個体が取れないときの表示フォールバックにも出ない)
 *   - パワー会計がずれる (points.ts は craft コレクションを再スキャンして
 *     消費 `craftPowerSpent` / 獲得 `salePowerEarned` を出す)
 *
 * ので、**同じ rkey のまま**保留して次の機会に書き直す。createRecord は同 rkey で
 * 衝突するため、二重記帳は構造的に起きない (既に書けていた場合は成功として捨てる)。
 *
 * リロードを跨いで消えないよう localStorage に置く。DID ごとに分けるのは、同じ端末で
 * 別アカウントに切り替えたときに他人の repo へ書きにいかないため。
 */

export interface PendingCraftLog {
  rkey: string;
  record: Record<string, unknown>;
  /** 保留に入れた時刻 (古いものから捨てるため) */
  queuedAt: string;
}

/** 端末に貯める上限。壊れた repo 相手に無限に積まないための単純な上限。 */
const MAX_PENDING = 20;

function keyFor(did: string): string {
  return `aq.craftlog.pending.${did}`;
}

export function pendingCraftLogs(did: string): PendingCraftLog[] {
  try {
    const raw = localStorage.getItem(keyFor(did));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (e): e is PendingCraftLog =>
        !!e && typeof e === 'object' && typeof (e as PendingCraftLog).rkey === 'string' && !!(e as PendingCraftLog).record,
    );
  } catch {
    return []; // private mode / 壊れた JSON。履歴の再送は best-effort なので黙って諦める
  }
}

function save(did: string, list: PendingCraftLog[]): void {
  try {
    if (list.length === 0) localStorage.removeItem(keyFor(did));
    else localStorage.setItem(keyFor(did), JSON.stringify(list.slice(-MAX_PENDING)));
  } catch {
    /* private mode。保留できないだけで、その場の操作は成立している */
  }
}

/** 記帳の失敗を保留に積む。同じ rkey が既にあれば入れ替える (再送で同じ物を二重に積まない)。 */
export function enqueueCraftLog(did: string, e: CraftLogError, at: string): void {
  const list = pendingCraftLogs(did).filter((x) => x.rkey !== e.rkey);
  list.push({ rkey: e.rkey, record: e.record, queuedAt: at });
  save(did, list);
}

/**
 * 保留を古い順に書き直す。返り値は書けた件数。
 *
 * 1 件でも失敗したら**そこで止める** (残りは次の機会へ)。落ちている相手に
 * 20 件連続で投げても通らないし、レート制限を悪化させるだけなので。
 */
export async function flushCraftLogs(agent: Agent, did: string): Promise<number> {
  const list = pendingCraftLogs(did);
  if (list.length === 0) return 0;
  let done = 0;
  for (const entry of list) {
    try {
      await writeCraftLog(agent, entry.rkey, entry.record);
      done += 1;
    } catch (e) {
      console.warn('[craftlog] retry failed', entry.rkey, e);
      break;
    }
  }
  if (done > 0) save(did, list.slice(done));
  return done;
}
