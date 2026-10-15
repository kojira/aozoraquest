import { describe, it, expect } from 'vitest';
import { signPosition, verifyPosition, enemyWindow, tileEncounter, ENEMY_WINDOW_SEC, POSITION_TOKEN_TTL_SEC } from '../src/world-token';

const ENV = { OAUTH_CLIENT_PRIVATE_JWK: 'test-secret-jwk-material' };
const DID = 'did:plc:alice';
const NOW = 1_700_000_000;

describe('world-token (署名付き位置トークン)', () => {
  it('sign → verify で往復し、座標/手数を復元する', () => {
    const token = signPosition(ENV, { did: DID, x: 12, y: -3, counter: 5, iat: NOW });
    const claim = verifyPosition(ENV, token, DID, NOW + 10);
    expect(claim).toMatchObject({ did: DID, x: 12, y: -3, counter: 5 });
  });

  it('改竄トークンは弾く (署名不一致)', () => {
    const token = signPosition(ENV, { did: DID, x: 0, y: 0, counter: 0, iat: NOW });
    const body = token.slice(0, token.indexOf('.'));
    // 本体をすり替え (x を偽装) → 署名は元のまま = 不一致
    const forgedBody = btoa(JSON.stringify({ did: DID, x: 9999, y: 0, counter: 0, iat: NOW }));
    expect(() => verifyPosition(ENV, `${forgedBody}.${token.slice(token.indexOf('.') + 1)}`, DID, NOW)).toThrow();
    expect(() => verifyPosition(ENV, `${body}.AAAA`, DID, NOW)).toThrow();
  });

  it('他人の DID では使えない', () => {
    const token = signPosition(ENV, { did: DID, x: 0, y: 0, counter: 0, iat: NOW });
    expect(() => verifyPosition(ENV, token, 'did:plc:mallory', NOW)).toThrow();
  });

  it('TTL 超過で失効する', () => {
    const token = signPosition(ENV, { did: DID, x: 0, y: 0, counter: 0, iat: NOW });
    expect(() => verifyPosition(ENV, token, DID, NOW + POSITION_TOKEN_TTL_SEC + 1)).toThrow();
    expect(verifyPosition(ENV, token, DID, NOW + POSITION_TOKEN_TTL_SEC - 1)).toBeTruthy();
  });

  it('別の秘密鍵で署名したトークンは通らない', () => {
    const token = signPosition({ OAUTH_CLIENT_PRIVATE_JWK: 'other-secret' }, { did: DID, x: 0, y: 0, counter: 0, iat: NOW });
    expect(() => verifyPosition(ENV, token, DID, NOW)).toThrow();
  });

  it('enemyWindow は 30 分ごとに変わる', () => {
    const base = enemyWindow(NOW) * ENEMY_WINDOW_SEC; // 枠境界に揃える
    expect(enemyWindow(base)).toBe(enemyWindow(base + ENEMY_WINDOW_SEC - 1)); // 同一枠
    expect(enemyWindow(base + ENEMY_WINDOW_SEC)).toBe(enemyWindow(base) + 1); // 次の枠
  });

  it('tileEncounter は tile+枠+秘密で決定的 (同入力=同出力、別tile/別枠=別値)', () => {
    const w = enemyWindow(NOW);
    const a = tileEncounter(ENV, 5, 7, w);
    expect(tileEncounter(ENV, 5, 7, w)).toEqual(a); // 決定的
    expect(a.roll).toBeGreaterThanOrEqual(0);
    expect(a.roll).toBeLessThan(1);
    expect(tileEncounter(ENV, 5, 8, w).monsterSeed).not.toBe(a.monsterSeed); // 別 tile
    expect(tileEncounter(ENV, 5, 7, w + 1).monsterSeed).not.toBe(a.monsterSeed); // 別枠 (リポップ)
    // 秘密を知らない client は roll を予測できない (別秘密なら別値)
    expect(tileEncounter({ OAUTH_CLIENT_PRIVATE_JWK: 'x' }, 5, 7, w).roll).not.toBe(a.roll);
  });
});
