/**
 * なんでも屋の制作 (docs/20-shop-equipment.md, W6b)。
 *
 * 1 制作 = 1 レコード (`COL.craft`)。**強化値はレコードの rkey + 制作時 luk から
 * 決定的に導出**する — 強化値フィールドを自己申告で書かない (書いても無視する)。
 * これは正規クライアント間の整合性保証であり、改竄耐性ではない (rkey も luk も
 * クライアント選択のため、rkey 総当たりで高強化値を選べる — 最終的な正は W3 の
 * サーバー権威。「実装より盛らない」原則によりここに明記)。
 * 消費の記帳: パワーは power/self の craftPowerSpent 累積、素材はこのコレクションの
 * 集計で在庫から差し引く。
 */

import type { Agent } from '@atproto/api';
import { CRAFT_TUNING, SALE_TUNING, craftLevelRoll, craftSeedFromRkey, salePowerFor } from '@aozoraquest/core';
import { VIA } from './atproto';
import { COL } from './collections';

export interface CraftRecord {
  $type: string;
  /** 作った装備 (EQUIPMENT の id) */
  itemId: string;
  /** 支払った素材 (種類と個数) */
  materialId: string;
  materialCount: number;
  /** 支払ったあおぞらパワー */
  power: number;
  /** 制作時の luk (品質導出の入力。クライアント申告値 — 検証可能化は W3) */
  luk: number;
  at: string;
  via: string;
}

export interface CraftedPiece {
  rkey: string;
  itemId: string;
  /** 強化値 (−1〜+10)。制作分はロール導出、合成分は forge レコードの検証済み値 */
  level: number;
  at: string;
}

/** 合成 (きたえる) レコード。同じアイテム・同じ強化値 2 個体 → +1 の 1 個体。
 *  消費した個体の rkey を記録する — 他人も検証でき、同じ個体の二重消費は
 *  集計時に弾かれる (docs/20 のシンク設計)。 */
/**
 * すてた記録 (#575)。**個体を消したことを PDS 側にも残す**。
 *
 * 権威は `GameState.pieces` だが、`/me` と world のフォールバックは PDS の craft
 * レコード集計 (`loadCraftInventory`) を使う。ここに墓標を残さないと、
 * **捨てた装備が /me では そうび中のまま出て、補正込みの HP/MP が表示される**。
 * 合成が `consumed` で消費を表しているのと同じ形にする (discarded で区別)。
 */
export interface DiscardRecord {
  $type: string;
  /** 消した個体の rkey */
  discarded: string[];
  at: string;
  via: string;
}

export interface ForgeRecord {
  $type: string;
  itemId: string;
  /** 合成後の強化値 (消費個体の強化値 + 1)。集計時に消費個体から再検証する */
  level: number;
  /** 消費した 2 個体の rkey (craft または forge) */
  consumed: [string, string];
  at: string;
  via: string;
}

/**
 * 記帳が書けなかったことを、**再送に必要な材料ごと**呼び出し側へ渡す (#642)。
 *
 * 所持の権威はサーバーなので記帳の失敗で品は消えないが、黙って捨てると履歴が欠け、
 * パワー会計 (points.ts は craft コレクションを再スキャンして消費/獲得を出す) もずれる。
 * rkey と record をそのまま持たせておけば、あとで**同じ rkey**で書き直せる
 * (createRecord は同 rkey で衝突するので二重記帳にならない)。
 */
export class CraftLogError extends Error {
  constructor(readonly rkey: string, readonly record: Record<string, unknown>, override readonly cause: unknown) {
    super('craft log write failed');
    this.name = 'CraftLogError';
  }
}

/** craft コレクションへの記帳はすべてここを通す (失敗を CraftLogError に揃えるため)。 */
export async function writeCraftLog(agent: Agent, rkey: string, record: Record<string, unknown>): Promise<void> {
  try {
    await agent.com.atproto.repo.createRecord({ repo: agent.assertDid, collection: COL.craft, rkey, record });
  } catch (e) {
    // 既に書けている (応答だけ落ちた再送) は成功と同じ。ここで捨てないと永久に再送し続ける。
    if (isAlreadyExists(e)) return;
    throw new CraftLogError(rkey, record, e);
  }
}

function isAlreadyExists(e: unknown): boolean {
  const msg = e instanceof Error ? `${e.message}` : String(e);
  return /already exists|RecordAlreadyExists/i.test(msg);
}

/** 新しい craft rkey を採番する (再試行の冪等化のため、確定は呼び出し側で行う)。 */
export function newCraftRkey(): string {
  return `c-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
}

/** 制作を記帳し、確定した強化値を返す。
 *  rkey を渡すと再試行が冪等になる (createRecord は同 rkey で衝突するため、
 *  「サーバー成立 + 応答喪失 → 再試行」の 2 重制作を構造的に防げる。レビュー指摘)。 */
export async function craftItem(
  agent: Agent,
  input: Pick<CraftRecord, 'itemId' | 'materialId' | 'materialCount' | 'power' | 'luk'> & {
    /** サーバーが抽選した強化値 (#551)。client では引き直さない — rkey と luk から
     *  同じ式で出るので値は一致するが、**正はサーバー**という関係をコードで表すため。 */
    level?: number;
  },
  rkeyIn?: string,
): Promise<CraftedPiece> {
  const rkey = rkeyIn ?? newCraftRkey();
  const { level: serverLevel, ...record } = input;
  await writeCraftLog(agent, rkey, {
    $type: COL.craft,
    ...record,
    at: new Date().toISOString(),
    via: VIA,
  } satisfies CraftRecord);
  return {
    rkey,
    itemId: input.itemId,
    level: serverLevel ?? craftLevelRoll(craftSeedFromRkey(rkey), input.luk),
    at: new Date().toISOString(),
  };
}

export function newForgeRkey(): string {
  return `f-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
}

/** 合成を記帳する。呼び出し側は同アイテム・同強化値の 2 個体を渡すこと
 *  (集計時にも再検証されるので、違反レコードは無効になるだけ)。
 *  rkey を渡すと再試行が冪等 (craft/sale と同じ流儀)。 */
export async function forgeItems(
  agent: Agent,
  input: { itemId: string; resultLevel: number; consumed: [string, string] },
  rkeyIn?: string,
): Promise<CraftedPiece> {
  const rkey = rkeyIn ?? newForgeRkey();
  await writeCraftLog(agent, rkey, {
    $type: COL.craft,
    itemId: input.itemId,
    level: Math.min(CRAFT_TUNING.levelMax, input.resultLevel),
    consumed: input.consumed,
    at: new Date().toISOString(),
    via: VIA,
  } satisfies ForgeRecord);
  return { rkey, itemId: input.itemId, level: Math.min(CRAFT_TUNING.levelMax, input.resultLevel), at: new Date().toISOString() };
}

/** 素材のひきとりレコード (素材を燃やしてパワーへ。docs/20)。itemId を持たない。 */
export interface SaleRecord {
  $type: string;
  materialId: string;
  materialCount: number;
  /** 得たパワー (salePowerFor(materialCount) と一致すべき値。集計側で再計算して検証) */
  powerGained: number;
  at: string;
  via: string;
}

export function newSaleRkey(): string {
  return `s-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
}

/** 素材をひきとってもらう。materialCount は倍数へ構造的に丸める (端数の無補償燃焼を
 *  防ぐ)。rkey を渡すと再試行が冪等 (craft と同じ流儀 — レビュー指摘)。 */
export async function sellMaterials(
  agent: Agent,
  input: { materialId: string; materialCount: number },
  rkeyIn?: string,
): Promise<{ powerGained: number; materialCount: number }> {
  const powerGained = salePowerFor(input.materialCount);
  const materialCount = powerGained * SALE_TUNING.materialsPerPower;
  const rkey = rkeyIn ?? newSaleRkey();
  await writeCraftLog(agent, rkey, {
    $type: COL.craft,
    materialId: input.materialId,
    materialCount,
    powerGained,
    at: new Date().toISOString(),
    via: VIA,
  } satisfies SaleRecord);
  return { powerGained, materialCount };
}

export interface CraftInventory {
  /** 所持している制作品 (新しい順)。品質はレコードから再導出済み */
  pieces: CraftedPiece[];
  /** 制作で消費した素材の合計 (素材在庫の集計で差し引く) */
  materialsSpent: Record<string, number>;
}

/**
 * craft/forge レコードを集計する (最大 500 件)。
 * 合成は消費個体の存在と強化値 (result−1、同 itemId) を検証してから適用する:
 * 二重消費・レベル飛ばし・別アイテム混ぜの偽造レコードは黙って無効になる。
 */
/** すてた記録を書く。権威は既にサーバー側で減っているので、これは表示の整合のため。 */
export async function discardItems(agent: Agent, rkeys: string[], rkeyIn?: string): Promise<void> {
  const rkey = rkeyIn ?? newDiscardRkey();
  await writeCraftLog(agent, rkey, {
    $type: COL.craft,
    discarded: rkeys,
    at: new Date().toISOString(),
    via: VIA,
  } satisfies DiscardRecord);
}

/** 新しい すてる rkey を採番する。 */
export function newDiscardRkey(): string {
  return `d-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
}

export async function loadCraftInventory(agent: Agent, did: string): Promise<CraftInventory> {
  const materialsSpent: Record<string, number> = {};
  const crafted: CraftedPiece[] = [];
  const forges: Array<{ rkey: string; itemId: string; level: number; consumed: [string, string]; at: string }> = [];
  /** すてた個体の rkey (合成の適用より**後**に引く — 合成の材料が捨てられていても
   *  「合成してから捨てた」と解釈できるように)。 */
  const discarded = new Set<string>();
  let cursor: string | undefined;
  for (let page = 0; page < 5; page++) {
    let res;
    try {
      res = await agent.com.atproto.repo.listRecords({
        repo: did,
        collection: COL.craft,
        limit: 100,
        ...(cursor !== undefined ? { cursor } : {}),
      });
    } catch {
      break; // 未作成
    }
    for (const r of res.data.records) {
      const v = r.value as Partial<CraftRecord & ForgeRecord & SaleRecord>;
      const rkey = r.uri.split('/').pop() ?? '';
      if (rkey === '') continue;
      if (Array.isArray((v as Partial<DiscardRecord>).discarded)) {
        // すてたレコード: 個体を消す (itemId を持たないのでこの分岐を先に置く)
        for (const d of (v as DiscardRecord).discarded) if (typeof d === 'string') discarded.add(d);
        continue;
      }
      if (typeof v.itemId !== 'string') {
        // ひきとりレコード: 素材を燃やした分を消費として計上 (個体は生まれない)
        if (
          typeof v.powerGained === 'number' &&
          typeof v.materialId === 'string' &&
          typeof v.materialCount === 'number' &&
          v.materialCount > 0
        ) {
          materialsSpent[v.materialId] = (materialsSpent[v.materialId] ?? 0) + Math.floor(v.materialCount);
        }
        continue;
      }
      if (Array.isArray(v.consumed)) {
        // 合成レコード
        const [a, b] = v.consumed;
        if (typeof a === 'string' && typeof b === 'string' && typeof v.level === 'number') {
          forges.push({ rkey, itemId: v.itemId, level: Math.round(v.level), consumed: [a, b], at: typeof v.at === 'string' ? v.at : '' });
        }
        continue;
      }
      // 制作レコード
      const luk = typeof v.luk === 'number' && Number.isFinite(v.luk) ? v.luk : 0;
      crafted.push({
        rkey,
        itemId: v.itemId,
        level: craftLevelRoll(craftSeedFromRkey(rkey), luk),
        at: typeof v.at === 'string' ? v.at : '',
      });
      if (typeof v.materialId === 'string' && typeof v.materialCount === 'number' && v.materialCount > 0) {
        materialsSpent[v.materialId] = (materialsSpent[v.materialId] ?? 0) + Math.floor(v.materialCount);
      }
    }
    const next = res.data.cursor;
    if (!next || next === cursor) break;
    cursor = next;
  }
  // 合成の適用 (古い順)。消費個体が存在し、同 itemId・強化値 = result−1 のときだけ有効
  const pool = new Map<string, CraftedPiece>(crafted.map((c) => [c.rkey, c]));
  forges.sort((x, y) => (x.at < y.at ? -1 : x.at > y.at ? 1 : x.rkey < y.rkey ? -1 : 1));
  let progressed = true;
  const pending = [...forges];
  while (progressed) {
    progressed = false;
    for (let i = 0; i < pending.length; i++) {
      const f = pending[i]!;
      const a = pool.get(f.consumed[0]);
      const b = pool.get(f.consumed[1]);
      if (!a || !b || f.consumed[0] === f.consumed[1]) continue;
      if (a.itemId !== f.itemId || b.itemId !== f.itemId) continue;
      if (a.level !== f.level - 1 || b.level !== f.level - 1) continue;
      if (f.level > CRAFT_TUNING.levelMax) continue;
      pool.delete(f.consumed[0]);
      pool.delete(f.consumed[1]);
      pool.set(f.rkey, { rkey: f.rkey, itemId: f.itemId, level: f.level, at: f.at });
      pending.splice(i, 1);
      progressed = true;
      break;
    }
  }
  for (const d of discarded) pool.delete(d);
  return { pieces: [...pool.values()], materialsSpent };
}
