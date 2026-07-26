/**
 * **申告できなかった投稿を覚えておき、次の機会に出し直す** (#551)。
 *
 * XP の記録先を権威 state に移したので、投稿の XP は edge への申告でしか入らない。
 * 申告が落ちたとき (PDS/plc の一時障害・回線断・Worker タイムアウト) に何もしないと、
 * **その投稿の XP は永久に消える** — `processSelfPost` は投稿時にしか走らないので、
 * 同じ postUri を出し直す経路がどこにも無かった。
 *
 * サーバー側が冪等 (同じ投稿は 2 度積まない) なので、**出し直しは常に安全**。
 * 覚えるのは localStorage で、消えても「その投稿ぶんが入らない」だけで壊れない。
 */
const KEY = 'aq.pendingClaims';
/** 覚えておく件数。古い投稿はサーバー側で年齢制限に当たるので、多く持っても意味がない。 */
const MAX_PENDING = 20;

export interface PendingClaim {
  postUri: string;
  archetype: string;
  /** 積んだ時刻 (ms)。古すぎるものは捨てる。 */
  at: number;
}

/** サーバー側の年齢制限より短くする (どうせ通らないものを送り続けない)。 */
const MAX_AGE_MS = 2 * 24 * 3600 * 1000;

function load(): PendingClaim[] {
  try {
    const raw = localStorage.getItem(KEY);
    const list = raw ? (JSON.parse(raw) as PendingClaim[]) : [];
    const now = Date.now();
    return list.filter((c) => c && typeof c.postUri === 'string' && now - c.at < MAX_AGE_MS);
  } catch {
    return [];
  }
}

function save(list: PendingClaim[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(-MAX_PENDING)));
  } catch {
    /* quota 等は無視 (次の投稿でまた積まれる) */
  }
}

export function rememberPendingClaim(c: PendingClaim): void {
  const list = load().filter((x) => x.postUri !== c.postUri);
  save([...list, c]);
}

export function forgetPendingClaim(postUri: string): void {
  save(load().filter((c) => c.postUri !== postUri));
}

export function pendingClaims(): PendingClaim[] {
  return load();
}

/**
 * 溜まっている申告を順に出し直す。
 *
 * **1 件でも失敗したらそこで止める** — 通信が死んでいるなら残りも失敗するので、
 * 無駄に往復せず次の機会に回す。成功したものだけ忘れる。
 */
export async function flushPendingClaims(
  claim: (c: PendingClaim) => Promise<void>,
): Promise<number> {
  let done = 0;
  for (const c of pendingClaims()) {
    try {
      await claim(c);
      forgetPendingClaim(c.postUri);
      done++;
    } catch (e) {
      console.warn('pending claim retry failed', c.postUri, e);
      break;
    }
  }
  return done;
}

/** テスト用: 記録を消す。 */
export function clearPendingClaims(): void {
  try { localStorage.removeItem(KEY); } catch { /* no-op */ }
}
