/**
 * 戦闘記録 (`COL.battle`) の集計。
 *
 * 過去にブルスコンの試練 (端末で resolve するターン制バトル) が 1 戦 1 レコードを
 * 書いていた歴史があり、その戦績 (勝敗/連勝/称号) と素材ドロップの集計ソースとして
 * 残っている。試練撤去後は新規レコードの書き込み経路は無いが、過去レコードの読み取り
 * (戦績表示・在庫フォールバック・パワー再スキャン) はそのまま生きている。
 * cardDraw と同じく端末には保存しない (端末を変えても整合する)。
 */

import type { Agent } from '@atproto/api';
import type { BattleOutcome, BattleRecordSummary } from '@aozoraquest/core';
import { COL } from './collections';

export interface BattleLogRecord {
  $type: string;
  /** バトルの seed (決定的エンジンの再現用) */
  seed: number;
  tier: 1 | 2 | 3;
  monsterId: string;
  outcome: Exclude<BattleOutcome, 'ongoing'>;
  /** 決着までのターン数 */
  turns: number;
  /** ドロップした素材 ID (勝利時のみ非空) */
  drops: string[];
  /** このバトルで使ったやくそう数 (素材在庫から差し引く)。旧レコードは欠落 = 0。 */
  herbsUsed?: number;
  /** このバトルで使ったそらのしずく数 (素材在庫から差し引く)。旧レコードは欠落 = 0。 */
  tonicsUsed?: number;
  /** 敗北ペナルティで落とした素材 (在庫から差し引く)。勝利時は空/欠落。
   *  仮レコード時点で確定値を書く (途中離脱 = 棄権 = 敗北でもペナルティが効く
   *  ように。値は seed から決定的なので決着時の確定と一致する)。 */
  materialsLost?: string[];
  at: string;
  via: string;
  /** 挑戦の出所。旧レコードは欠落 = 試練 (本番の過去戦闘は全て試練だった)。 */
  source?: 'trial' | 'world';
}

/** 戦闘レコード数を数える (パワー再スキャン用。cardDraw と同じ最大 500 件)。 */
export async function countBattles(agent: Agent, did: string): Promise<number> {
  let cursor: string | undefined;
  let count = 0;
  for (let page = 0; page < 5; page++) {
    try {
      const res = await agent.com.atproto.repo.listRecords({
        repo: did,
        collection: COL.battle,
        limit: 100,
        ...(cursor !== undefined ? { cursor } : {}),
      });
      count += res.data.records.length;
      const next = res.data.cursor;
      if (!next || next === cursor) break;
      cursor = next;
    } catch (e) {
      // レコード未作成時はエラーが返ることがあるのでそのまま返す
      console.info('battle listRecords:', (e as Error)?.message);
      return count;
    }
  }
  return count;
}

export interface BattleStats extends BattleRecordSummary {
  /** 集めた素材 (素材 ID → 個数) */
  materials: Record<string, number>;
  /** 現在の連勝数 (直近から遡って連続勝利) */
  currentStreak: number;
  total: number;
}

/**
 * 戦績を集計する (称号 / 素材在庫 / 連勝の計算ソース)。
 * listRecords は新しい順 (rkey 降順) に返る前提で currentStreak を出す。これは参照
 * PDS の既定挙動で lexicon 上の保証ではないが、万一順序が変わっても影響は
 * currentStreak の表示のみ (bestStreak/称号は向きに依存しない)。最大 500 件。
 * draw / fled は連勝を切るが敗北には数えない。outcome 欠落 = 中断された仮レコード = 敗北扱い。
 */
export async function loadBattleStats(agent: Agent, did: string): Promise<BattleStats> {
  const stats: BattleStats = {
    wins: 0,
    losses: 0,
    bestStreak: 0,
    tier3Wins: 0,
    materials: {},
    currentStreak: 0,
    total: 0,
  };
  const outcomes: {
    outcome: string;
    tier: number;
    drops: string[];
    herbsUsed: number;
    tonicsUsed: number;
    materialsLost: string[];
  }[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 5; page++) {
    let res;
    try {
      res = await agent.com.atproto.repo.listRecords({
        repo: did,
        collection: COL.battle,
        limit: 100,
        ...(cursor !== undefined ? { cursor } : {}),
      });
    } catch {
      break; // 未作成
    }
    for (const r of res.data.records) {
      const v = r.value as Partial<BattleLogRecord>;
      outcomes.push({
        outcome: typeof v.outcome === 'string' ? v.outcome : 'lose',
        tier: typeof v.tier === 'number' ? v.tier : 1,
        drops: Array.isArray(v.drops) ? v.drops.filter((d): d is string => typeof d === 'string') : [],
        herbsUsed: typeof v.herbsUsed === 'number' && v.herbsUsed > 0 ? v.herbsUsed : 0,
        tonicsUsed: typeof v.tonicsUsed === 'number' && v.tonicsUsed > 0 ? v.tonicsUsed : 0,
        materialsLost: Array.isArray(v.materialsLost)
          ? v.materialsLost.filter((d): d is string => typeof d === 'string')
          : [],
      });
    }
    const next = res.data.cursor;
    if (!next || next === cursor) break;
    cursor = next;
  }

  stats.total = outcomes.length;
  // outcomes は新しい順。currentStreak は先頭からの連続勝利。
  let counting = true;
  // bestStreak は古い順で数える
  let running = 0;
  let herbsConsumed = 0;
  let tonicsConsumed = 0;
  const lostCounts: Record<string, number> = {};
  for (const o of outcomes) {
    herbsConsumed += o.herbsUsed; // 使用は勝敗に関わらず消費 (持ち込んで使った分)
    tonicsConsumed += o.tonicsUsed;
    // 敗北ペナルティで落とした素材 (敗北レコードのみ値を持つ。勝利は空)
    if (o.outcome === 'lose') {
      for (const id of o.materialsLost) lostCounts[id] = (lostCounts[id] ?? 0) + 1;
    }
    if (o.outcome === 'win') {
      stats.wins++;
      if (o.tier === 3) stats.tier3Wins++;
      for (const d of o.drops) stats.materials[d] = (stats.materials[d] ?? 0) + 1;
      if (counting) stats.currentStreak++;
    } else {
      if (o.outcome === 'lose') stats.losses++;
      counting = false;
    }
  }
  // 在庫 = ドロップ獲得数 − 使用数 − 敗北で落とした数 (0 未満にはしない)
  const subtract = (item: string, n: number) => {
    if (n <= 0) return;
    const left = Math.max(0, (stats.materials[item] ?? 0) - n);
    if (left > 0) stats.materials[item] = left;
    else delete stats.materials[item];
  };
  subtract('herb', herbsConsumed);
  subtract('sky-dew', tonicsConsumed);
  for (const [item, n] of Object.entries(lostCounts)) subtract(item, n);
  for (let i = outcomes.length - 1; i >= 0; i--) {
    if (outcomes[i]!.outcome === 'win') {
      running++;
      if (running > stats.bestStreak) stats.bestStreak = running;
    } else {
      running = 0;
    }
  }
  return stats;
}
