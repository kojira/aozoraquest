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
import { XP_REWARDS } from '@aozoraquest/core';
import { readModifyWrite, type GameState, type GameStateEnv } from './game-state';

/** 申告の種類。種類ごとに 1 回あたりの上限が違う。 */
export type XpClaimKind = 'post' | 'quest';

/** 冪等キーを覚えておく件数。1 人あたりのレコードサイズと、再送の窓の広さのトレードオフ。 */
export const MAX_CLAIM_KEYS = 200;

/**
 * 種類ごとの 1 回あたり上限。**core の報酬定数から導く** — ここに数値を書き写すと、
 * 報酬を変えたときに片方だけ直して「正当な申告が切られる」か「上限が緩む」になる。
 */
export function maxXpFor(kind: XpClaimKind): number {
  switch (kind) {
    case 'post':
      // 1 投稿で入りうる最大 = 分類成功 + その日の初回ボーナス + streak 上限
      return XP_REWARDS.postMatch + XP_REWARDS.dailyBonus + XP_REWARDS.streakBonusCap;
    case 'quest':
      // 承認 1 件ぶん
      return XP_REWARDS.questComplete;
  }
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
  if (!archetype || archetype.length > 64) throw new XpClaimError('archetype が不正', 400);
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
        // 新しいキーを末尾に足し、古いほうから落とす
        xpClaims: [...claims, claimKey].slice(-MAX_CLAIM_KEYS),
      };
    },
    init ? { now, init } : { now },
  );

  return { granted, jobXp: next.jobXp[archetype] ?? 0, duplicate };
}
