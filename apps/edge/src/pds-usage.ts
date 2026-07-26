/**
 * サーバーアカウント PDS の**書き込みレート消費**を記録する (#548 / #551)。
 *
 * **なぜ要るか**: 権威 state は全ユーザーが 1 つのサーバーアカウント repo を共有している
 * (docs/21 §9-1)。Bluesky の書き込み上限は DID ごとに
 * **5,000 points/時 ・ 35,000 points/日** で、`putRecord` は 1 回 2 points。
 * つまり**全ユーザー合計で 1 日 17,500 操作 / 1 時間 2,500 操作**が天井になる。
 * 「1 操作」は 移動 (街に入るとき) / 戦闘 1 ターン / しらべる / 購入 / 投稿の申告 など。
 *
 * この天井に近づいたら PDS (サーバーアカウント) を分割する必要があるが、**近づいたことに
 * 気づく手段が無かった**。Bluesky は XRPC 応答にレート上限のヘッダを返すので、それを
 * 拾って残しておき、管理画面から見えるようにする。
 *
 * **保存先は Cloudflare KV。PDS には書かない** — 計測のために PDS へ書いたら、その書き込み自体が
 * point を食って本末転倒になる。読み取り (管理画面) は PDS の point を 1 も消費しない。
 *
 * ただし **KV にも 1 日 1,000 書き込みの上限がある** (Workers 無料枠)。PDS の天井
 * (1 日 17,500 操作) より低いので、毎回書くと**計測が先に飽和して本体を止めかねない**。
 * そこで `shouldPersist` で間引く: 通常は isolate ごとに 5 分に 1 回、
 * ただし残量が 2 割を切ったら毎回残す (逼迫しているときこそ数字が要る)。
 */

const KEY = 'pds:usage';

/** Bluesky が返すレート上限ヘッダのスナップショット。 */
export interface PdsUsage {
  /** その窓での上限 point 数 (`ratelimit-limit`)。 */
  limit: number | null;
  /** 残り point 数 (`ratelimit-remaining`)。 */
  remaining: number | null;
  /** 窓がリセットされる epoch 秒 (`ratelimit-reset`)。 */
  reset: number | null;
  /** 上限の方式 (`ratelimit-policy`。例 "5000;w=3600")。 */
  policy: string | null;
  /** このスナップショットを取った時刻 (epoch 秒)。 */
  at: number;
  /** 起動以来この Worker が観測した書き込み回数 (KV 上で積む。目安)。 */
  writes: number;
}

/** 応答ヘッダからレート上限を読む。ヘッダが無い PDS もあるので null 許容。 */
export function readRateLimitHeaders(res: { headers: { get(name: string): string | null } }): Omit<PdsUsage, 'at' | 'writes'> {
  const num = (v: string | null) => {
    if (v === null) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  return {
    limit: num(res.headers.get('ratelimit-limit')),
    remaining: num(res.headers.get('ratelimit-remaining')),
    reset: num(res.headers.get('ratelimit-reset')),
    policy: res.headers.get('ratelimit-policy'),
  };
}

/**
 * スナップショットを保存する。**best-effort** — ここが失敗しても本来の書き込みは成功
 * させる (計測のために業務を落とさない)。
 */
export async function recordPdsUsage(kv: KVNamespace | undefined, snap: Omit<PdsUsage, 'at' | 'writes'>, now: number): Promise<void> {
  if (!kv) return;
  // isolate ローカルの積み上げ。KV へ書くのは間引くので、その間の回数はここで数える。
  pendingWrites += 1;
  if (!shouldPersist(snap, now)) return;
  const persisted = pendingWrites;
  pendingWrites = 0;
  lastPersistAt = now;
  try {
    const prev = await readPdsUsage(kv);
    const next: PdsUsage = { ...snap, at: now, writes: (prev?.writes ?? 0) + persisted };
    await kv.put(KEY, JSON.stringify(next));
  } catch {
    /* 計測は落ちても構わない (本体の書き込みは既に成功している) */
  }
}

/** KV への保存を間引く間隔 (秒)。isolate ごとに効く。 */
export const PERSIST_INTERVAL_SEC = 300;
/** この割合を下回ったら間引かずに毎回残す (逼迫しているときこそ数字が要る)。 */
export const TIGHT_RATIO = 0.2;

let lastPersistAt = 0;
let pendingWrites = 0;

function shouldPersist(snap: Omit<PdsUsage, 'at' | 'writes'>, now: number): boolean {
  if (snap.limit && snap.remaining !== null && snap.remaining / snap.limit < TIGHT_RATIO) return true;
  return now - lastPersistAt >= PERSIST_INTERVAL_SEC;
}

/** テスト用: 間引きの状態をリセットする。 */
export function resetPdsUsageThrottle(): void {
  lastPersistAt = 0;
  pendingWrites = 0;
}

export async function readPdsUsage(kv: KVNamespace | undefined): Promise<PdsUsage | null> {
  if (!kv) return null;
  try {
    const raw = await kv.get(KEY);
    return raw ? (JSON.parse(raw) as PdsUsage) : null;
  } catch {
    return null;
  }
}

/** 1 回の `putRecord` が消費する point (Bluesky の公表値)。 */
export const PUT_RECORD_POINTS = 2;

/**
 * 残量から「あと何操作できるか」を出す。管理画面が「分割の潮時か」を判断するための数字。
 * ヘッダが無ければ null。
 */
export function opsRemaining(usage: PdsUsage | null): number | null {
  if (!usage || usage.remaining === null) return null;
  return Math.floor(usage.remaining / PUT_RECORD_POINTS);
}
