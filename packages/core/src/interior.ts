/**
 * **内部マップ** (#424)。街の中・城・ダンジョンを、フィールドとは別のマップ空間に持つ。
 *
 * ## なぜマップ空間を分けるか (案 A)
 *
 * 1024×1024 のフィールドの空き地に内部を描き込む案 (DQ1 方式) もあったが、
 * オーナー判断で**マップ空間の分離**を採った。内部の広さがフィールドの地形配置に
 * 縛られず、「城の中だけ危険度を上げる」「同じ間取りを複数の街で使う」も後から効く。
 *
 * ## 位置は `(mapId, x, y)` の 3 つ組
 *
 * `mapId` は `'world'` (フィールド) か内部マップの id。**省略 = 'world'** として
 * 既存の位置 (GameState.x/y・位置トークン) を無移行で通す。
 *
 * ## ゲート (出入口)
 *
 * 「入口タイルを踏んだら別マップの出口へ移る」という対応表を別に持つ。地形に
 * 埋め込まないのは、**同じ絵のパーツを複数の入口に使う**ため (城のパーツを 2 つ
 * 置いたら 2 つとも同じ城に入る、では困る)。
 *
 * 移動判定と遷移は **edge が権威** (docs/21)。web も同じ表を読む — 片方だけが
 * ゲートを知っていると「画面では入れるのにサーバーが弾く」になる。
 */
import type { Terrain } from './world.js';
import { isWalkable } from './world.js';
import { BASE_PALETTE, partWalkable as worldPartWalkable, type WorldPart } from './world-map.js';
import { assertItemRequirements, isFlagName, itemsSatisfied, type ItemRequirement } from './scenario.js';
import { ITEMS } from './battle.js';

export class InteriorError extends Error {}

/** フィールドを表す mapId。内部マップはこれ以外の id を持つ。 */
export const WORLD_MAP_ID = 'world';

export interface InteriorMap {
  /** 一意な id (ゲートの参照先)。 */
  id: string;
  /** 表示名 (「ふたばの村」「魔王の城 1F」など)。 */
  name: string;
  /** 一辺のタイル数 (正方形)。フィールドと違い小さい。 */
  size: number;
  /** タイル (1 バイト = パーツ index)。長さは size×size。 */
  tiles: Uint8Array;
  /** パーツ表。省略時はフィールドのパーツ表を使う (絵と通行判定を共用する)。 */
  parts?: WorldPart[];
  /** 遭遇の危険度 tier。**省略 = 敵が出ない** (街の中・城の広間)。 */
  encounterTier?: number;
}

/** 出入口 1 つ。踏んだ瞬間に `to` へ移る (一方通行。往復は 2 本書く)。 */
export interface Gate {
  from: { mapId: string; x: number; y: number };
  to: { mapId: string; x: number; y: number };
  /**
   * **通れるようになる進行フラグ** (#426)。すべて立つまで踏んでも移動しない。
   * 「城の門は王の許しが出るまで開かない」「魔王の城は終盤まで入れない」を書く手段。
   * 判定は edge が権威 (client がフラグを自己申告しても通らない)。
   */
  requireFlags?: string[];
  /** **通るのに要る持ち物** (#426)。「かぎを持っていれば開く」をフラグ無しで書ける。 */
  requireItems?: ItemRequirement[];
  /**
   * **通れないときに出すことば** (#426)。省略時は既定の一文。
   * 「門番が とおせんぼしている」「まだ 王の ゆるしが ない」のように、
   * その場所ごとの理由を書けるようにする (どこも同じ一文だと理由が伝わらない)。
   */
  lockedNotice?: string;
}

/** 施錠中のゲートで出す既定のことば (lockedNotice 省略時)。 */
export const DEFAULT_GATE_LOCKED_NOTICE = 'まだ ここは とおれない…';
/** ことばの最大長 (DQ の窓に収まる範囲。NPC のセリフと揃える)。 */
export const MAX_GATE_NOTICE = 120;

export interface InteriorsRecord {
  interiors: Array<Omit<InteriorMap, 'tiles'> & { gz: string }>;
  gates: Gate[];
  updatedAt: string;
}

/** 内部マップの一辺の上限 (レコードサイズと編集のしやすさの現実的な範囲)。 */
export const MAX_INTERIOR_SIZE = 128;
export const MAX_INTERIORS = 100;
export const MAX_GATES = 500;

let interiors = new Map<string, InteriorMap>();
let gates = new Map<string, Gate>();

const gateKey = (mapId: string, x: number, y: number) => `${mapId}:${x},${y}`;

/**
 * 内部マップとゲートを差し替える。`null` で全解除。
 * **壊れた 1 件で全体を落とす** (部分適用しない。他エディタと同じ流儀)。
 */
export function setInteriors(list: readonly InteriorMap[] | null, gateList: readonly Gate[] | null): void {
  const nextMaps = new Map<string, InteriorMap>();
  for (const m of list ?? []) {
    const where = m?.id ?? '(id なし)';
    if (!m || typeof m.id !== 'string' || m.id.trim() === '') throw new InteriorError('内部マップの id が空');
    if (m.id === WORLD_MAP_ID) throw new InteriorError(`id に ${WORLD_MAP_ID} は使えない (フィールドの予約語)`);
    if (nextMaps.has(m.id)) throw new InteriorError(`内部マップの id が重複 (${m.id})`);
    if (typeof m.name !== 'string' || m.name.trim() === '') throw new InteriorError(`${where}: 名前が空`);
    if (!Number.isInteger(m.size) || m.size < 4 || m.size > MAX_INTERIOR_SIZE) {
      throw new InteriorError(`${where}: おおきさは 4〜${MAX_INTERIOR_SIZE}`);
    }
    if (!(m.tiles instanceof Uint8Array) || m.tiles.length !== m.size * m.size) {
      throw new InteriorError(`${where}: タイル数が合わない (${m.tiles?.length} ≠ ${m.size}×${m.size})`);
    }
    if (m.encounterTier !== undefined && (!Number.isInteger(m.encounterTier) || m.encounterTier < 1 || m.encounterTier > 8)) {
      throw new InteriorError(`${where}: 危険度は 1〜8 (省略で敵が出ない)`);
    }
    nextMaps.set(m.id, { ...m, tiles: new Uint8Array(m.tiles), ...(m.parts ? { parts: m.parts.map((p) => ({ ...p })) } : {}) });
  }
  if (nextMaps.size > MAX_INTERIORS) throw new InteriorError(`内部マップが多すぎる (${nextMaps.size} > ${MAX_INTERIORS})`);

  const nextGates = new Map<string, Gate>();
  for (const g of gateList ?? []) {
    const where = g ? `(${g.from?.mapId} ${g.from?.x},${g.from?.y})` : '(空)';
    if (!g?.from || !g.to) throw new InteriorError(`ゲートの形が不正 ${where}`);
    for (const p of [g.from, g.to]) {
      if (typeof p.mapId !== 'string' || !Number.isInteger(p.x) || !Number.isInteger(p.y)) {
        throw new InteriorError(`ゲートの座標が不正 ${where}`);
      }
      // **行き先の実在を確かめる。** 存在しない内部マップへのゲートを踏むと、
      // その場から出られなくなる (どこにも居ない状態になる)。
      if (p.mapId !== WORLD_MAP_ID && !nextMaps.has(p.mapId)) {
        throw new InteriorError(`${where}: 内部マップが存在しない (${p.mapId})`);
      }
      if (p.mapId !== WORLD_MAP_ID) {
        const m = nextMaps.get(p.mapId)!;
        if (p.x < 0 || p.y < 0 || p.x >= m.size || p.y >= m.size) {
          throw new InteriorError(`${where}: ${p.mapId} の外を指している (${p.x}, ${p.y})`);
        }
      }
    }
    // **入口タイルが歩けないとそのゲートは永久に踏めない。** ゲートは通行判定の後に
    // 見る設計なので、壁の上のゲートは「入ったら出られない一方通行の罠」になる
    // (エディタの既定値が実際に壁を指していた。レビュー ★★★)。
    // フィールド側は地図の読み込み状況に依存するのでここでは見ない (内部だけ検証)。
    if (g.from.mapId !== WORLD_MAP_ID) {
      const fm = nextMaps.get(g.from.mapId);
      if (!fm) throw new InteriorError(`${where}: 入口の内部マップが存在しない (${g.from.mapId})`);
      if (!interiorWalkableAt(fm, g.from.x, g.from.y)) {
        throw new InteriorError(`${where}: 入口が歩けないマス (壁の上のゲートは踏めない)`);
      }
    }
    if (g.lockedNotice !== undefined && (typeof g.lockedNotice !== 'string' || g.lockedNotice.trim() === '' || g.lockedNotice.length > MAX_GATE_NOTICE)) {
      throw new InteriorError(`${where}: 通れないときのことばが不正 (${MAX_GATE_NOTICE} 文字まで)`);
    }
    assertItemRequirements(g.requireItems, where, (id) => !!ITEMS[id]);
    for (const f of g.requireFlags ?? []) {
      // シナリオ側と同じ書式で弾く (#426/#545)。typo したフラグは永久に立たないので、
      // そのゲートは二度と開かない = そのエリアへ入れないまま気づけない。
      if (!isFlagName(f)) throw new InteriorError(`${where}: 解禁フラグ名が不正 (${f})`);
    }
    const k = gateKey(g.from.mapId, g.from.x, g.from.y);
    // 同じマスに 2 つのゲートがあると、踏んだときどちらへ行くのか決められない。
    if (nextGates.has(k)) throw new InteriorError(`同じマスにゲートが重複 ${where}`);
    nextGates.set(k, { from: { ...g.from }, to: { ...g.to }, ...(g.requireFlags ? { requireFlags: [...g.requireFlags] } : {}), ...(g.requireItems ? { requireItems: g.requireItems.map((r) => ({ ...r })) } : {}), ...(g.lockedNotice ? { lockedNotice: g.lockedNotice } : {}) });
  }
  if (nextGates.size > MAX_GATES) throw new InteriorError(`ゲートが多すぎる (${nextGates.size} > ${MAX_GATES})`);

  interiors = nextMaps;
  gates = nextGates;
}

/** 内部マップ (無ければ undefined = フィールド扱い)。 */
export function interiorById(id: string): InteriorMap | undefined {
  return interiors.get(id);
}

/** 全内部マップ (エディタ用)。 */
export function allInteriors(): readonly InteriorMap[] {
  return [...interiors.values()];
}

/** 全ゲート (エディタ用)。 */
export function allGates(): readonly Gate[] {
  return [...gates.values()];
}

/**
 * そのゲートが今のフラグで通れるか (#426)。フラグ指定が無ければ常に通れる。
 * **edge と web が同じ判定を共有する** — 片方だけだと「画面では入れるのに弾かれる」。
 */
export function gateOpen(gate: Gate, flags: readonly string[], materials: Readonly<Record<string, number>> = {}): boolean {
  return (gate.requireFlags ?? []).every((f) => flags.includes(f)) && itemsSatisfied(gate.requireItems, materials);
}

/** 何らかの条件で施錠されているゲートか (条件が無ければ state を読む必要がない)。 */
export function gateHasLock(gate: Gate): boolean {
  return (gate.requireFlags?.length ?? 0) > 0 || (gate.requireItems?.length ?? 0) > 0;
}

/** 施錠中に出すことば (エディタで書いたもの → 既定)。edge と web が同じ文言を使う。 */
export function gateLockedNotice(gate: Gate): string {
  return gate.lockedNotice ?? DEFAULT_GATE_LOCKED_NOTICE;
}

/** そのマスのゲート (無ければ undefined)。移動の権威判定と web の描画が共有する。 */
export function gateAt(mapId: string, x: number, y: number): Gate | undefined {
  return gates.get(gateKey(mapId, x, y));
}

/** そのマップが内部か (mapId が未知なら false = フィールド扱いに倒す)。 */
export function isInterior(mapId: string | undefined): boolean {
  return !!mapId && mapId !== WORLD_MAP_ID && interiors.has(mapId);
}

/** 内部マップのパーツ index (範囲外は undefined)。 */
export function interiorPartAt(map: InteriorMap, x: number, y: number): number | undefined {
  if (x < 0 || y < 0 || x >= map.size || y >= map.size) return undefined;
  return map.tiles[y * map.size + x];
}

/** 内部マップの地形 (パーツ表 → BASE_PALETTE の順に引く)。 */
export function interiorTerrainAt(map: InteriorMap, x: number, y: number): Terrain {
  const idx = interiorPartAt(map, x, y);
  if (idx === undefined) return 'mountain'; // 範囲外は壁扱い (歩けない地形)
  const part = map.parts?.[idx];
  return (part?.terrain ?? BASE_PALETTE[idx] ?? 'plains') as Terrain;
}

/**
 * 内部マップの通行判定。**範囲外は歩けない** — 内部マップは端で折り返さない
 * (フィールドの wrap と違い、外に出るのはゲートからだけ)。
 */
export function interiorWalkableAt(map: InteriorMap, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= map.size || y >= map.size) return false;
  // NPC は内部にも置ける (#425 の座標は将来 mapId 付きにする。今はフィールド座標のみ)。
  const idx = interiorPartAt(map, x, y);
  if (idx !== undefined) {
    // パーツ自身の通行値が最優先 (フィールドと同じ規則)。内部固有のパーツ表があれば
    // それを、無ければフィールドのパーツ表を見る。
    const own = map.parts?.[idx]?.walkable;
    if (own !== undefined) return own;
    if (!map.parts) {
      const w = worldPartWalkable(idx);
      if (w !== undefined) return w;
    }
  }
  return isWalkable(interiorTerrainAt(map, x, y));
}

/**
 * マップをまたいで通行判定する。`mapId` が内部でなければフィールドの判定に委ねる。
 * **NPC は今のところフィールドにしか置けない** (NpcDef が mapId を持たない)。
 * 内部に NPC を置けるようにするのは #425 の続きで、そのときここも見るようにする。
 */
export function walkableIn(mapId: string, x: number, y: number, worldWalkable: (x: number, y: number) => boolean): boolean {
  const m = interiorById(mapId);
  if (!m) return worldWalkable(x, y);
  return interiorWalkableAt(m, x, y);
}
