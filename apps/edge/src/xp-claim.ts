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
import { XP_REWARDS, MAX_DAILY_QUEST_XP, JOBS_BY_ID, jobXpCurveFor, JOB_LEVEL_TUNING } from '@aozoraquest/core';
import { readModifyWrite, type GameState, type GameStateEnv } from './game-state';

/** 申告の種類。種類ごとに 1 回あたりの上限が違う。 */
export type XpClaimKind = 'post' | 'quest';

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

/** パワーの上限。無制限にすると桁が壊れたときに戻せないので、緩いサニティ上限を置く。 */
export const MAX_POWER = 100_000;

/**
 * 種類ごとの 1 回あたり上限。**core の報酬定数から導く** — ここに数値を書き写すと、
 * 報酬を変えたときに片方だけ直して「正当な申告が切られる」か「上限が緩む」になる。
 */
export function maxXpFor(kind: XpClaimKind): number {
  switch (kind) {
    case 'post':
      // 1 投稿で入りうる最大 = 分類成功 + その日の初回ボーナス + streak 上限
      // **+ その日のデイリークエスト完了ぶん**。post-processor は 1 回の申告に
      // クエスト完了 XP (1 件 20〜135、1 投稿で複数同時完了あり) を含めるので、
      // ここに入れ忘れると「クエストを達成した日の XP が毎日クランプで消える」。
      return XP_REWARDS.postMatch + XP_REWARDS.dailyBonus + XP_REWARDS.streakBonusCap + MAX_DAILY_QUEST_XP;
    case 'quest':
      // 承認 1 件ぶん
      return XP_REWARDS.questComplete;
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
  /** 実際に積まれた XP (クランプ後。重複申告なら 0)。 */
  granted: number;
  /** 申告後の、その職の累計 XP。 */
  jobXp: number;
  /** 重複申告として弾かれたか (client はこれを見てリトライを止める)。 */
  duplicate: boolean;
  /** 申告後のあおぞらパワー残高 (投稿なら回復している)。 */
  power: number;
}

/**
 * XP を申告して `GameState.jobXp[archetype]` に積む。
 *
 * @param key 冪等キー。投稿なら rkey、クエストなら完了レコードの URI。
 */
export async function claimXp(
  env: GameStateEnv,
  did: string,
  input: { kind: XpClaimKind; archetype: string; xp: number; key: string },
  now: number,
  init?: (did: string, nowIso: string) => Promise<GameState>,
): Promise<XpClaimResult> {
  const { kind, archetype, key } = input;
  assertArchetype(archetype);
  if (!key || key.length > 256) throw new XpClaimError('冪等キーが不正', 400);
  if (!Number.isFinite(input.xp) || input.xp < 0) throw new XpClaimError('xp が不正', 400);

  // **切り捨てであって拒否ではない。** 報酬定数の解釈が client と server でずれたときに
  // 「正当な申告が 400 で落ちて XP が永久に入らない」より、上限まで入るほうが被害が小さい。
  const xp = Math.min(Math.floor(input.xp), maxXpFor(kind));
  const claimKey = `${kind}:${key}`;

  let granted = 0;
  let duplicate = false;
  const next = await readModifyWrite(
    env,
    did,
    (cur) => {
      const claims = cur.xpClaims ?? [];
      if (claims.includes(claimKey)) {
        // 冪等: 何も変えずに現状を返す (CAS も無駄打ちになるが、結果の一貫性を優先)
        granted = 0;
        duplicate = true;
        return cur;
      }
      granted = xp;
      duplicate = false;
      return {
        ...cur,
        jobXp: { ...cur.jobXp, [archetype]: (cur.jobXp[archetype] ?? 0) + xp },
        // **投稿ならあおぞらパワーを回復する** (docs/19 §3)。ここが無いとパワーが枯れて
        // 勝っても報酬が入らなくなり、「何回戦ってもレベルが上がらない」になる。
        ...(kind === 'post' ? { power: Math.min(MAX_POWER, cur.power + POWER_PER_POST) } : {}),
        // 新しいキーを末尾に足し、古いほうから落とす
        xpClaims: [...claims, claimKey].slice(-MAX_CLAIM_KEYS),
      };
    },
    init ? { now, init } : { now },
  );

  return { granted, jobXp: next.jobXp[archetype] ?? 0, duplicate, power: next.power };
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
  if (Math.abs(delta) > MAX_POWER) throw new XpClaimError(`amount は ±${MAX_POWER} まで`, 400);
  const next = await readModifyWrite(
    env,
    did,
    (cur) => ({ ...cur, power: Math.max(0, Math.min(MAX_POWER, cur.power + delta)) }),
    init ? { now, init } : { now },
  );
  return { power: next.power };
}
