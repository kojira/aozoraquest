/**
 * ほこら (D-REVIVE-001)。いくつかの町の中にあり、話すと倒れた仲間をみんな起こす。
 * 宿屋では倒れた仲間は起きない (宿の人が いちばん近い ほこら を教える)。
 * 置き場所は内部マップの `shrine` (interior.ts)。おそなえ (パワー) は tier の表 SHRINE_PRICE_BY_TIER を
 * データを書くときに使う (ここが 1 か所の正。データの price はそれを写したもの)。
 */
import { allGates, allInteriors, interiorById, WORLD_MAP_ID } from './interior.js';
import { tierForRegion, regionOf, townAt, wrap, WORLD_SIZE } from './world.js';

/** 起きたときの HP (最大 HP の割合)。 */
export const SHRINE_REVIVE_RATIO = 0.5;

/** tier ごとの おそなえ (パワー)。宿 (3) より ずっと高いが、投稿 1 日ぶん (15 前後) で届く。 */
export const SHRINE_PRICE_BY_TIER: Readonly<Record<number, number>> = { 1: 8, 2: 12, 3: 16, 4: 20, 5: 25, 6: 30 };

/** そのフィールドの座標の tier の おそなえ。 */
export function shrinePriceAt(x: number, y: number): number {
  return SHRINE_PRICE_BY_TIER[Math.min(6, Math.max(1, tierForRegion(regionOf(x, y))))]!;
}

/** ほこらのある内部マップと、フィールドの入口 (その町のマス)。 */
export function shrineTowns(): Array<{ mapId: string; name: string; x: number; y: number }> {
  const out: Array<{ mapId: string; name: string; x: number; y: number }> = [];
  for (const m of allInteriors()) {
    if (!m.shrine) continue;
    const gate = allGates().find((g) => g.from.mapId === WORLD_MAP_ID && g.to.mapId === m.id && townAt(g.from.x, g.from.y));
    if (gate) out.push({ mapId: m.id, name: townAt(gate.from.x, gate.from.y)!.name, x: gate.from.x, y: gate.from.y });
  }
  return out;
}

/** フィールドの (x, y) から いちばん近い ほこら の町の名前 (無ければ undefined)。内部マップにいるときは その町の入口から数える。 */
export function nearestShrineTown(mapId: string | undefined, x: number, y: number): string | undefined {
  const here = mapId && mapId !== WORLD_MAP_ID ? worldEntryOf(mapId) ?? { x, y } : { x, y };
  const d = (a: number, b: number) => Math.min(wrap(a - b), WORLD_SIZE - wrap(a - b));
  let best: { name: string; dist: number } | undefined;
  for (const s of shrineTowns()) {
    const dist = d(s.x, here.x) + d(s.y, here.y);
    if (!best || dist < best.dist) best = { name: s.name, dist };
  }
  return best?.name;
}

/** 内部マップへのフィールドからの入口 (無ければ undefined)。 */
function worldEntryOf(mapId: string): { x: number; y: number } | undefined {
  if (!interiorById(mapId)) return undefined;
  const g = allGates().find((x) => x.from.mapId === WORLD_MAP_ID && x.to.mapId === mapId);
  return g ? { x: g.from.x, y: g.from.y } : undefined;
}
