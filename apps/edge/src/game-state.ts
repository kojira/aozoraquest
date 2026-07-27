/**
 * ゲーム経済の権威 state (docs/21-server-authority §4.1/§6)。
 *
 * サーバーアカウントの repo に **ユーザー DID をキーにした 1 レコード/人**で持つ。
 * ユーザーはこの repo に書けない = 偽造不可。二重使用防止は swapRecord (CAS) + 本モジュールの
 * **read-modify-write 契約** (レビュー ★★★) で担保: CID 不一致 (InvalidSwap) 時は最新を再読込 →
 * 副作用を再評価 → 再 put、をループする (楽観ロック)。
 *
 * 読み取りは public getRecord (SERVER_PDS_URL/SERVER_DID、認証不要)。**書き込みは M2.5 の OAuth
 * (DPoP) トークン経由** (server-pds)。ユーザー由来のリクエストは書き込みトークンを持てない。
 */
import { worldOverlay, type GearSelection } from '@aozoraquest/core';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';
import { getRecord, PdsError } from './pds';
import { readServerTokens } from './oauth-store';
import { serverPutRecord, ServerWriteError, type ServerPdsEnv } from './server-pds';

export const GAME_STATE_COLLECTION = 'app.aozoraquest.gameState';
export const GAME_STATE_VERSION = 1;

/**
 * **XP の区切り世代** (#534)。この値と `GameState.xpEpoch` が違う state は、
 * `normalizeState` が `jobXp` を一度リセットする (全員 Lv1 から再スタート)。
 *
 * **`version` を使ってはいけない。** `readModifyWrite` は書き込みのたびに `version` を
 * 現在値で上書きするので、片道の移行マーカーにならない。実際に困るのは 2 つ:
 *
 * - **dev と本番が同じ権威レコードを共有している** (`GAME_STATE_COLLECTION` は ns 前置きされず、
 *   repo はサーバーアカウント。docs/22)。dev だけ新コードの期間、本番で 1 歩動くたびに
 *   旧 version が刻まれ、次に dev を開くと **jobXp がまた 0 になる**
 * - 本番をロールバックすると同じことが起きる
 *
 * `xpEpoch` は旧コードが知らないフィールドだが、`{...cur}` のスプレッドで保存されるので
 * 一度書けば残る = 移行が二度走らない。
 */
export const XP_EPOCH = 1;

/** 権威 state の読み書きに必要な env (OAuth トークン KV)。読み書きとも repo はトークン由来で一致。 */
export type GameStateEnv = ServerPdsEnv;

/** 所持装備の 1 個体 (#551 段階 2)。rkey は制作時に client が採番した冪等キーと同じ値で、
 *  ユーザー PDS 側の記帳レコードと対応づけるために持つ。 */
export interface OwnedPiece {
  rkey: string;
  itemId: string;
  /** 強化値 (+N)。サーバーが抽選/合成して決めた値だけが入る。 */
  level: number;
}

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
  /** @deprecated 装備中の gear id。**どこからも書き込まれない死んだフィールド** (emptyState が [] に
   *  初期化するだけ)。装備の実効値は gearSel が単一の出所。**戦闘に渡さないこと** — gearSel と併せて
   *  渡すと同じ装備が二重加算される経路だった (#511 で core 側も gear 優先に修正)。
   *  既存 state との互換のためフィールド自体は残す。 */
  gear: string[];
  /** 装備中の個体 (強化値つき GearSelection)。client がミラー送信。戦闘の実効装備はこちら (#377)。 */
  gearSel?: GearSelection;
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
  /** 適用済みの XP 申告の冪等キー (`kind:key`)。直近 `MAX_CLAIM_KEYS` 件のリング。
   *  同じ投稿/クエスト承認で二重に XP が積まれるのを防ぐ (#534。詳細は xp-claim.ts)。 */
  xpClaims?: string[];
  /** XP の区切り世代 (#534)。`XP_EPOCH` と違えば `normalizeState` が jobXp をリセットする。
   *  version と別に持つ理由は `XP_EPOCH` の doc を参照 (片道マーカーが要る)。 */
  xpEpoch?: number;
  /** 日次ボーナスを出した日 (UTC の YYYY-MM-DD)。サーバーの時計で決める (#551)。 */
  claimDay?: string;
  /** 連続投稿日数。**サーバーが数える** — client の申告を使わない。 */
  streakDays?: number;
  /** 申告済みの投稿のうち最も新しい `createdAt` (ms)。**これより古い投稿は申告できない**。
   *  冪等キーのリングが溢れたあとの再送を塞ぐ (#551。詳細は xp-claim.ts)。 */
  lastPostAt?: number;
  /** 処理済みのお店操作の冪等キー (`craft:<rkey>` / `sell:<rkey>` / `forge:<rkey>`)。
   *  直近 `MAX_SHOP_OPS` 件。再送・二重送信で二重に課金/入金しないため (#551。詳細は shop.ts)。 */
  shopOps?: string[];
  /** **所持している装備の個体** (#551 段階 2)。`/api/shop/craft` と `/api/shop/forge` だけが作る。
   *  以前は個体がユーザー PDS の `craft` レコードにあり、しかも `/api/world/gear` が
   *  client の申告を**所持の検証なしで**保存していたため、`{weapon:{id:'wp-shogun-high',plus:99}}`
   *  を送るだけで戦闘に効いた。ここに無い個体は装備できない。 */
  pieces?: OwnedPiece[];
  version: number;
  updatedAt: string;
}

/** DID → rkey。DID には rkey 非対応文字 (`:` 等) が含まれるので、衝突と長さを避けるため
 *  sha256 の hex 32 文字にする (先頭に `u`)。決定的。DID 本体は record.value に残す。 */
export function rkeyForDid(did: string): string {
  return 'u' + bytesToHex(sha256(new TextEncoder().encode(did))).slice(0, 32);
}

export function emptyState(did: string, now: string): GameState {
  // **新規 state は現行 epoch を刻む** (#534)。刻まないと `normalizeState` が
  // 「区切り前の state」と見なして、書くたびに次の読みで jobXp が消える。
  return { did, power: 0, playerXp: 0, jobXp: {}, materials: {}, gear: [], x: 0, y: 0, xpEpoch: XP_EPOCH, version: GAME_STATE_VERSION, updatedAt: now };
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
  return rec ? { state: normalizeState(rec.value), cid: rec.cid } : null;
}

/**
 * 読み出した state を現行スキーマに合わせる (#534)。**読みの側で寄せる**ので、
 * 書き戻されるまで古い値が使われる期間ができない (書き込み経路にだけ移行を置くと、
 * 読むだけの画面が古い値を表示してしまう)。
 *
 * XP の区切り: `xpEpoch` が現行と違えば `jobXp` と `xpClaims` をリセットする。
 * 旧値は「移行時に焼き込んだ投稿 XP + 戦闘 XP」の混合で、新方式に持ち越すと投稿ぶんが
 * 二重に効く。過去の到達レベルは `analysis.jobLevel.xp` に残しており、
 * /me の「ベータ期間の記録」として表示する。
 */
export function normalizeState(state: GameState): GameState {
  if ((state.xpEpoch ?? 0) >= XP_EPOCH) return state;
  // **位置も spawn に戻す。** Lv1 に戻したのに立ち位置が奥地のままだと、想定 Lv8 以上の
  // 敵に Lv1 で遭遇し、負けるたびに素材を失う死にループに入る (帰還先の lastTown も
  // その地方なので抜け出せない)。「Lv1 から再スタート」なら出発点も揃えるのが筋。
  // 持ち物・パワー・装備は触らない (XP 以外を巻き添えにしない)。
  const spawn = worldOverlay().spawn;
  return {
    ...state,
    jobXp: {},
    xpClaims: [],
    xpEpoch: XP_EPOCH,
    x: spawn.x,
    y: spawn.y,
    lastTown: { x: spawn.x, y: spawn.y },
    carryHp: undefined,
    carryMp: undefined,
  };
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
