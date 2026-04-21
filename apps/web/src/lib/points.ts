/**
 * あおぞらパワー集計。
 *
 * via 付き投稿数と精霊チャットのメッセージ数から、召喚状態と残回数を導く。
 * ソースは自分の PDS (AT Protocol の listRecords)、MVP は上限 500 件まで走査。
 */

import type { Agent } from '@atproto/api';
import { VIA } from './atproto';

export const SUMMON_THRESHOLD = 10;
const POST_SCAN_PAGES = 5;
const POST_SCAN_LIMIT = 100;
const SPIRIT_CHAT_SCAN_LIMIT = 100;

export interface PointsState {
  /** 自分の via 付き投稿数 (上限 500) */
  viaPosts: number;
  /** 自分 (role=user) が発した精霊チャットのメッセージ数 */
  userMessages: number;
  /** 召喚済みか (spiritChat レコードが 1 件でもあるか) */
  summoned: boolean;
  /** 話せる残り回数 = max(0, viaPosts - userMessages) */
  balance: number;
  /** 召喚に必要な残り投稿数 = max(0, SUMMON_THRESHOLD - viaPosts) */
  toSummon: number;
}

export async function loadPointsState(agent: Agent, did: string): Promise<PointsState> {
  const [viaPosts, { userMessages, hasAnySpiritChat }] = await Promise.all([
    countViaPosts(agent, did),
    countSpiritChat(agent, did),
  ]);
  const balance = Math.max(0, viaPosts - userMessages);
  const toSummon = Math.max(0, SUMMON_THRESHOLD - viaPosts);
  return {
    viaPosts,
    userMessages,
    summoned: hasAnySpiritChat,
    balance,
    toSummon,
  };
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
        collection: 'app.aozoraquest.spiritChat',
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
