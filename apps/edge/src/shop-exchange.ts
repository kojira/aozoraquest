/**
 * **魔石の交換** (D-MATERIAL-001)。町ごとに、その町の魔石だけで買える品が 3〜4 品ある (パワーはいらない)。
 * 品と数は店のデータ (`ShopOverride.exchange`)。払う魔石は町のテーマの魔石 (`townExchange`)。
 * 品揃えも値段もサーバーが町から導く (client の申告を信じない)。同じ rkey は 1 回だけ (shopOps)。
 */
import { EQUIPMENT_BY_ID, ITEMS, canPayStones, payStones, tierForRegion, townExchange, type Archetype } from '@aozoraquest/core';
import { readModifyWrite, type GameState, type GameStateEnv, type OwnedPiece } from './game-state';
import { MAX_ITEM_STACK, ShopError, alreadyDone, assertRkey, assertRoomForPiece, shopAt, withOp, type ShopResult } from './shop';

export async function shopExchange(
  env: GameStateEnv,
  did: string,
  input: { id: string; rkey: string; pos?: { x: number; y: number; mapId?: string }; archetype?: Archetype },
  now: number,
  init?: (did: string, nowIso: string) => Promise<GameState>,
): Promise<ShopResult> {
  assertRkey(input.rkey);
  const opKey = `exchange:${input.rkey}`;
  let duplicate = false;
  const next = await readModifyWrite(
    env,
    did,
    (cur) => {
      if (alreadyDone(cur, opKey)) { duplicate = true; return cur; }
      duplicate = false;
      const { town } = shopAt(cur, input.pos, input.archetype);
      const { stoneId, entries } = townExchange(town, tierForRegion(town.region));
      const entry = entries.find((e) => (e.itemId ?? e.equipmentId) === input.id);
      if (!entry) throw new ShopError('この町では交換していない', 400, 'not_in_stock');
      const cost = { [stoneId]: entry.stones };
      if (!canPayStones(cur.materials, cost)) throw new ShopError('魔石が たりない', 400, 'no_material');
      const materials = payStones(cur.materials, cost);
      if (entry.itemId) {
        if (!ITEMS[entry.itemId]) throw new ShopError('その品は無い', 400, 'unknown_item');
        if ((cur.materials[entry.itemId] ?? 0) >= MAX_ITEM_STACK) throw new ShopError(`これ以上は もてない (${MAX_ITEM_STACK} 個)`, 400, 'stack_full');
        materials[entry.itemId] = (materials[entry.itemId] ?? 0) + 1;
        return { ...cur, materials, shopOps: withOp(cur, opKey) };
      }
      if (!EQUIPMENT_BY_ID[entry.equipmentId!]) throw new ShopError('その品は無い', 400, 'unknown_item');
      assertRoomForPiece(cur);
      const pieces: OwnedPiece[] = [...(cur.pieces ?? []), { rkey: input.rkey, itemId: entry.equipmentId!, level: 0 }];
      return { ...cur, materials, pieces, shopOps: withOp(cur, opKey) };
    },
    init ? { now, init } : { now },
  );
  return { power: next.power, materials: next.materials, duplicate, pieces: next.pieces ?? [] };
}
