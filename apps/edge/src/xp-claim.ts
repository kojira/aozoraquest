/**
 * クライアント申告 XP を権威 state に積む (#534)。
 *
 * 投稿・デイリークエスト・依頼クエストの XP は**クライアントが分類して算出する**ので、
 * サーバーに申告する経路が要る。戦闘 XP (battle-reward) と同じ `GameState.jobXp[archetype]`
 * に積むことで、XP の出所が 1 つになり合算が不要になる。
 *
 * **信頼レベルは今より下がらない。** 現状 XP は `analysis.jobLevel.xp` = ユーザー自身の PDS に
 * あり、client が任意の値を書ける (偽造の天井は元から開いている)。サーバーに集約したうえで
 * 下記 2 つを掛けるので、むしろ改善する:
 *
 * 1. **種類ごとの上限クランプ** — 1 回の申告で入る XP を core の定数から導いた上限で切る。
 *    「1 投稿で 100 万 XP」は通らなくなる。
 * 2. **冪等キー** — 投稿の rkey / クエスト完了レコードの URI をキーにして、同じ出来事で
 *    二重に積むのを防ぐ (リトライ・二重送信・意図的な再送のいずれも)。
 *
 * 冪等キーの保持は直近 `MAX_CLAIM_KEYS` 件のリングなので、それを超えて古いキーを再送すると
 * 再度通る。**上限クランプが効いているので 1 回あたりの被害は 1 件分**に留まり、
 * 現状 (client が自分の PDS に好きな値を書ける) より悪くはならない。真の偽造対策は M4。
 */
import { XP_REWARDS, JOBS_BY_ID, jobXpCurveFor, JOB_LEVEL_TUNING } from '@aozoraquest/core';
import { readModifyWrite, type GameState, type GameStateEnv } from './game-state';
import { getRecord } from './pds';
import { resolveUserPds } from './battle-resolver';

/** 申告の種類。**投稿だけ** — クエスト完了では XP が増えない (オーナー判断 2026-07-27)。
 *  達成の判定が端末内 ONNX なのでサーバーが再現できず、申告額を検証する手段が無かった。 */
export type XpClaimKind = 'post';

/** 冪等キーを覚えておく件数。1 人あたりのレコードサイズと、再送の窓の広さのトレードオフ。 */
export const MAX_CLAIM_KEYS = 200;

/**
 * **1 投稿で回復するあおぞらパワー** (docs/19 §3)。
 *
 * パワーは戦闘 1 回で 1 消費し、**0 になると勝っても報酬が一切入らない**
 * (`rewarded = power >= powerCost`)。client 側のモデルでは「投稿 1 件 = パワー 1」で
 * 回復していたが、**権威 state 側にその経路が無く、初回移行で取り込んだきり減る一方**だった。
 * その結果「何回戦ってもレベルが上がらない」状態になる (オーナー報告 2026-07-26)。
 *
 * 投稿の XP 申告と同じ冪等キーで配るので、同じ投稿で二重に配られることはない。
 */
export const POWER_PER_POST = 1;

/** 管理付与で 1 回に動かせる量の上限。**残高そのものに上限は無い** —
 *  投稿が実在するなら貯まってよい (オーナー判断 2026-07-27)。ここは打ち間違いで
 *  桁を飛ばしたときに戻せなくなるのを防ぐためだけの、入力側のガード。 */
export const MAX_ADMIN_GRANT = 100_000;

/** 投稿として認める最大の古さ (日)。これより古い投稿は申告できない。 */
export const MAX_POST_AGE_DAYS = 3;

/** 未来日の許容ずれ (秒)。端末の時計ずれぶんだけ見る。 */
export const FUTURE_SKEW_SEC = 300;

/** 日付の境界。**UTC ではなく JST で切る** — UTC だと 09:00 JST が日付の変わり目になり、
 *  「朝 8 時に投稿 → 10 時に投稿」で日次ボーナスが同じ日に 2 回付く。移設前の client 実装は
 *  ローカル日で切っていたので、UTC 固定にしたのは移設時の退行だった。 */
export const DAY_OFFSET_SEC = 9 * 3600;

/** epoch 秒 → その日の日付 (JST 基準の YYYY-MM-DD)。 */
export function dayKey(epochSec: number): string {
  return new Date((epochSec + DAY_OFFSET_SEC) * 1000).toISOString().slice(0, 10);
}

/**
 * 種類ごとの 1 回あたり上限。**core の報酬定数から導く** — ここに数値を書き写すと、
 * 報酬を変えたときに片方だけ直して「正当な申告が切られる」か「上限が緩む」になる。
 */
export function maxXpFor(kind: XpClaimKind): number {
  switch (kind) {
    case 'post':
      // 1 投稿で入りうる最大 = 分類成功 + その日の初回ボーナス + streak 上限。
      // クエスト完了ぶんは含めない (XP が出なくなったため)。
      return XP_REWARDS.postMatch + XP_REWARDS.dailyBonus + XP_REWARDS.streakBonusCap;
  }
}

/** **実在する職か**を検証する。長さだけ見ていると任意の 64 文字キーを無制限に生やせて、
 *  権威レコードが PDS のサイズ上限に当たった時点でそのユーザーが**プレイ不能**になる
 *  (書き込みが全部 fail-closed になる)。client が権威レコードのキー空間に触れる経路は
 *  #534 で初めてできたので、ここで閉じる。 */
function assertArchetype(archetype: string): void {
  if (!archetype || !(archetype in JOBS_BY_ID)) throw new XpClaimError('archetype が不正', 400);
}

export class XpClaimError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export interface XpClaimResult {
  /** 実際に積まれた XP (重複申告なら 0)。**額はサーバーが決める**。 */
  granted: number;
  /** 申告後の、その職の累計 XP。 */
  jobXp: number;
  /** 重複申告として弾かれたか (client はこれを見てリトライを止める)。 */
  duplicate: boolean;
  /** 申告後のあおぞらパワー残高 (投稿で回復する)。 */
  power: number;
  /** 連続投稿日数 (サーバーが数える)。 */
  streakDays: number;
}

/**
 * **投稿を申告して XP を積む。** 額は client が送らない — **サーバーが決める**。
 *
 * 投稿が実在し、本人のもので、新しいことを PDS に問い合わせて確かめる。
 * これが通れば「投稿した」は真実なので、**上限を設ける必要がない**
 * (以前は額を検証できないぶんを日次上限で抑えていたが、それは正直に沢山書く人を
 * 罰するだけで、根本ではなかった。オーナー指摘 2026-07-27)。
 *
 * サーバーが出す額:
 * - 投稿 1 件につき `postMatch`
 * - その日の初回なら `dailyBonus` + streak ボーナス (連続日数は権威 state が数える)
 *
 * 端末内 ONNX の分類結果は**使わない**。分類できたかどうかで額を変えていたが、
 * それは client にしか分からない = 検証できない値だった。分類の有無に関わらず
 * 「書いた」ことに対して払う。
 */
export async function claimXp(
  env: GameStateEnv,
  did: string,
  input: { archetype: string; postUri: string },
  now: number,
  init?: (did: string, nowIso: string) => Promise<GameState>,
  fetchImpl?: typeof fetch,
): Promise<XpClaimResult> {
  const { archetype, postUri } = input;
  assertArchetype(archetype);
  const postedAt = await assertOwnPost(did, postUri, now, fetchImpl);

  const claimKey = `post:${postUri}`;
  const today = dayKey(now);
  const yesterday = dayKey(now - 86400);

  let granted = 0;
  let duplicate = false;
  const next = await readModifyWrite(
    env,
    did,
    (cur) => {
      const claims = cur.xpClaims ?? [];
      if (claims.includes(claimKey)) { granted = 0; duplicate = true; return cur; }
      // **単調性で replay を塞ぐ** (#551 レビュー指摘)。冪等キーのリングは直近 200 件しか
      // 覚えていないので、201 件申告してから 1 件目を再送すると通ってしまい、
      // 巡回させれば XP もパワーも無限に湧いた (レビューが実際に再現した)。
      // 投稿は時間順にしか増えないので「前回より新しい投稿だけ」を通せば、
      // リングの大きさに関係なく過去の再送が全部落ちる。
      // 同時刻 (同じミリ秒) の投稿は通す — 落とすと、連投した 2 件目が黙って入らなくなる。
      // 同時刻での再送はリングが捕まえる (直前に申告した投稿は必ずリングに居る)。
      if (postedAt < (cur.lastPostAt ?? 0)) { granted = 0; duplicate = true; return cur; }
      duplicate = false;
      let xp = XP_REWARDS.postMatch;
      let streak = cur.streakDays ?? 0;
      let bonusDay = cur.claimDay;
      if (cur.claimDay !== today) {
        // 連続日数は**サーバーが数える** (client の申告を使わない)。
        streak = cur.claimDay === yesterday ? streak + 1 : 1;
        xp += XP_REWARDS.dailyBonus + Math.min(XP_REWARDS.streakBonusCap, streak * XP_REWARDS.streakBonusPerDay);
        bonusDay = today;
      }
      granted = xp;
      return {
        ...cur,
        lastPostAt: postedAt,
        ...(bonusDay ? { claimDay: bonusDay } : {}),
        streakDays: streak,
        jobXp: { ...cur.jobXp, [archetype]: (cur.jobXp[archetype] ?? 0) + xp },
        // 投稿はあおぞらパワーを回復する (docs/19 §3)。枯れると勝っても報酬が入らなくなる。
        power: cur.power + POWER_PER_POST,
        xpClaims: [...claims, claimKey].slice(-MAX_CLAIM_KEYS),
      };
    },
    init ? { now, init } : { now },
  );

  return { granted, jobXp: next.jobXp[archetype] ?? 0, duplicate, power: next.power, streakDays: next.streakDays ?? 0 };
}

/**
 * その投稿が**実在し・本人のもので・新しい**ことを確かめる (docs/21 §6-2 / M4)。
 *
 * 「アプリ経由か」は AT Proto では原理的に検証できないので、そこは緩める
 * (`via` は client が自由に書ける)。実在と本人性だけで、
 * 「投稿していないのに XP が入る」経路は閉じる。
 */
async function assertOwnPost(did: string, uri: string, now: number, fetchImpl?: typeof fetch): Promise<number> {
  const m = /^at:\/\/([^/]+)\/([^/]+)\/([^/]+)$/.exec(uri);
  if (!m) throw new XpClaimError('投稿の指定が不正', 400);
  const [, owner, collection, rkey] = m as unknown as [string, string, string, string];
  // **他人の投稿では申告できない。** ここが本人性の検証。
  if (owner !== did) throw new XpClaimError('自分の投稿ではない', 400);
  if (collection !== 'app.bsky.feed.post') throw new XpClaimError('投稿ではない', 400);

  const { pds } = await resolveUserPds(did, fetchImpl);
  const rec = await getRecord<{ createdAt?: string }>(pds, did, collection, rkey);
  // **実在の検証。** 消された投稿・でっち上げた URI はここで落ちる。
  if (!rec?.value) throw new XpClaimError('その投稿が見つからない', 400);

  // **createdAt は必須。** client が書ける値なので「読めなければ素通し」にすると、
  // 省略するだけで年齢チェックを丸ごと飛ばせた (レビュー指摘)。fail-closed にする。
  const createdAt = Date.parse(rec.value.createdAt ?? '');
  if (!Number.isFinite(createdAt)) throw new XpClaimError('投稿の日時が読めない', 400);
  if (createdAt > (now + FUTURE_SKEW_SEC) * 1000) throw new XpClaimError('未来の日時の投稿は認められない', 400);
  const ageDays = (now * 1000 - createdAt) / 86_400_000;
  if (ageDays > MAX_POST_AGE_DAYS) throw new XpClaimError('古い投稿では経験値は入らない', 400);
  return createdAt;
}

/**
 * **管理者専用**: 対象ユーザーのジョブ XP を、指定レベルちょうどの値に直接セットする (#534)。
 *
 * XP を権威 state に一本化した結果、`analysis.jobLevel.xp` を書き換える従来の管理ツールでは
 * レベルを動かせなくなった。各ジョブのキット / パッシブ (特に Lv30) を実プレイで確かめる
 * のは開発に必要なので、権威側に同じ操作を用意する。
 *
 * **呼び出し側 (router) が `isEdgeAdmin` で必ずゲートすること。** この関数自体は認可しない。
 *
 * XP は**その職の曲線** (#536) から引く。基準曲線を使うと、pace が 1 未満の職では
 * 指定より高いレベルになり「Lv30 を確かめたいのに Lv34 になる」ことになる。
 */
export async function adminSetJobXp(
  env: GameStateEnv,
  did: string,
  archetype: string,
  targetLevel: number,
  now: number,
  init?: (did: string, nowIso: string) => Promise<GameState>,
): Promise<{ jobXp: number; level: number }> {
  assertArchetype(archetype);
  const maxLv = JOB_LEVEL_TUNING.maxLevel;
  const lv = Math.floor(targetLevel);
  if (!Number.isFinite(lv) || lv < 1 || lv > maxLv) throw new XpClaimError(`レベルは 1〜${maxLv}`, 400);

  const curve = jobXpCurveFor(archetype);
  const xp = curve.find((e) => e[0] === lv)?.[1] ?? 0;
  const next = await readModifyWrite(
    env,
    did,
    (cur) => ({ ...cur, jobXp: { ...cur.jobXp, [archetype]: xp } }),
    init ? { now, init } : { now },
  );
  return { jobXp: next.jobXp[archetype] ?? 0, level: lv };
}

/**
 * **管理者専用**: あおぞらパワーを権威 state に付与する。
 *
 * 管理画面のパワー付与は**ユーザー PDS の power レコードしか書いていなかった** (client 側のモデル)。
 * 報酬の可否は `GameState.power` (権威側) が決めるので、画面には 152 と出ているのに
 * 権威側は 0 = 勝っても XP もドロップも入らない、という見えない失敗が起きていた
 * (オーナー報告 2026-07-26)。テスト用に権威側を直接動かす経路が要る。
 *
 * **呼び出し側 (router) が `isEdgeAdmin` で必ずゲートすること。**
 */
export async function adminGrantPower(
  env: GameStateEnv,
  did: string,
  amount: number,
  now: number,
  init?: (did: string, nowIso: string) => Promise<GameState>,
): Promise<{ power: number }> {
  if (!Number.isFinite(amount)) throw new XpClaimError('amount が不正', 400);
  const delta = Math.trunc(amount);
  if (Math.abs(delta) > MAX_ADMIN_GRANT) throw new XpClaimError(`amount は ±${MAX_ADMIN_GRANT} まで`, 400);
  const next = await readModifyWrite(
    env,
    did,
    (cur) => ({ ...cur, power: Math.max(0, cur.power + delta) }),
    init ? { now, init } : { now },
  );
  return { power: next.power };
}

/**
 * **あおぞらパワーを消費する** (#551 段階 1)。カードの引き直しなど、サーバーが結果を
 * 決めるわけではないが費用だけは権威側で引きたい操作のための入口。
 *
 * 用途 (`reason`) ごとに**サーバーが値段を決める** — client が金額を送ってこない。
 * 冪等キーで再送の二重消費を防ぐ。
 */
export type PowerSpendReason = 'card-draw';

/** 用途ごとの費用。core の定数から導けるものはそこから引く。 */
export function powerCostFor(reason: PowerSpendReason): number {
  switch (reason) {
    case 'card-draw':
      return 1; // カード 1 枚引き直すたびに 1 (docs/19 §3)
  }
}

export async function spendPower(
  env: GameStateEnv,
  did: string,
  input: { reason: PowerSpendReason; key: string },
  now: number,
  init?: (did: string, nowIso: string) => Promise<GameState>,
): Promise<{ power: number; spent: number; duplicate: boolean }> {
  if (input.reason !== 'card-draw') throw new XpClaimError('用途が不正', 400);
  if (!input.key || input.key.length > 256) throw new XpClaimError('冪等キーが不正', 400);
  const cost = powerCostFor(input.reason);
  const opKey = `spend:${input.reason}:${input.key}`;

  let spent = 0;
  let duplicate = false;
  const next = await readModifyWrite(
    env,
    did,
    (cur) => {
      if ((cur.xpClaims ?? []).includes(opKey)) { duplicate = true; spent = 0; return cur; }
      if (cur.power < cost) throw new XpClaimError('あおぞらパワーが たりない', 400);
      duplicate = false;
      spent = cost;
      return { ...cur, power: cur.power - cost, xpClaims: [...(cur.xpClaims ?? []), opKey].slice(-MAX_CLAIM_KEYS) };
    },
    init ? { now, init } : { now },
  );
  return { power: next.power, spent, duplicate };
}
