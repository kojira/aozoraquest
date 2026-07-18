/**
 * バトルガード — docs/21-server-authority §5 の「毎ターン・やり直し不可」を担保する永続レコード。
 *
 * encounter 時に **Worker が封印した playerSnapshot + monster + 現 state + turn** をサーバー
 * アカウントの PDS に 1 ユーザー 1 アクティブ戦闘で持つ。ユーザーは書けない = 偽造不可。
 *
 * **やり直し不可の要点**: turn を `swapRecord` (CAS) で進める。同じターンを別コマンドで引き直そう
 * としても、ガードの turn は既に進んでいるので CID 不一致 (InvalidSwap) → 409。物理/CSPRNG 乱数を
 * 毎ターン Worker が引くので先読みも不可 (§3-3)。
 *
 * 封印内容 (`sealed`) と現戦闘 state (`state`) は `packages/core` の型だが、本モジュールは中身を
 * 解釈しない (opaque)。core 型は battle.ts が所有する。
 */
import { getRecord, putRecord, deleteRecord, type PdsSession } from './pds';
import { rkeyForDid } from './game-state';

export const BATTLE_GUARD_COLLECTION = 'app.aozoraquest.battleGuard';

export interface BattleGuard<Sealed = unknown, State = unknown> {
  /** どのユーザーの戦闘か (監査用。rkey は DID ハッシュ)。 */
  did: string;
  /** この戦闘の識別子。encounter で採番、turn で一致確認。 */
  battleId: string;
  /** 次に受理するターン番号 (0 始まり)。turn リクエストの turn と一致必須。 */
  turn: number;
  /** encounter で封印した startBattle 入力 (playerSnapshot + monster + 内部 seed 等)。以後不変。
   *  **クライアントには一切返さない**。とくに内部 seed を返すと、rollDrops/rollDefeatLoss/
   *  summonMonster が seed 由来で決定的なため、クライアントが seed からドロップ/敗北ロス/敵ステを
   *  先読みして「良い seed の戦闘だけ確定・悪ければ離脱」の選別チートが可能になる (レビュー ★★★)。
   *  → 報酬計算も**サーバーが独立に引いたエントロピー**で行い、seed は Worker 内に封じる。 */
  sealed: Sealed;
  /** 現在の戦闘 state (HP/MP 等)。毎ターン更新。**client 向け DTO では seed を除去して返す**。 */
  state: State;
  /** 次ターンに使う**サーバー事前採番のエントロピー** (32bit)。encounter / 各 turn の CAS 確定時に
   *  次ターン分を引いて封じておくことで、(a) リトライ時に同じ seed を再利用でき冪等 (同一ターンで
   *  二重エントロピー消費/取りこぼしを防ぐ)、(b) クライアントは commands 送信前に次ターン乱数を
   *  知り得ない (先読み不可)。決着ターンではドロップ/敗北ロスもこの seed から独立に導出する。 */
  pendingTurnSeed: number;
  /** この戦闘で報酬対象か (encounter 時 power>=1 で確定+予約)。 */
  rewarded: boolean;
  /** 離脱ロス lazy 確定用の期限 (ISO)。 */
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
}

/** アクティブなバトルガードを取得 (無ければ null)。1 ユーザー 1 戦闘なので rkey は DID ハッシュ。 */
export async function readGuard<S = unknown, St = unknown>(
  session: PdsSession,
  did: string,
): Promise<{ guard: BattleGuard<S, St>; cid: string } | null> {
  const rec = await getRecord<BattleGuard<S, St>>(session.pdsUrl, session.did, BATTLE_GUARD_COLLECTION, rkeyForDid(did));
  return rec ? { guard: rec.value, cid: rec.cid } : null;
}

/**
 * ガードを作成 (encounter)。既存があれば InvalidSwap。呼び出し側は「未決着ガードは先に敗北 flush
 * してから」新規発行すること (§5 リロード離脱)。
 */
export async function createGuard(session: PdsSession, guard: BattleGuard): Promise<{ cid: string }> {
  const { cid } = await putRecord(session, BATTLE_GUARD_COLLECTION, rkeyForDid(guard.did), guard, null);
  return { cid };
}

/**
 * ガードを次ターンへ進める (= そのターンの解決結果を確定)。`expectedCid` で CAS。
 *
 * **順序 (docs/21 §4.1/§5)**: 部分2 の resolver は「ガード読取 → **確定 turnSeed** で resolveTurn →
 * `advanceGuard({turn+1, 解決後 state, 次の pendingTurnSeed})`」を 1 CAS 書込で行い、**CAS の成否で
 * クライアント応答をゲートする** (解決結果を返してから遅れて CAS を投げると、同一 turn の並行
 * リクエストが別エントロピーで二重解決し「良い方を採用」される)。競合 (InvalidSwap) は「やり直し/
 * リプレイ」= 409 として上位に投げ、**応答は返さない**。
 */
export async function advanceGuard(session: PdsSession, guard: BattleGuard, expectedCid: string): Promise<{ cid: string }> {
  const { cid } = await putRecord(session, BATTLE_GUARD_COLLECTION, rkeyForDid(guard.did), guard, expectedCid);
  return { cid };
}

/** ガードを削除 (決着時)。CAS 付きで確実に「その CID のときだけ」消す (pds.ts の統一 xrpc 経由)。 */
export async function deleteGuard(session: PdsSession, did: string, expectedCid: string): Promise<void> {
  await deleteRecord(session, BATTLE_GUARD_COLLECTION, rkeyForDid(did), expectedCid);
}
