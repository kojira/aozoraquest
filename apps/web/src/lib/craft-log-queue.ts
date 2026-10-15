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
  /** 保留に入れた時刻 (診断用。捨てる判断は attempts と MAX_PENDING で行う) */
  queuedAt: string;
  /** 書き直しを試した回数。上限を超えたら諦めて捨てる (下の MAX_ATTEMPTS 参照) */
  attempts?: number;
}

/** 端末に貯める上限。壊れた repo 相手に無限に積まないための単純な上限。 */
const MAX_PENDING = 20;

/** 1 件あたりの再送上限。**これが無いと先頭で詰まる** — lexicon 検証エラーのように
 *  何度送っても通らない record が先頭に来ると、後続の正常な記帳が永久に書かれない
 *  (レビュー ★★)。上限で捨てれば、失う履歴はその 1 件だけで済む。 */
const MAX_ATTEMPTS = 5;

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
  const list = pendingCraftLogs(did);
  // 試行回数は引き継ぐ (同じ rkey を積み直すたびに 0 に戻ると上限が効かない)
  const attempts = list.find((x) => x.rkey === e.rkey)?.attempts;
  const rest = list.filter((x) => x.rkey !== e.rkey);
  rest.push({ rkey: e.rkey, record: e.record, queuedAt: at, ...(attempts ? { attempts } : {}) });
  save(did, rest);
}

/**
 * 保留を古い順に書き直す。返り値は書けた件数。
 *
 * 1 件でも失敗したら**そこで止める** (残りは次の機会へ)。落ちている相手に
 * 20 件連続で投げても通らないし、レート制限を悪化させるだけなので。
 * ただし同じ 1 件で止まり続けないよう試行回数を数え、MAX_ATTEMPTS で諦めて捨てる。
 */
export async function flushCraftLogs(agent: Agent, did: string): Promise<number> {
  const list = pendingCraftLogs(did);
  if (list.length === 0) return 0;
  /** 保留から外す rkey (書けた or 諦めた) */
  const settled = new Set<string>();
  /** 残すが試行回数だけ進める rkey */
  const bumped = new Map<string, number>();
  let done = 0;
  for (const entry of list) {
    try {
      await writeCraftLog(agent, entry.rkey, entry.record);
      settled.add(entry.rkey);
      done += 1;
    } catch (e) {
      const attempts = (entry.attempts ?? 0) + 1;
      if (attempts >= MAX_ATTEMPTS) {
        console.warn('[craftlog] giving up after retries', entry.rkey, e);
        settled.add(entry.rkey);
      } else {
        console.warn('[craftlog] retry failed', entry.rkey, e);
        bumped.set(entry.rkey, attempts);
      }
      break;
    }
  }
  // **書き戻す直前に読み直す**。開始時のスナップショットで上書きすると、
  // 再送の往復中に積まれた保留 (店を開いた直後に作って記帳が落ちた等) を
  // 一度も送らないまま消してしまう (レビュー ★★★)。
  const latest = pendingCraftLogs(did)
    .filter((e) => !settled.has(e.rkey))
    .map((e) => {
      const n = bumped.get(e.rkey);
      return n === undefined ? e : { ...e, attempts: n };
    });
  save(did, latest);
  return done;
}

/** 保留を丸ごと捨てる。ワールドリセット (完全ワイプ) から呼ぶ — 消したはずの制作レコードが
 *  保留から書き戻されると、幽霊個体が並び、0 に戻したパワー消費も再集計で復活する
 *  (レビュー ★★)。 */
export function clearCraftLogQueue(did: string): void {
  save(did, []);
}
