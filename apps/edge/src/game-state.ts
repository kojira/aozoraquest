/**
 * ゲーム経済の権威 state (docs/21-server-authority §4.1/§6)。
 *
 * サーバーアカウントの repo に **ユーザー DID をキーにした 1 レコード/人**で持つ。ユーザーは
 * この repo に書けない = 偽造不可。二重使用防止は putRecord の swapRecord (CAS) + 本モジュールの
 * **read-modify-write 契約** (レビュー ★★★) で担保する: CID 不一致 (InvalidSwap) 時は必ず最新を
 * 再読込 → 副作用を再評価 → 再 put、をループする (楽観ロック)。
 */
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';
import { getRecord, putRecord, PdsError, type PdsSession } from './pds';

export const GAME_STATE_COLLECTION = 'app.aozoraquest.gameState';
export const GAME_STATE_VERSION = 1;

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

/** 権威 state を取得 (無ければ null)。呼び出し側で無→初期化 or 移行を判断。 */
export async function readState(session: PdsSession, did: string): Promise<{ state: GameState; cid: string } | null> {
  const rec = await getRecord<GameState>(session.pdsUrl, session.did, GAME_STATE_COLLECTION, rkeyForDid(did));
  return rec ? { state: rec.value, cid: rec.cid } : null;
}

export interface RmwOptions {
  /** 現在時刻 (ISO)。テストで固定可。 */
  now: string;
  /** CAS 競合時の最大リトライ回数。 */
  retries?: number;
  /** state が無いときの初期値 (移行値など)。省略時 emptyState。 */
  init?: (did: string, now: string) => GameState;
}

/**
 * read-modify-write (CAS)。`mutate` に**最新の** state を渡し、返した新 state を CAS で書く。
 * InvalidSwap (別リクエストが割り込んで CID が変わった) の時は最新を読み直して mutate をやり直す。
 * → 「古い意思決定のまま上書き」して二重報酬/二重消費が通るのを防ぐ (§4.1 の契約)。
 * mutate は**副作用を持たず** (パワー予約・報酬計算等をこの中で決定的にやる)、毎回新しい state を
 * 返す純関数であること (リトライで複数回呼ばれる)。
 */
export async function readModifyWrite(
  session: PdsSession,
  did: string,
  mutate: (current: GameState) => GameState,
  opts: RmwOptions,
): Promise<GameState> {
  const rkey = rkeyForDid(did);
  const init = opts.init ?? emptyState;
  const retries = opts.retries ?? 5;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const existing = await readState(session, did);
    const current = existing?.state ?? init(did, opts.now);
    const next: GameState = { ...mutate(current), did, version: GAME_STATE_VERSION, updatedAt: opts.now };
    // 既存があればその CID を期待 (CAS)、無ければ null (新規作成のみ) で二重作成も防ぐ。
    const swap = existing ? existing.cid : null;
    try {
      await putRecord(session, GAME_STATE_COLLECTION, rkey, next, swap);
      return next;
    } catch (e) {
      if (e instanceof PdsError && e.xrpcError === 'InvalidSwap' && attempt < retries) continue; // 競合 → 再読込してやり直し
      throw e;
    }
  }
  throw new PdsError('CAS リトライ上限 (競合が解消しない)');
}
