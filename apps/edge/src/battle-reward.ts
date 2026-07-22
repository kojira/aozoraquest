/**
 * 戦闘決着の報酬を権威 state (GameState) に適用する純関数 — docs/21 §5/§7 / M3。
 *
 * **サーバーが報酬を計算する**のが要点。これを readModifyWrite の `mutate` として渡し、CAS で確定する。
 * 純粋 (副作用なし・毎回同じ入力で同じ出力) なのでリトライで複数回呼ばれても安全。
 *
 * **fail-closed / パワーモデル (§7)**:
 *   - `rewarded=false` (encounter 時にパワー残高 0) → 勝敗どちらも**何も付与しない・消費しない**。
 *   - 勝ち (rewarded): +XP (player/job 両方) + ドロップ + パワー 1 消費。
 *   - 負け (rewarded): 素材ロス + パワー 1 消費。
 *   - 引き分け / 逃走: 決着ではない → 何も変えない。
 *
 * **seed 秘匿 (#348)**: ドロップ/敗北ロスの seed は**サーバーが独立に引いた rewardSeed/lossSeed** を使う
 * (戦闘 seed は client に返さない・再利用しない)。呼び出し側が entropyU32 で引いて渡す。
 */
import { battleXpFor, rollDrops, rollDefeatLoss, BATTLE_TUNING } from '@aozoraquest/core';
import type { GameState } from './game-state';

/** BattleOutcome から 'ongoing' を除いた決着。'monster-fled' = 敵が逃げた (無報酬・無消費)。 */
export type BattleDecision = 'win' | 'lose' | 'draw' | 'fled' | 'monster-fled';

export interface BattleOutcomeInput {
  outcome: BattleDecision;
  /** 倒した/対峙したモンスター id (勝利 XP・ドロップ表の決定に使う)。 */
  monsterId: string;
  /** jobXp のキー (プレイヤーの archetype)。 */
  archetype: string;
  /** ドロップ/敗北ロスの luk ボーナス。 */
  luk: number;
  /** 巫女の直感 (#456) 等のドロップ確率加算ボーナス。未指定は 0。 */
  dropBonus?: number;
  /** マルチ戦闘 (#453 群れ) の全敵の monsterId。指定時は勝利報酬を頭数分 (XP 合算・各敵でドロップ試行)。
   *  未指定/1体は従来どおり monsterId 単体で計算 (完全互換)。 */
  enemyIds?: string[];
  /** サーバーが独立に引いたドロップ用エントロピー (32bit)。 */
  rewardSeed: number;
  /** サーバーが独立に引いた敗北ロス用エントロピー (32bit)。 */
  lossSeed: number;
  /** encounter 時に power>=1 で確定した「報酬対象」フラグ。 */
  rewarded: boolean;
}

/** 適用結果 (client 表示・監査用の内訳)。 */
export interface AwardBreakdown {
  xp?: number;
  drops?: string[];
  materialsLost?: string[];
  powerSpent?: number;
}

const POWER_COST = BATTLE_TUNING.powerCost;

function addItems(materials: Record<string, number>, items: string[], delta: 1 | -1): Record<string, number> {
  const next = { ...materials };
  for (const item of items) {
    const v = (next[item] ?? 0) + delta;
    if (v <= 0) delete next[item];
    else next[item] = v;
  }
  return next;
}

/**
 * 決着の報酬を state に適用し、新 state と内訳を返す。純粋。
 * `applyBattleOutcome(current, input).next` を readModifyWrite の mutate 結果に使う。
 */
export function applyBattleOutcome(state: GameState, o: BattleOutcomeInput): { next: GameState; awarded: AwardBreakdown } {
  // パワー無し = 練習相当。勝敗どちらも付与も消費もペナルティも無し (§7)。
  if (!o.rewarded) return { next: state, awarded: {} };

  if (o.outcome === 'win') {
    // 群れ (#453) は倒した全敵ぶん。XP 合算・各敵で別 seed のドロップ試行。1体 (従来) は monsterId 単体 =
    // rewardSeed をそのまま使い完全互換。
    const ids = o.enemyIds && o.enemyIds.length > 0 ? o.enemyIds : [o.monsterId];
    let xp = 0;
    const drops: string[] = [];
    ids.forEach((id, i) => {
      xp += battleXpFor(id);
      const seed = i === 0 ? o.rewardSeed : (o.rewardSeed ^ (0x9e3779b1 * (i + 1))) >>> 0;
      drops.push(...rollDrops(id, o.luk, seed, o.dropBonus ?? 0));
    });
    const next: GameState = {
      ...state,
      playerXp: state.playerXp + xp,
      jobXp: { ...state.jobXp, [o.archetype]: (state.jobXp[o.archetype] ?? 0) + xp },
      materials: addItems(state.materials, drops, 1),
      power: Math.max(0, state.power - POWER_COST),
    };
    return { next, awarded: { xp, drops, powerSpent: POWER_COST } };
  }

  if (o.outcome === 'lose') {
    // 負けでも僅かな XP (§5「負: xpLose+素材ロス」/ 旧クライアントと同値) + 素材ロス + パワー消費。
    const xp = BATTLE_TUNING.xpLose;
    const materialsLost = rollDefeatLoss(state.materials, o.luk, o.lossSeed);
    const next: GameState = {
      ...state,
      playerXp: state.playerXp + xp,
      jobXp: { ...state.jobXp, [o.archetype]: (state.jobXp[o.archetype] ?? 0) + xp },
      materials: addItems(state.materials, materialsLost, -1),
      power: Math.max(0, state.power - POWER_COST),
    };
    return { next, awarded: { xp, materialsLost, powerSpent: POWER_COST } };
  }

  // draw / fled / monster-fled は決着扱いにしない (XP もドロップもパワー消費も無し)。
  // - draw: パワー消費のない draw を報酬対象にすると「ガードで引き分けを狙う無限 XP 稼ぎ」が成立するため付与しない。
  // - fled (プレイヤーが逃走) / monster-fled (敵が逃走): どちらも決着していないので無報酬・無消費。
  //   特にはぐれメタル型に逃げられたときはここに落ちる (高 XP をみすみす逃した = 悔しさが残る設計)。
  return { next: state, awarded: {} };
}
