import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

/**
 * index.html の初回テーマ (FOUC 対策) インライン <script> は、本番の CSP enforce で
 * `script-src 'sha256-...'` により許可している (public/_headers)。スクリプトを 1 文字でも
 * 変えると hash がズレ、enforce 下でブロックされて FOUC が再発する。このテストは
 * 「index.html のインライン script の sha256」と「_headers に書いた sha256」の一致を
 * CI で保証し、ドリフトを検知する。
 *
 * 前提: Vite は src 無しのインライン <script> を**変換せず素通し**するため、
 *       source (index.html) の hash == dist (配信) の hash。
 */
describe('CSP inline script hash', () => {
  it('index.html のインライン script の sha256 が _headers の CSP と一致する', () => {
    const html = readFileSync('index.html', 'utf8');
    const m = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/.exec(html);
    expect(m, 'index.html にインライン <script> が見つからない').not.toBeNull();
    const body = m![1]!;
    const hash = createHash('sha256').update(body, 'utf8').digest('base64');

    const headers = readFileSync('public/_headers', 'utf8');
    const enforceLine = headers
      .split('\n')
      .find((l) => l.trim().startsWith('Content-Security-Policy:'));
    expect(enforceLine, '_headers に enforce CSP 行が無い').toBeTruthy();
    expect(
      enforceLine!.includes(`'sha256-${hash}'`),
      `CSP の script-src に 'sha256-${hash}' が必要 (index.html の inline script を変えたら _headers を更新)`,
    ).toBe(true);
  });
});
