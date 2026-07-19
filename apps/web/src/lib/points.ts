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
  salePowerFor,
} from '@aozoraquest/core';
import { VIA, getRecord, putRecord } from './atproto';
import { COL } from './collections';
import { countCardDraws } from './card-power';
import { countBattles } from './battle-log';

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
  /** ブルスコンの試練で消費したパワー数 (docs/18-brusukon-trial.md) */
  battles: number;
  /** なんでも屋の制作で消費したパワー総量 (docs/20。制作費は品ごとに違うため
   *  件数でなく消費パワーの累積) */
  craftPowerSpent: number;
  /** 素材のひきとりで得たパワー総量 (docs/20。レートは SALE_TUNING) */
  salePowerEarned: number;
  /** 「しらべる」で消費したパワー総量 (docs/19。1 回 = SEARCH_TUNING.powerCost)。
   *  専用レコードは持たず累積カウンタのみ (プレビュー限定。正は W3)。 */
  searchPowerSpent: number;
  /** 召喚済みか (spiritChat レコードが 1 件でもあるか) */
  summoned: boolean;
  /** 残あおぞらパワー = max(0, viaPosts - userMessages - cardDraws - battles - craftPowerSpent - searchPowerSpent + salePowerEarned) */
  balance: number;
  /** 召喚に必要な残り投稿数 = max(0, SUMMON_THRESHOLD - viaPosts) */
  toSummon: number;
}

/** PDS に保存する累積カウンタ。`app.aozoraquest.power/self`。
 *  battles は後付けフィールド (docs/18) — 旧レコードには無いので欠落 = 0 として読む。 */
interface PowerRecord {
  viaPosts: number;
  userMessages: number;
  cardDraws: number;
  battles?: number;
  craftPowerSpent?: number;
  salePowerEarned?: number;
  searchPowerSpent?: number;
  summoned: boolean;
  updatedAt: string;
}

function deriveState(rec: PowerRecord): PointsState {
  const battles = rec.battles ?? 0;
  const craftPowerSpent = rec.craftPowerSpent ?? 0;
  const salePowerEarned = rec.salePowerEarned ?? 0;
  const searchPowerSpent = rec.searchPowerSpent ?? 0;
  const balance = Math.max(0, rec.viaPosts - rec.userMessages - rec.cardDraws - battles - craftPowerSpent - searchPowerSpent + salePowerEarned);
  const toSummon = Math.max(0, SUMMON_THRESHOLD - rec.viaPosts);
  return {
    viaPosts: rec.viaPosts,
    userMessages: rec.userMessages,
    cardDraws: rec.cardDraws,
    battles,
    craftPowerSpent,
    salePowerEarned,
    searchPowerSpent,
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
  const [viaPosts, { userMessages, hasAnySpiritChat }, cardDraws, battles, { craftPowerSpent, salePowerEarned }, existing] = await Promise.all([
    countViaPosts(agent, did),
    countSpiritChat(agent, did),
    countCardDraws(agent, did),
    countBattles(agent, did),
    sumCraftPower(agent, did),
    readPowerRecord(agent, did),
  ]);
  // しらべる消費は専用レコードから再構築できないので、既存 record の値を carry
  // (破損復旧時に消えないように。record 無し = 初回マイグレーションなら 0)。
  const searchPowerSpent = existing?.searchPowerSpent ?? 0;
  const balance = Math.max(0, viaPosts - userMessages - cardDraws - battles - craftPowerSpent - searchPowerSpent + salePowerEarned);
  const toSummon = Math.max(0, SUMMON_THRESHOLD - viaPosts);
  return {
    viaPosts,
    userMessages,
    cardDraws,
    battles,
    craftPowerSpent,
    salePowerEarned,
    searchPowerSpent,
    summoned: hasAnySpiritChat,
    balance,
    toSummon,
  };
}

/** craft コレクションのパワー収支合計 (再スキャン用。最大 500 件)。
 *  制作 = 消費 (power)、ひきとり = 獲得 (powerGained)。 */
async function sumCraftPower(agent: Agent, did: string): Promise<{ craftPowerSpent: number; salePowerEarned: number }> {
  let cursor: string | undefined;
  let craftPowerSpent = 0;
  let salePowerEarned = 0;
  for (let page = 0; page < 5; page++) {
    try {
      const res = await agent.com.atproto.repo.listRecords({
        repo: did,
        collection: COL.craft,
        limit: 100,
        ...(cursor !== undefined ? { cursor } : {}),
      });
      for (const r of res.data.records) {
        const v = r.value as {
          power?: unknown;
          itemId?: unknown;
          powerGained?: unknown;
          materialId?: unknown;
          materialCount?: unknown;
        };
        if (typeof v.itemId === 'string') {
          // 制作レコード (壊れたレコードの扱いを loadCraftInventory と揃える)
          if (typeof v.power === 'number' && Number.isFinite(v.power) && v.power > 0) craftPowerSpent += v.power;
        } else if (
          // ひきとりレコード: powerGained の自己申告は信用せず materialCount から
          // 再計算する (レート改竄・素材なし powerGained だけの偽造レコードを
          // 正規集計から締め出す。loadCraftInventory と同じ 3 点セット要求)
          typeof v.powerGained === 'number' &&
          typeof v.materialId === 'string' &&
          typeof v.materialCount === 'number' &&
          Number.isFinite(v.materialCount) &&
          v.materialCount > 0
        ) {
          salePowerEarned += salePowerFor(Math.floor(v.materialCount));
        }
      }
      const next = res.data.cursor;
      if (!next || next === cursor) break;
      cursor = next;
    } catch {
      return { craftPowerSpent, salePowerEarned }; // 未作成コレクション
    }
  }
  return { craftPowerSpent, salePowerEarned };
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
    battles: scanned.battles,
    craftPowerSpent: scanned.craftPowerSpent,
    salePowerEarned: scanned.salePowerEarned,
    searchPowerSpent: scanned.searchPowerSpent,
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
  battles?: number;
  /** 制作で消費したパワー (品ごとに額が違うので件数でなく額) */
  craftPowerSpent?: number;
  /** 素材のひきとりで得たパワー */
  salePowerEarned?: number;
  /** 「しらべる」で消費したパワー */
  searchPowerSpent?: number;
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
        battles: scanned.battles,
        craftPowerSpent: scanned.craftPowerSpent,
        salePowerEarned: scanned.salePowerEarned,
        searchPowerSpent: scanned.searchPowerSpent,
        summoned: scanned.summoned,
        updatedAt: new Date().toISOString(),
      };
    }
    const next: Omit<PowerRecord, 'updatedAt'> = {
      viaPosts: cur.viaPosts + (delta.viaPosts ?? 0),
      userMessages: cur.userMessages + (delta.userMessages ?? 0),
      cardDraws: cur.cardDraws + (delta.cardDraws ?? 0),
      battles: (cur.battles ?? 0) + (delta.battles ?? 0),
      craftPowerSpent: (cur.craftPowerSpent ?? 0) + (delta.craftPowerSpent ?? 0),
      salePowerEarned: (cur.salePowerEarned ?? 0) + (delta.salePowerEarned ?? 0),
      searchPowerSpent: (cur.searchPowerSpent ?? 0) + (delta.searchPowerSpent ?? 0),
      summoned: delta.summoned ?? cur.summoned,
    };
    await writePowerRecord(agent, next);
  } catch (e) {
    console.warn('[power] bump failed (delta lost)', delta, e);
  }
}

/**
 * オンボードリセット用: world 由来の消費/獲得 (battles / craftPowerSpent / salePowerEarned /
 * searchPowerSpent) を 0 に戻し、歓迎ボーナスだけを salePowerEarned に載せた power レコードを
 * **絶対値で書き込む**。投稿由来 (viaPosts / userMessages / cardDraws) と summoned は保持。
 *
 * 絶対値書き込みなので**冪等** — 途中失敗で再実行しても +welcome が二重に乗らない。
 * bumpPower(+welcome) を使うと (a) 残存する battles 消費が引かれ続けて「投稿残高保持」が崩れ、
 * (b) リトライで二重加算される、という問題があるため専用関数にした。失敗は throw する
 * (呼び出し側の reset フローがエラーを検知してリトライ導線に載せられるように)。
 */
export async function resetWorldPower(agent: Agent, did: string, welcomeBonus: number): Promise<void> {
  const cur = await readPowerRecord(agent, did);
  const base: { viaPosts: number; userMessages: number; cardDraws: number; summoned: boolean } =
    cur ?? (await scanFullPoints(agent, did));
  await writePowerRecord(agent, {
    viaPosts: base.viaPosts,
    userMessages: base.userMessages,
    cardDraws: base.cardDraws,
    battles: 0,
    craftPowerSpent: 0,
    salePowerEarned: welcomeBonus,
    searchPowerSpent: 0,
    summoned: base.summoned,
  });
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
