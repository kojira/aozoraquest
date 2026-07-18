/**
 * OAuth confidential client 用の P-256 鍵ペアを生成する (docs/21 §12)。
 *
 *   - client 署名鍵 (private_key_jwt 用): private → Worker Secret / public → client-metadata.json の jwks
 *   - DPoP 鍵: private → Worker Secret (公開部分は DPoP proof ヘッダに毎回埋まるので別途公開不要)
 *
 * private JWK は **gitignore 下の `.oauth-keys/` に書き出し**、標準出力には公開部分と設定コマンドだけ
 * 出す (秘密鍵をチャット/クリップボードに晒さないため)。実行: `node scripts/gen-oauth-keys.mjs`
 */
import { p256 } from '@noble/curves/p256';
import { sha256 } from '@noble/hashes/sha256';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const b64u = (u8) => Buffer.from(u8).toString('base64url');

function makeKey() {
  const d = p256.utils.randomPrivateKey();
  const pub = p256.getPublicKey(d, false); // 0x04 || x(32) || y(32)
  const x = b64u(pub.slice(1, 33));
  const y = b64u(pub.slice(33, 65));
  // RFC 7638 thumbprint を kid にする。
  const kid = b64u(sha256(new TextEncoder().encode(`{"crv":"P-256","kty":"EC","x":"${x}","y":"${y}"}`)));
  const priv = { kty: 'EC', crv: 'P-256', x, y, d: b64u(d), kid };
  const pubJwk = { kty: 'EC', crv: 'P-256', x, y, kid, use: 'sig', alg: 'ES256' };
  return { priv, pubJwk };
}

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', '.oauth-keys');
mkdirSync(outDir, { recursive: true });

const client = makeKey();
const dpop = makeKey();
const clientPath = join(outDir, 'client-private.jwk.json');
const dpopPath = join(outDir, 'dpop-private.jwk.json');
writeFileSync(clientPath, JSON.stringify(client.priv));
writeFileSync(dpopPath, JSON.stringify(dpop.priv));

const acct = 'CLOUDFLARE_ACCOUNT_ID=b9cec3916d500760a7c7b9c31c720d80';
console.log(`\n✅ private 鍵を書き出しました (gitignore 下・commit されません):\n  ${clientPath}\n  ${dpopPath}\n`);
console.log('── client-metadata.json の jwks に載せる公開鍵 (client 署名鍵) ──');
console.log(JSON.stringify(client.pubJwk));
console.log('\n── Secret 設定コマンド (apps/edge から) ──');
console.log(`  ${acct} pnpm exec wrangler secret put OAUTH_CLIENT_PRIVATE_JWK < ${clientPath}`);
console.log(`  ${acct} pnpm exec wrangler secret put OAUTH_DPOP_PRIVATE_JWK < ${dpopPath}`);
console.log('\n設定後は .oauth-keys/ を消して構いません (Secret に入れば復元は再生成でなく再 OAuth 不要)。\n');
