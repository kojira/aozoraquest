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

/**
 * **投稿の XP を申告する唯一の入口。** 前に落ちた申告を先に出し直し、今回の申告が落ちたら
 * 覚えておく。post-processor はこれを呼ぶだけで、保留の出し入れを自分では触らない
 * (申告の経路が増えても保留の扱いが 1 か所に留まる)。
 *
 * `send` が投げたら null (投稿処理は続ける — edge が落ちている間でも投稿は成立させたい)。
 * `c` が null なら出し直しだけ行う。
 */
export async function claimPostXp<T>(
  send: (c: Pick<PendingClaim, 'postUri' | 'archetype'>) => Promise<T>,
  c: Pick<PendingClaim, 'postUri' | 'archetype'> | null,
): Promise<T | null> {
  await flushPendingClaims((p) => send(p).then(() => undefined));
  if (!c) return null;
  try {
    const r = await send(c);
    forgetPendingClaim(c.postUri);
    return r;
  } catch (e) {
    console.warn('xp claim failed', c.postUri, e);
    rememberPendingClaim({ ...c, at: Date.now() });
    return null;
  }
}

/** テスト用: 記録を消す。 */
export function clearPendingClaims(): void {
  try { localStorage.removeItem(KEY); } catch { /* no-op */ }
}
