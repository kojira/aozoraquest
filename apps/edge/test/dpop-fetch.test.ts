import { describe, it, expect } from 'vitest';
import { p256 } from '@noble/curves/p256';
import { base64urlnopad } from '@scure/base';
import { dpopFetch } from '../src/dpop-fetch';
import type { EcJwk } from '../src/oauth-jwt';

function makeJwk(): EcJwk {
  const d = new Uint8Array(32).fill(9);
  const pub = p256.getPublicKey(d, false);
  return { kty: 'EC', crv: 'P-256', x: base64urlnopad.encode(pub.slice(1, 33)), y: base64urlnopad.encode(pub.slice(33, 65)), d: base64urlnopad.encode(d) };
}
const jwk = makeJwk();
const NOW = 1000;
const withNonce = (b: unknown, nonce: string, status = 400) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json', 'DPoP-Nonce': nonce } });

describe('dpop-fetch', () => {
  it('DPoP ヘッダを付ける / accessToken 時は Authorization: DPoP も付ける', async () => {
    let seen: Headers | undefined;
    const f = (async (_u: string, init: RequestInit) => { seen = new Headers(init.headers); return new Response('{}', { status: 200 }); }) as unknown as typeof fetch;
    await dpopFetch('https://pds.example/x', { method: 'POST' }, { jwk, accessToken: 'AT', now: NOW, fetchImpl: f });
    expect(seen?.get('DPoP')).toBeTruthy();
    expect(seen?.get('Authorization')).toBe('DPoP AT');
  });

  it('use_dpop_nonce (JSON body) チャレンジで nonce を付けて 1 回だけ再送し成功する', async () => {
    let calls = 0;
    const nonces: string[] = [];
    const f = (async (_u: string, init: RequestInit) => {
      calls++;
      nonces.push(new Headers(init.headers).get('DPoP') ? 'proof' : '');
      if (calls === 1) return withNonce({ error: 'use_dpop_nonce' }, 'NONCE-1', 400);
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as unknown as typeof fetch;
    let captured = '';
    const res = await dpopFetch('https://as.example/token', { method: 'POST' }, { jwk, now: NOW, fetchImpl: f, onNonce: (n) => { captured = n; } });
    expect(res.status).toBe(200);
    expect(calls).toBe(2); // 初回チャレンジ + nonce 付き再送
    expect(captured).toBe('NONCE-1');
  });

  it('use_dpop_nonce (WWW-Authenticate ヘッダ) でも再送する', async () => {
    let calls = 0;
    const f = (async () => {
      calls++;
      if (calls === 1) return new Response('', { status: 401, headers: { 'www-authenticate': 'DPoP error="use_dpop_nonce"', 'DPoP-Nonce': 'N2' } });
      return new Response('ok', { status: 200 });
    }) as unknown as typeof fetch;
    const res = await dpopFetch('https://pds.example/xrpc/x', { method: 'POST' }, { jwk, now: NOW, fetchImpl: f });
    expect(res.status).toBe(200);
    expect(calls).toBe(2);
  });

  it('再送は 1 回まで (nonce を出し続けても無限ループしない)', async () => {
    let calls = 0;
    const f = (async () => { calls++; return withNonce({ error: 'use_dpop_nonce' }, `N${calls}`, 400); }) as unknown as typeof fetch;
    const res = await dpopFetch('https://as.example/token', { method: 'POST' }, { jwk, now: NOW, fetchImpl: f });
    expect(calls).toBe(2); // 初回 + 再送 1 回で打ち止め
    expect(res.status).toBe(400); // 最後のレスポンスをそのまま返す
  });

  it('nonce 要求でない 400/401 は再送せずそのまま返す (body は消費しない)', async () => {
    let calls = 0;
    const f = (async () => { calls++; return new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400, headers: { 'content-type': 'application/json' } }); }) as unknown as typeof fetch;
    const res = await dpopFetch('https://as.example/token', { method: 'POST' }, { jwk, now: NOW, fetchImpl: f });
    expect(calls).toBe(1);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe('invalid_grant'); // body 未消費で読める
  });

  it('成功レスポンスの DPoP-Nonce も onNonce で通知する (次回用に更新)', async () => {
    const f = (async () => new Response('{}', { status: 200, headers: { 'DPoP-Nonce': 'FRESH' } })) as unknown as typeof fetch;
    let n = '';
    await dpopFetch('https://pds.example/x', { method: 'GET' }, { jwk, now: NOW, fetchImpl: f, onNonce: (x) => { n = x; } });
    expect(n).toBe('FRESH');
  });
});
