/**
 * カード引き直しで消費する「あおぞらパワー」を PDS ベースで管理する。
 *
 * あおぞらパワーは points.ts で `viaPosts - userMessages` として derive される。
 * 引き直しを 1 回やるたびに新しいレコードを `app.aozoraquest.cardDraw` に書き、
 * 消費分として balance から引く。
 *
 * ブラウザ側には一切保存しないので、端末を変えても整合する。
 */

import type { Agent } from '@atproto/api';
import { VIA } from './atproto';

const COLLECTION = 'app.aozoraquest.cardDraw';

/** 過去に書かれた cardDraw レコード数を数える (最大 500 件まで)。 */
export async function countCardDraws(agent: Agent, did: string): Promise<number> {
  let cursor: string | undefined;
  let count = 0;
  for (let page = 0; page < 5; page++) {
    try {
      const res = await agent.com.atproto.repo.listRecords({
        repo: did,
        collection: COLLECTION,
        limit: 100,
        ...(cursor !== undefined ? { cursor } : {}),
      });
      count += res.data.records.length;
      const next = res.data.cursor;
      if (!next || next === cursor) break;
      cursor = next;
    } catch (e) {
      // レコード未作成時はエラーが返ることがあるのでそのまま 0 返し
      console.info('cardDraw listRecords:', (e as Error)?.message);
      return count;
    }
  }
  return count;
}

/** 1 回の引き直しを記録する (PDS に 1 レコード作成)。 */
export async function recordCardDraw(agent: Agent, reason: 'flavor-reroll' | string): Promise<void> {
  const did = agent.assertDid;
  const rkey = `draw-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
  await agent.com.atproto.repo.createRecord({
    repo: did,
    collection: COLLECTION,
    rkey,
    record: {
      $type: COLLECTION,
      reason,
      at: new Date().toISOString(),
      via: VIA,
    },
  });
}
