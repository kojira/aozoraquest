/**
 * ステートレスなサーバー権威「位置トークン」— あおぞらワールドの歩行を PDS 書き込みなしで高速化する
 * (docs/21 §7 の再設計 2026-07-19)。
 *
 * **背景**: move を 1 歩ごとに PDS 書き込み (readModifyWrite) すると往復が ~1s になり「やってられない」遅さ。
 * かわりに、**現在位置をサーバーが HMAC 署名したトークン**にして client に持たせる。毎歩 client がトークンを
 * 送り、サーバーは**署名検証 (DB 不要・~1ms) → 隣接検証 → エンカウント判定 → 新トークン発行**だけする。
 * 位置はトークンが権威なので歩行では PDS を触らない (街/エンカウント/戦闘の時だけ書く)。
 *
 * **チート対策**: トークンは HMAC 署名済み = client は改竄できない (座標偽造・tier 偽造不可)。DID を署名対象に
 * 含めるので他人のトークンは使えない。TTL で古いトークンの無限リプレイを抑える (失効したら gameState から再発行)。
 * **エンカウントは `encounterSeed` (サーバー秘密 + 30分枠) から決定的** = client は「どこに敵が出るか」を予測・
 * 参照できない (見えないランダムエンカウント)。30 分枠で配置が入れ替わる (定期リポップ)。
 */
import { base64urlnopad } from '@scure/base';
import { hmac } from '@noble/hashes/hmac';
import { sha256 } from '@noble/hashes/sha256';

/** 位置トークンの寿命 (秒)。失効したら move 側が gameState から再発行する (稀な PDS 読み)。 */
export const POSITION_TOKEN_TTL_SEC = 600;

/** エンカウント配置が入れ替わる周期 (秒) = 30 分。 */
export const ENEMY_WINDOW_SEC = 1800;

/** HMAC 署名鍵の派生元 env (既存の Worker Secret を流用 = 追加の設定が要らない)。 */
export interface WorldTokenEnv {
  OAUTH_CLIENT_PRIVATE_JWK?: string;
  OAUTH_DPOP_PRIVATE_JWK?: string;
  WORLD_TOKEN_SECRET?: string; // 任意: 明示指定したい場合
}

/** 署名対象の位置クレーム。 */
export interface PositionClaim {
  /** 本人確認用 (JWT の iss と一致必須)。 */
  did: string;
  /** 今いるマップ (#424)。**省略 = 'world'** — 旧トークン (mapId 無し) をそのまま通す。 */
  mapId?: string;
  x: number;
  y: number;
  /** 手数 (監査/デバッグ用。ステートレスなので厳密な単調性は担保しない)。 */
  counter: number;
  /** 発行時刻 (epoch 秒)。TTL 判定に使う。 */
  iat: number;
}

class WorldTokenError extends Error {}

function secretBytes(env: WorldTokenEnv): Uint8Array {
  const src = env.WORLD_TOKEN_SECRET || env.OAUTH_CLIENT_PRIVATE_JWK || env.OAUTH_DPOP_PRIVATE_JWK || '';
  if (!src) throw new WorldTokenError('位置トークン署名鍵の派生元が無い (OAUTH_CLIENT_PRIVATE_JWK 等が必要)');
  // 署名鍵は「用途 salt + secret」の sha256。secret 実体は外に出ない。
  return sha256(new TextEncoder().encode('aozora-world-token:v1:' + src));
}

function sign(env: WorldTokenEnv, body: string): string {
  const mac = hmac(sha256, secretBytes(env), new TextEncoder().encode(body));
  return base64urlnopad.encode(mac);
}

/** 位置クレームを署名してトークン文字列にする。 */
export function signPosition(env: WorldTokenEnv, claim: PositionClaim): string {
  const body = base64urlnopad.encode(new TextEncoder().encode(JSON.stringify(claim)));
  return body + '.' + sign(env, body);
}

/** トークンを検証してクレームを返す。署名不一致 / DID 不一致 / 失効は throw。 */
export function verifyPosition(env: WorldTokenEnv, token: string, expectedDid: string, now: number): PositionClaim {
  const dot = token.indexOf('.');
  if (dot < 0) throw new WorldTokenError('不正なトークン形式');
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  // 定数時間比較でなくてよい (HMAC 偽造は鍵が要る)。文字列一致で判定。
  if (sign(env, body) !== sig) throw new WorldTokenError('署名不一致');
  let claim: PositionClaim;
  try {
    claim = JSON.parse(new TextDecoder().decode(base64urlnopad.decode(body))) as PositionClaim;
  } catch {
    throw new WorldTokenError('トークン本体が壊れている');
  }
  if (claim.did !== expectedDid) throw new WorldTokenError('トークンの DID 不一致');
  if (!Number.isFinite(claim.iat) || now - claim.iat > POSITION_TOKEN_TTL_SEC) throw new WorldTokenError('トークン失効');
  if (!Number.isFinite(claim.x) || !Number.isFinite(claim.y)) throw new WorldTokenError('座標が壊れている');
  return claim;
}

/** 現在の 30 分エンカウント枠 (epoch 秒 → 枠番号)。枠が変わると敵配置が入れ替わる。 */
export function enemyWindow(now: number): number {
  return Math.floor(now / ENEMY_WINDOW_SEC);
}

/**
 * タイル (x,y) の**決定的エンカウント種**を返す (サーバー秘密 + 30 分枠に依存)。
 * `[0,1)` の占有値と 32bit のモンスター seed を返す。client は秘密を持たないので予測不可。
 * 同じ枠・同じタイルなら常に同じ = 「そのタイルに敵が居るか / どの敵か」が枠内で固定 (置かれた敵)。
 */
export function tileEncounter(env: WorldTokenEnv, x: number, y: number, window: number): { roll: number; monsterSeed: number } {
  const mac = hmac(sha256, secretBytes(env), new TextEncoder().encode(`enc:${x}:${y}:${window}`));
  const occ = ((mac[0]! << 24) | (mac[1]! << 16) | (mac[2]! << 8) | mac[3]!) >>> 0;
  const monsterSeed = ((mac[4]! << 24) | (mac[5]! << 16) | (mac[6]! << 8) | mac[7]!) >>> 0;
  return { roll: occ / 0x1_0000_0000, monsterSeed };
}
