/**
 * バトルガード — docs/21-server-authority §5 の「毎ターン・やり直し不可」を担保する永続レコード。
 *
 * encounter 時に **Worker が封印した playerSnapshot + monster + 現 state + turn** をサーバー
 * サーバーアカウントの PDS に 1 ユーザー 1 アクティブ戦闘で持つ。ユーザーは書けない = 偽造不可。
 * 書き込みは M2.5 の OAuth (DPoP) トークン経由 (server-pds)。読みは token 由来 pds の public getRecord。
 *
 * **やり直し不可の要点**: turn を `swapRecord` (CAS) で進める。同じターンを別コマンドで引き直そう
 * としても、ガードの turn は既に進んでいるので CID 不一致 (InvalidSwap) → 409。Worker が毎ターン新鮮な
 * エントロピーを注入するので先読みも不可 (§3-3)。
 */
import { getRecord } from './pds';
import { readServerTokens } from './oauth-store';
import { serverPutRecord, serverDeleteRecord, ServerWriteError } from './server-pds';
import { rkeyForDid, type GameStateEnv } from './game-state';
import { adminNsidRoot } from './world-authoring';
import { decodeRecordNumbers, encodeRecordNumbers } from './record-numbers';

/** バトルガードの collection (D-ENV-002)。gameState と同じく Worker env で dev と本番を分ける
 *  (dev エッジ = `app.aozoraquest.dev.battleGuard`、本番 = `app.aozoraquest.battleGuard`)。 */
export function battleGuardCollection(env: GameStateEnv): string {
  return `${adminNsidRoot(env)}.battleGuard`;
}

export interface BattleGuard<Sealed = unknown, State = unknown> {
  /** どのユーザーの戦闘か (監査用。rkey は DID ハッシュ)。 */
  did: string;
  /** この戦闘の識別子。encounter で採番、turn で一致確認。 */
  battleId: string;
  /** 次に受理するターン番号 (0 始まり)。turn リクエストの turn と一致必須。 */
  turn: number;
  /** encounter で封印した startBattle 入力等。以後不変。**クライアントには一切返さない** (内部 seed を
   *  返すと rollDrops/rollDefeatLoss/summonMonster が seed 由来で決定的なため先読み選別チートが可能)。 */
  sealed: Sealed;
  /** 現在の戦闘 state (HP/MP 等)。毎ターン更新。**client 向け DTO では seed を除去して返す**。 */
  state: State;
  /** 次ターンに使う**サーバー事前採番のエントロピー** (32bit)。リトライ冪等 + 先読み不可を担保。 */
  pendingTurnSeed: number;
  /** この戦闘で報酬対象か (encounter 時 power>=1 で確定+予約)。 */
  rewarded: boolean;
  /** 離脱ロス lazy 確定用の期限 (ISO)。 */
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * ガードの記録の形。**小数は文字列で持つ** (record-numbers.ts。#998)。戦闘の state には防具の染まり
 * (armorDye 0.5) などの小数があり、数値のまま書くと PDS が拒んで遭遇が黙って消えていた。
 * 読みは、印の無い記録と、一時的に state を JSON 文字列で書いていた記録 (#1000) も受ける。
 */
type GuardRecord<S, St> = Omit<BattleGuard<S, St>, 'state'> & { state: string | St };

function guardToRecord<S, St>(guard: BattleGuard<S, St>): BattleGuard<S, St> {
  return encodeRecordNumbers(guard);
}

/** 記録の値をガードに戻す (テストがストアの中身を読むときにも使う)。 */
export function guardFromRecord<S = unknown, St = unknown>(rec: GuardRecord<S, St>): BattleGuard<S, St> {
  const g = decodeRecordNumbers(rec);
  return { ...g, state: typeof g.state === 'string' ? (JSON.parse(g.state) as St) : g.state };
}

/** 読み書き先 repo をトークン由来にするため、書込先 pds を token から得る。無ければ fail-closed。 */
async function guardRepo(env: GameStateEnv): Promise<{ pdsUrl: string; did: string }> {
  if (!env.OAUTH_TOKENS) throw new ServerWriteError('KV 未 binding', 'no-kv');
  const t = await readServerTokens(env.OAUTH_TOKENS);
  if (!t) throw new ServerWriteError('サーバートークン未 bootstrap', 'not-bootstrapped');
  return { pdsUrl: t.pdsUrl, did: t.did };
}

/** アクティブなバトルガードを取得 (無ければ null)。1 ユーザー 1 戦闘なので rkey は DID ハッシュ。 */
export async function readGuard<S = unknown, St = unknown>(
  env: GameStateEnv,
  targetDid: string,
): Promise<{ guard: BattleGuard<S, St>; cid: string } | null> {
  const repo = await guardRepo(env);
  const rec = await getRecord<GuardRecord<S, St>>(repo.pdsUrl, repo.did, battleGuardCollection(env), rkeyForDid(targetDid));
  return rec ? { guard: guardFromRecord(rec.value), cid: rec.cid } : null;
}

/** ガードを作成 (encounter)。既存があれば InvalidSwap (二重戦闘を作らせない)。 */
export async function createGuard(env: GameStateEnv, now: number, guard: BattleGuard): Promise<{ cid: string }> {
  const { cid } = await serverPutRecord(env, now, battleGuardCollection(env), rkeyForDid(guard.did), guardToRecord(guard), null);
  return { cid };
}

/**
 * ガードを次ターンへ進める (= そのターンの解決結果を確定)。`expectedCid` で CAS。
 * resolver は「読取 → 確定 turnSeed で resolveTurn → advance を 1 CAS 書込」で **CAS の成否で応答を
 * ゲート**する (競合 = やり直し/リプレイ = 409、応答は返さない)。
 */
export async function advanceGuard(env: GameStateEnv, now: number, guard: BattleGuard, expectedCid: string): Promise<{ cid: string }> {
  const { cid } = await serverPutRecord(env, now, battleGuardCollection(env), rkeyForDid(guard.did), guardToRecord(guard), expectedCid);
  return { cid };
}

/** ガードを削除 (決着時)。CAS 付きで確実に「その CID のときだけ」消す。 */
export async function deleteGuard(env: GameStateEnv, now: number, did: string, expectedCid: string): Promise<void> {
  await serverDeleteRecord(env, now, battleGuardCollection(env), rkeyForDid(did), expectedCid);
}
