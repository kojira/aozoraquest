/**
 * あおぞらパワー集計。
 *
 * 設計: アクションごとに `app.aozoraquest.power/self` の累積カウンタを
 * インクリメントし、読み取りは 1 record の getRecord で済ませる。
 *
 * 旧方式 (毎回 viaPosts を 500 件 scan) は遅く、開く度に数秒待たされる
 * ため、ストア型に切替。初回の 1 度だけ旧スキャンでマイグレーションし、
 * その値を power レコードに書き込む。以降は record の +/- だけ。
 *
 * 増分書込のフック先:
 *   - `compose-modal.tsx` 投稿成功 → +viaPosts
 *   - `spirit.tsx` ユーザーメッセージ書込成功 → +userMessages
 *   - `summoning-ritual.tsx` 召喚完了 → summoned=true
 *   - `card-power.ts` recordCardDraw 成功 → +cardDraws
 *
 * 同時実行で last-write-wins になりうるが、単一ユーザーの操作ペースでは
 * 競合稀。許容ドリフトとする (重大ならマイグレーション再実行で復旧可)。
 */

import type { Agent } from '@atproto/api';
import {
  BLUESKY_API_PAGE_LIMIT,
  POINTS_SCAN_PAGES,
  SUMMON_THRESHOLD as CORE_SUMMON_THRESHOLD,
} from '@aozoraquest/core';
import { VIA, getRecord, putRecord } from './atproto';
import { COL } from './collections';
import { countCardDraws } from './card-power';

export const SUMMON_THRESHOLD = CORE_SUMMON_THRESHOLD;
const POST_SCAN_PAGES = POINTS_SCAN_PAGES;
const POST_SCAN_LIMIT = BLUESKY_API_PAGE_LIMIT;
const SPIRIT_CHAT_SCAN_LIMIT = BLUESKY_API_PAGE_LIMIT;

export interface PointsState {
  /** 自分の via 付き投稿数 */
  viaPosts: number;
  /** 自分 (role=user) が発した精霊チャットのメッセージ数 */
  userMessages: number;
  /** カード引き直しで消費したパワー数 */
  cardDraws: number;
  /** 召喚済みか (spiritChat レコードが 1 件でもあるか) */
  summoned: boolean;
  /** 残あおぞらパワー = max(0, viaPosts - userMessages - cardDraws) */
  balance: number;
  /** 召喚に必要な残り投稿数 = max(0, SUMMON_THRESHOLD - viaPosts) */
  toSummon: number;
}

/** PDS に保存する累積カウンタ。`app.aozoraquest.power/self`。 */
interface PowerRecord {
  viaPosts: number;
  userMessages: number;
  cardDraws: number;
  summoned: boolean;
  updatedAt: string;
}

function deriveState(rec: PowerRecord): PointsState {
  const balance = Math.max(0, rec.viaPosts - rec.userMessages - rec.cardDraws);
  const toSummon = Math.max(0, SUMMON_THRESHOLD - rec.viaPosts);
  return {
    viaPosts: rec.viaPosts,
    userMessages: rec.userMessages,
    cardDraws: rec.cardDraws,
    summoned: rec.summoned,
    balance,
    toSummon,
  };
}

async function readPowerRecord(agent: Agent, did: string): Promise<PowerRecord | null> {
  return await getRecord<PowerRecord>(agent, did, COL.power, 'self').catch(() => null);
}

async function writePowerRecord(agent: Agent, base: Omit<PowerRecord, 'updatedAt'>): Promise<void> {
  const did = agent.assertDid;
  if (!did) return;
  await putRecord(agent, COL.power, 'self', { ...base, updatedAt: new Date().toISOString() });
}

/** 旧方式: PDS の post / spiritChat / cardDraw を実際に走査して計算する。
 *  loadPointsState のマイグレーション用 + power レコード破損時の復旧用に残す。 */
async function scanFullPoints(agent: Agent, did: string): Promise<PointsState> {
  const [viaPosts, { userMessages, hasAnySpiritChat }, cardDraws] = await Promise.all([
    countViaPosts(agent, did),
    countSpiritChat(agent, did),
    countCardDraws(agent, did),
  ]);
  const balance = Math.max(0, viaPosts - userMessages - cardDraws);
  const toSummon = Math.max(0, SUMMON_THRESHOLD - viaPosts);
  return {
    viaPosts,
    userMessages,
    cardDraws,
    summoned: hasAnySpiritChat,
    balance,
    toSummon,
  };
}

/**
 * Power state を取得。fast path: PDS の累積カウンタを 1 件読むだけ。
 * record が無ければ初回マイグレーション (フルスキャンして書き込み) を 1 度行う。
 */
export async function loadPointsState(agent: Agent, did: string): Promise<PointsState> {
  const rec = await readPowerRecord(agent, did);
  if (rec) return deriveState(rec);

  // 初回: 既存データから再構築 → PDS に書き込んでキャッシュ化
  const scanned = await scanFullPoints(agent, did);
  const seed: Omit<PowerRecord, 'updatedAt'> = {
    viaPosts: scanned.viaPosts,
    userMessages: scanned.userMessages,
    cardDraws: scanned.cardDraws,
    summoned: scanned.summoned,
  };
  try {
    await writePowerRecord(agent, seed);
  } catch (e) {
    console.warn('[power] migration write failed (continuing without cache)', e);
  }
  return scanned;
}

/** 累積カウンタを増分書込み。各アクション直後に呼ぶ。
 *  read → 加算 → write の 2 RTT。失敗時は warn して swallow (UI 体験を止めない)。 */
export interface PowerDelta {
  viaPosts?: number;
  userMessages?: number;
  cardDraws?: number;
  /** 召喚状態を強制 true に立てるとき指定。下げる用途は今のところ無し。 */
  summoned?: true;
}
export async function bumpPower(agent: Agent, did: string, delta: PowerDelta): Promise<void> {
  try {
    let cur = await readPowerRecord(agent, did);
    if (!cur) {
      // record 無し: マイグレーションを兼ねて 1 度だけスキャン
      const scanned = await scanFullPoints(agent, did);
      cur = {
        viaPosts: scanned.viaPosts,
        userMessages: scanned.userMessages,
        cardDraws: scanned.cardDraws,
        summoned: scanned.summoned,
        updatedAt: new Date().toISOString(),
      };
    }
    const next: Omit<PowerRecord, 'updatedAt'> = {
      viaPosts: cur.viaPosts + (delta.viaPosts ?? 0),
      userMessages: cur.userMessages + (delta.userMessages ?? 0),
      cardDraws: cur.cardDraws + (delta.cardDraws ?? 0),
      summoned: delta.summoned ?? cur.summoned,
    };
    await writePowerRecord(agent, next);
  } catch (e) {
    console.warn('[power] bump failed (delta lost)', delta, e);
  }
}

export async function countViaPosts(agent: Agent, did: string): Promise<number> {
  let cursor: string | undefined;
  let count = 0;
  for (let page = 0; page < POST_SCAN_PAGES; page++) {
    let res;
    try {
      res = await agent.com.atproto.repo.listRecords({
        repo: did,
        collection: 'app.bsky.feed.post',
        limit: POST_SCAN_LIMIT,
        ...(cursor !== undefined ? { cursor } : {}),
      });
    } catch (e) {
      console.warn('listRecords app.bsky.feed.post failed', e);
      return count;
    }
    for (const r of res.data.records) {
      const val = r.value as { via?: unknown };
      if (val && val.via === VIA) count++;
    }
    const next = res.data.cursor;
    if (!next || next === cursor) break;
    cursor = next;
  }
  return count;
}

/** 召喚済みか (spiritChat レコードが 1 件でもあるか) を最小コストで確認する。
 *  /me 等で「カードを見る」ボタンの表示判定だけが必要な場面で使う。
 *  loadPointsState のフル走査 (~500 posts) を避けて listRecords limit=1 で済む。 */
export async function hasSummoned(agent: Agent, did: string): Promise<boolean> {
  try {
    const res = await agent.com.atproto.repo.listRecords({
      repo: did,
      collection: COL.spiritChat,
      limit: 1,
    });
    return res.data.records.length > 0;
  } catch {
    return false;
  }
}

export async function countSpiritChat(
  agent: Agent,
  did: string,
): Promise<{ userMessages: number; hasAnySpiritChat: boolean }> {
  let cursor: string | undefined;
  let userMessages = 0;
  let total = 0;
  // 精霊チャットは相対的に少ないので 1 ページで足りる想定。念のため 3 ページまで。
  for (let page = 0; page < 3; page++) {
    let res;
    try {
      res = await agent.com.atproto.repo.listRecords({
        repo: did,
        collection: COL.spiritChat,
        limit: SPIRIT_CHAT_SCAN_LIMIT,
        ...(cursor !== undefined ? { cursor } : {}),
      });
    } catch (e) {
      // レコードがまだ無いときも来る
      console.info('spiritChat listRecords returned error (likely no records yet)', (e as Error)?.message);
      return { userMessages, hasAnySpiritChat: total > 0 };
    }
    total += res.data.records.length;
    for (const r of res.data.records) {
      const val = r.value as { role?: unknown };
      if (val && val.role === 'user') userMessages++;
    }
    const next = res.data.cursor;
    if (!next || next === cursor) break;
    cursor = next;
  }
  return { userMessages, hasAnySpiritChat: total > 0 };
}
