/**
 * あおぞらワールドのプレイヤー状態 (docs/19-overworld.md §5)。
 *
 * PR-W2 (散歩プレビュー) 時点ではクライアントが位置を読み書きする。
 * PR-W3 以降は Worker (Durable Object) が位置の正となり、このレコードは
 * 「表示キャッシュ + 監査線」に格下げされる (書き込み元が DO 応答になる)。
 */

import type { Agent } from '@atproto/api';
import { worldOverlay, wrap } from '@aozoraquest/core';
import { getRecord, putRecord } from './atproto';
import { COL } from './collections';

export interface WorldState {
  x: number;
  y: number;
  updatedAt: string;
}

/** 位置を読み込む。未作成なら spawn (そらみの街) を返す。 */
export async function loadWorldState(agent: Agent, did: string): Promise<WorldState> {
  const spawn = worldOverlay().spawn;
  try {
    const rec = await getRecord<Partial<WorldState>>(agent, did, COL.world, 'self');
    if (rec && typeof rec.x === 'number' && typeof rec.y === 'number') {
      return { x: wrap(rec.x), y: wrap(rec.y), updatedAt: rec.updatedAt ?? '' };
    }
  } catch {
    /* 未作成 */
  }
  return { x: spawn.x, y: spawn.y, updatedAt: '' };
}

/** 位置を保存する。失敗は warn して swallow (歩行体験を止めない)。 */
export async function saveWorldState(agent: Agent, x: number, y: number): Promise<void> {
  try {
    await putRecord(agent, COL.world, 'self', {
      x: wrap(x),
      y: wrap(y),
      updatedAt: new Date().toISOString(),
    });
  } catch (e) {
    console.warn('[world] state save failed', e);
  }
}
