/**
 * ブルスコンの試練の戦闘記録 (docs/18-brusukon-trial.md)。
 *
 * 1 戦 = 1 レコードを `COL.battle` に書く。パワー消費の監査であり、
 * 戦績 (勝敗/連勝/称号) と素材ドロップの集計ソースでもある。
 * cardDraw と同じく端末には保存しない (端末を変えても整合する)。
 */

import type { Agent } from '@atproto/api';
import type { BattleOutcome, BattleRecordSummary } from '@aozoraquest/core';
import { VIA } from './atproto';
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
  at: string;
  via: string;
}

/** 1 戦の結果を記録する (PDS に 1 レコード作成)。 */
export async function recordBattle(
  agent: Agent,
  input: Omit<BattleLogRecord, '$type' | 'at' | 'via'>,
): Promise<void> {
  const did = agent.assertDid;
  const rkey = `b-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
  await agent.com.atproto.repo.createRecord({
    repo: did,
    collection: COL.battle,
    rkey,
    record: {
      $type: COL.battle,
      ...input,
      at: new Date().toISOString(),
      via: VIA,
    } satisfies BattleLogRecord,
  });
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
 * listRecords は新しい順に返る前提で currentStreak を出す。最大 500 件。
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
  const outcomes: { outcome: string; tier: number; drops: string[] }[] = [];
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
  for (const o of outcomes) {
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
