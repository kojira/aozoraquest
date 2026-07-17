/**
 * あおぞらワールドのプレイヤー状態 (docs/19-overworld.md §5)。
 *
 * PR-W2/遭遇プレビュー時点ではクライアントが読み書きする。
 * PR-W3 以降は Worker (Durable Object) が正となり、このレコードは
 * 「表示キャッシュ + 監査線」に格下げされる (書き込み元が DO 応答になる)。
 *
 * HP/MP は**戦闘をまたいで持続**する (オーナー決定 2026-07-17)。回復手段は
 * 街に立ち寄る (全快) / やくそう。敗北時は最後に立ち寄った街へ戻される。
 */

import type { Agent } from '@atproto/api';
import { worldOverlay, wrap, isWalkable, terrainAt, townAt } from '@aozoraquest/core';
import { getRecord, putRecord } from './atproto';
import { COL } from './collections';

export interface WorldState {
  x: number;
  y: number;
  /** フィールドの現在 HP/MP (絶対値)。null = 未記録 (全快扱い)。
   *  最大値はジョブ/レベルから毎回導出し、ロード時にクランプする。 */
  hp: number | null;
  mp: number | null;
  /** 最後に立ち寄った街 (敗北時の帰還先)。null = まだ街に入っていない (spawn 扱い)。 */
  lastTown: { x: number; y: number } | null;
  /** ロード時に歩行不能地形から街へ退避した (UI が一言出す) */
  relocated?: boolean;
  updatedAt: string;
}

interface WorldRecordShape {
  x?: unknown;
  y?: unknown;
  hp?: unknown;
  mp?: unknown;
  lastTownX?: unknown;
  lastTownY?: unknown;
  updatedAt?: unknown;
}

/**
 * 状態を読み込む。**レコード未作成** (getRecord が null) のときだけ spawn を返す。
 * 一時的な読み込み失敗は throw する — ここで握りつぶして spawn を返すと、
 * 電波の悪い端末で「spawn にテレポート → その位置で上書き保存」というデータ損失が
 * 起きる (レビュー指摘)。呼び出し側はエラー表示 + リトライにすること。
 */
export async function loadWorldState(agent: Agent, did: string): Promise<WorldState> {
  const rec = await getRecord<WorldRecordShape>(agent, did, COL.world, 'self');
  if (rec && typeof rec.x === 'number' && Number.isFinite(rec.x) && typeof rec.y === 'number' && Number.isFinite(rec.y)) {
    // lastTown は「今も街であること」を検証してから使う (ワールド再生成で街が
    // 動く/壊れたレコードで水上へ退避すると、脱出手段なしの詰みになる —
    // 敗北時帰還 world.tsx と同じ検証。レビュー指摘)
    const rawLastTown =
      typeof rec.lastTownX === 'number' && Number.isFinite(rec.lastTownX) &&
      typeof rec.lastTownY === 'number' && Number.isFinite(rec.lastTownY)
        ? { x: wrap(rec.lastTownX), y: wrap(rec.lastTownY) }
        : null;
    const lastTown = rawLastTown && townAt(rawLastTown.x, rawLastTown.y) ? rawLastTown : null;
    // 保存位置が歩行不能地形になっていたら最後の街 (無ければ spawn) に退避する。
    // ワールド再生成で橋タイルが移動した場合 (2026-07-17 の橋修正など)、
    // 旧橋の上に立っていたプレイヤーが水上に取り残されて詰むため
    const px = wrap(rec.x);
    const py = wrap(rec.y);
    if (!isWalkable(terrainAt(px, py))) {
      const back = lastTown ?? worldOverlay().spawn;
      return {
        x: back.x,
        y: back.y,
        hp: null,
        mp: null,
        lastTown,
        relocated: true,
        updatedAt: typeof rec.updatedAt === 'string' ? rec.updatedAt : '',
      };
    }
    return {
      x: px,
      y: py,
      // Number.isFinite: NaN/Infinity の壊れレコードで NaN バーを描かない
      hp: typeof rec.hp === 'number' && Number.isFinite(rec.hp) ? Math.max(1, Math.floor(rec.hp)) : null,
      mp: typeof rec.mp === 'number' && Number.isFinite(rec.mp) ? Math.max(0, Math.floor(rec.mp)) : null,
      lastTown,
      updatedAt: typeof rec.updatedAt === 'string' ? rec.updatedAt : '',
    };
  }
  const spawn = worldOverlay().spawn;
  return { x: spawn.x, y: spawn.y, hp: null, mp: null, lastTown: null, updatedAt: '' };
}

/** 状態を保存する。失敗は warn して swallow (歩行体験を止めない)。 */
export async function saveWorldState(
  agent: Agent,
  state: { x: number; y: number; hp: number | null; mp: number | null; lastTown: { x: number; y: number } | null },
): Promise<void> {
  try {
    await putRecord(agent, COL.world, 'self', {
      x: wrap(state.x),
      y: wrap(state.y),
      ...(state.hp !== null ? { hp: state.hp } : {}),
      ...(state.mp !== null ? { mp: state.mp } : {}),
      ...(state.lastTown ? { lastTownX: state.lastTown.x, lastTownY: state.lastTown.y } : {}),
      updatedAt: new Date().toISOString(),
    });
  } catch (e) {
    console.warn('[world] state save failed', e);
  }
}
