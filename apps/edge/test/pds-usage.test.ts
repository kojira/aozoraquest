import { describe, it, expect, beforeEach } from 'vitest';
import { readRateLimitHeaders, recordPdsUsage, readPdsUsage, opsRemaining, resetPdsUsageThrottle, PERSIST_INTERVAL_SEC, TIGHT_INTERVAL_SEC, PUT_RECORD_POINTS } from '../src/pds-usage';

function mockKv() {
  const m = new Map<string, string>();
  let puts = 0;
  return {
    kv: { get: async (k: string) => m.get(k) ?? null, put: async (k: string, v: string) => { puts++; m.set(k, v); }, delete: async () => {} } as unknown as KVNamespace,
    puts: () => puts,
  };
}
const headers = (h: Record<string, string>) => ({ headers: { get: (n: string) => h[n] ?? null } });
const NOW = 1_700_000_000;

describe('PDS 書き込みレートの計測 (#548)', () => {
  beforeEach(() => resetPdsUsageThrottle());

  it('レート上限ヘッダを読む', () => {
    const snap = readRateLimitHeaders(headers({ 'ratelimit-limit': '5000', 'ratelimit-remaining': '4990', 'ratelimit-reset': '1700003600', 'ratelimit-policy': '5000;w=3600' }));
    expect(snap).toEqual({ limit: 5000, remaining: 4990, reset: 1700003600, policy: '5000;w=3600' });
  });

  it('ヘッダが無い PDS でも落ちない', () => {
    expect(readRateLimitHeaders(headers({}))).toEqual({ limit: null, remaining: null, reset: null, policy: null });
  });

  it('**KV への保存を間引く** (KV の 1 日 1,000 書き込みで先に飽和させない)', async () => {
    const { kv, puts } = mockKv();
    const snap = readRateLimitHeaders(headers({ 'ratelimit-limit': '5000', 'ratelimit-remaining': '4000' }));
    for (let i = 0; i < 50; i++) await recordPdsUsage(kv, snap, NOW);
    expect(puts()).toBe(1); // 5 分の窓の中なので 1 回だけ
    // 間引いた間の回数も失わない
    expect((await readPdsUsage(kv))!.writes).toBe(1);
    for (let i = 0; i < 10; i++) await recordPdsUsage(kv, snap, NOW + PERSIST_INTERVAL_SEC);
    expect(puts()).toBe(2);
    // 1 回目 + 間引いた 49 回 + 2 周目の 1 回 = 51 (残り 9 回は次の窓で合流する)
    expect((await readPdsUsage(kv))!.writes).toBe(51);
  });

  it('残量が 2 割を切ったら間隔を詰める。ただし毎回は書かない', async () => {
    // 毎回書くと KV 側 (同一キー 1 write/秒・1,000 write/日) が先に溢れ、しかも本体の
    // 書き込み経路に KV 往復が毎回乗る。逼迫時ほど落としてはいけない。
    const { kv, puts } = mockKv();
    const tight = readRateLimitHeaders(headers({ 'ratelimit-limit': '5000', 'ratelimit-remaining': '500' }));
    for (let i = 0; i < 5; i++) await recordPdsUsage(kv, tight, NOW);
    expect(puts()).toBe(1); // 10 秒の窓の中なので 1 回
    for (let i = 0; i < 5; i++) await recordPdsUsage(kv, tight, NOW + TIGHT_INTERVAL_SEC);
    expect(puts()).toBe(2);
    // 通常時 (5 分) より頻繁であることを確かめる
    expect(TIGHT_INTERVAL_SEC).toBeLessThan(PERSIST_INTERVAL_SEC);
  });

  it('残量から「あと何操作できるか」を出す', () => {
    expect(opsRemaining({ limit: 5000, remaining: 2500, reset: null, policy: null, at: NOW, writes: 0 })).toBe(2500 / PUT_RECORD_POINTS);
    expect(opsRemaining(null)).toBeNull();
  });
});
