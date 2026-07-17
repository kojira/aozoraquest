/**
 * ブルスコンの試練の戦闘記録 (docs/18-brusukon-trial.md)。
 *
 * 1 戦 = 1 レコードを `COL.battle` に書く。パワー消費の監査であり、
 * 戦績 (勝敗/連勝/称号) と素材ドロップの集計ソースでもある。
 * cardDraw と同じく端末には保存しない (端末を変えても整合する)。
 */

import type { Agent } from '@atproto/api';
import type { BattleOutcome, BattleRecordSummary } from '@aozoraquest/core';
import { VIA, getRecord, putRecord } from './atproto';
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
  at: string;
  via: string;
}

/**
 * 挑戦開始時に仮レコードを書く (支払いの記帳)。outcome は 'lose' で書いておき、
 * 決着時に finishBattleRecord で確定へ上書きする。**途中離脱 = 棄権 = 敗北**
 * (負けそうになったら閉じる、を無料・無記録にしない)。rkey を返す。
 */
export async function startBattleRecord(
  agent: Agent,
  input: Pick<BattleLogRecord, 'seed' | 'tier' | 'monsterId'>,
): Promise<string> {
  const did = agent.assertDid;
  const rkey = `b-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
  await agent.com.atproto.repo.createRecord({
    repo: did,
    collection: COL.battle,
    rkey,
    record: {
      $type: COL.battle,
      ...input,
      outcome: 'lose',
      turns: 0,
      drops: [],
      herbsUsed: 0,
      at: new Date().toISOString(),
      via: VIA,
    } satisfies BattleLogRecord,
  });
  return rkey;
}

/** 決着時に仮レコードを確定内容で上書きする。 */
export async function finishBattleRecord(
  agent: Agent,
  rkey: string,
  input: Omit<BattleLogRecord, '$type' | 'at' | 'via'>,
): Promise<void> {
  const did = agent.assertDid;
  await agent.com.atproto.repo.putRecord({
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

/**
 * バトルの経験値を analysis レコードに加算する (post-processor と同じ流儀:
 * playerLevel.xp は常に、jobLevel.xp も現ジョブに積む)。失敗は warn して swallow。
 */
export async function awardBattleXp(agent: Agent, did: string, xp: number): Promise<void> {
  try {
    const analysis = await getRecord<{
      archetype: string;
      analyzedAt?: string;
      playerLevel?: { xp: number; lastDailyBonusDate?: string; streakDays: number };
      jobLevel?: { archetype: string; xp: number; joinedAt: string };
      [k: string]: unknown;
    }>(agent, did, COL.analysis, 'self');
    if (!analysis) return;
    const playerLevel = analysis.playerLevel ?? { xp: 0, streakDays: 0 };
    const jobLevel = analysis.jobLevel ?? {
      archetype: analysis.archetype,
      xp: 0,
      joinedAt: analysis.analyzedAt ?? new Date().toISOString(),
    };
    await putRecord(agent, COL.analysis, 'self', {
      ...analysis,
      playerLevel: { ...playerLevel, xp: playerLevel.xp + xp },
      jobLevel: { ...jobLevel, xp: jobLevel.xp + xp },
    });
  } catch (e) {
    console.warn('[battle] xp award failed', e);
  }
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
 * draw は連勝を切るが敗北には数えない。outcome 欠落 = 中断された仮レコード = 敗北扱い。
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
  const outcomes: { outcome: string; tier: number; drops: string[]; herbsUsed: number }[] = [];
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
  for (const o of outcomes) {
    herbsConsumed += o.herbsUsed; // 使用は勝敗に関わらず消費 (持ち込んで使った分)
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
  // やくそうの在庫 = ドロップ獲得数 − 使用数 (0 未満にはしない)
  if (herbsConsumed > 0) {
    const have = stats.materials['herb'] ?? 0;
    const left = Math.max(0, have - herbsConsumed);
    if (left > 0) stats.materials['herb'] = left;
    else delete stats.materials['herb'];
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
