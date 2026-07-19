/**
 * ゲーム経済の権威 state (docs/21-server-authority §4.1/§6)。
 *
 * サーバーアカウント (kojira.io) の repo に **ユーザー DID をキーにした 1 レコード/人**で持つ。
 * ユーザーはこの repo に書けない = 偽造不可。二重使用防止は swapRecord (CAS) + 本モジュールの
 * **read-modify-write 契約** (レビュー ★★★) で担保: CID 不一致 (InvalidSwap) 時は最新を再読込 →
 * 副作用を再評価 → 再 put、をループする (楽観ロック)。
 *
 * 読み取りは public getRecord (SERVER_PDS_URL/SERVER_DID、認証不要)。**書き込みは M2.5 の OAuth
 * (DPoP) トークン経由** (server-pds)。ユーザー由来のリクエストは書き込みトークンを持てない。
 */
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';
import { getRecord, PdsError } from './pds';
import { readServerTokens } from './oauth-store';
import { serverPutRecord, ServerWriteError, type ServerPdsEnv } from './server-pds';

export const GAME_STATE_COLLECTION = 'app.aozoraquest.gameState';
export const GAME_STATE_VERSION = 1;

/** 権威 state の読み書きに必要な env (OAuth トークン KV)。読み書きとも repo はトークン由来で一致。 */
export type GameStateEnv = ServerPdsEnv;

export interface GameState {
  /** どのユーザーの state か (監査用。rkey は DID のハッシュなので値に DID を残す)。 */
  did: string;
  /** あおぞらパワー残高。 */
  power: number;
  /** 冒険 XP (プレイヤーレベル)。 */
  playerXp: number;
  /** ジョブ別 XP。 */
  jobXp: Record<string, number>;
  /** 素材インベントリ (item id → 個数)。 */
  materials: Record<string, number>;
  /** 装備中の gear id。 */
  gear: string[];
  /** 位置。 */
  x: number;
  y: number;
  /** 戦闘をまたいで持続する HP/MP (docs/19)。未設定は全快で開始。 */
  carryHp?: number;
  carryMp?: number;
  /** 持ち込み消費アイテム (やくそう / そらのしずく)。 */
  herbs?: number;
  tonics?: number;
  /** 最後に立ち寄った街 (敗北時の帰還先)。街に入るたびに更新。 */
  lastTown?: { x: number; y: number };
  /** 撃破済みタイル ("x,y") の集合 (その 30 分枠内で再エンカウントさせない = 同一敵の無限狩り防止)。 */
  defeated?: string[];
  /** defeated が属する 30 分エンカウント枠。枠が変わったら defeated をリセットする。 */
  defeatedWindow?: number;
  version: number;
  updatedAt: string;
}

/** DID → rkey。DID には rkey 非対応文字 (`:` 等) が含まれるので、衝突と長さを避けるため
 *  sha256 の hex 32 文字にする (先頭に `u`)。決定的。DID 本体は record.value に残す。 */
export function rkeyForDid(did: string): string {
  return 'u' + bytesToHex(sha256(new TextEncoder().encode(did))).slice(0, 32);
}

export function emptyState(did: string, now: string): GameState {
  return { did, power: 0, playerXp: 0, jobXp: {}, materials: {}, gear: [], x: 0, y: 0, version: GAME_STATE_VERSION, updatedAt: now };
}

/**
 * 権威 state を取得 (無ければ null)。読みは public getRecord (認証不要) だが、**書き込みと同じ
 * トークン由来の pdsUrl/did を repo に使う**ことで、config と書込先の食い違い (別 repo を読んで CAS が
 * 常に外れる/誤 repo へ書く) を構造的に防ぐ (レビュー ★★)。
 */
export async function readState(env: GameStateEnv, targetDid: string): Promise<{ state: GameState; cid: string } | null> {
  if (!env.OAUTH_TOKENS) throw new ServerWriteError('KV 未 binding', 'no-kv');
  const tokens = await readServerTokens(env.OAUTH_TOKENS);
  if (!tokens) throw new ServerWriteError('サーバートークン未 bootstrap (管理画面で OAuth 連携が必要)', 'not-bootstrapped');
  const rec = await getRecord<GameState>(tokens.pdsUrl, tokens.did, GAME_STATE_COLLECTION, rkeyForDid(targetDid));
  return rec ? { state: rec.value, cid: rec.cid } : null;
}

export interface RmwOptions {
  /** 現在時刻 (epoch 秒)。updatedAt(ISO) と DPoP/token 期限判定に使う。テストで固定可。 */
  now: number;
  /** CAS 競合時の最大リトライ回数。 */
  retries?: number;
  /** state が無いときの初期値 (移行値など)。省略時 emptyState。**state が null のときだけ**呼ばれるので、
   *  PDS 読取など非同期の移行 (§6-4) も可 (共通経路にはコストを乗せない)。 */
  init?: (did: string, nowIso: string) => GameState | Promise<GameState>;
}

/**
 * read-modify-write (CAS)。`mutate` に**最新の** state を渡し、返した新 state を OAuth (DPoP) で書く。
 * InvalidSwap (別リクエストが割り込んで CID が変わった) の時は最新を読み直して mutate をやり直す。
 * → 「古い意思決定のまま上書き」して二重報酬/二重消費が通るのを防ぐ (§4.1 の契約)。
 * mutate は**副作用を持たず**、毎回新しい state を返す純関数であること (リトライで複数回呼ばれる)。
 * 書き込みトークンが無い/失効は server-pds が ServerWriteError で fail-closed に倒す。
 */
export async function readModifyWrite(
  env: GameStateEnv,
  targetDid: string,
  mutate: (current: GameState) => GameState,
  opts: RmwOptions,
): Promise<GameState> {
  const rkey = rkeyForDid(targetDid);
  const init = opts.init ?? emptyState;
  const retries = opts.retries ?? 5;
  const nowIso = new Date(opts.now * 1000).toISOString();
  for (let attempt = 0; attempt <= retries; attempt++) {
    const existing = await readState(env, targetDid);
    const current = existing?.state ?? (await init(targetDid, nowIso));
    const next: GameState = { ...mutate(current), did: targetDid, version: GAME_STATE_VERSION, updatedAt: nowIso };
    // 既存があればその CID を期待 (CAS)、無ければ null (新規作成のみ) で二重作成も防ぐ。
    const swap = existing ? existing.cid : null;
    try {
      await serverPutRecord(env, opts.now, GAME_STATE_COLLECTION, rkey, next, swap);
      return next;
    } catch (e) {
      if (e instanceof PdsError && e.xrpcError === 'InvalidSwap') {
        if (attempt < retries) continue; // 競合 → 再読込して mutate をやり直し
        throw new PdsError('CAS リトライ上限 (競合が解消しない)', 409, 'CasExhausted');
      }
      throw e; // 非 InvalidSwap (ServerWriteError 含む) は即 throw
    }
  }
  throw new PdsError('unreachable'); // ループは必ず return/throw する
}
