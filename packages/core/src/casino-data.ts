/**
 * **カジノの表** (D-CASINO-001)。スロットのリール・ハイローの倍率・レースの確率と倍率・景品の一覧。
 *
 * - 保存先は管理者 PDS の `world.casino` (items の後・shops の前に読む。景品の id は items を引く)。
 *   レコードが無ければ、ここに同梱した表を使う
 * - AT Protocol のレコードは整数しか持てないので、倍率は 100 倍 (235 = 2.35 倍)、確率は % で持つ
 * - 壊れた 1 件で全体を落とす (部分適用しない。今の表を保つ)
 * - 今の表 (casinoTables / setCasinoTables)・RTP の計算・結果を決める純関数は casino.ts
 */
import { ITEMS } from './battle.js';
import { EQUIPMENT_BY_ID } from './equipment.js';

export class CasinoDataError extends Error {}

export type CasinoGame = 'slots' | 'highlow' | 'race';
export const CASINO_GAMES: readonly CasinoGame[] = ['slots', 'highlow', 'race'];

/** 1 回に賭けられるコイン。 */
export const CASINO_BETS: readonly number[] = [10, 20, 50];
/** 持てるコインの上限。 */
export const CASINO_COIN_MAX = 99_999;
/** スロットの 1 リールのコマ数。 */
export const SLOT_REEL_SIZE = 32;
/** 引き直しの対象になる絵柄 (空き)。 */
export const SLOT_BLANK = 'blank';
/** ハイローの札は 1〜13。 */
export const HIGHLOW_CARDS = 13;
/** レースは 5 ひき。 */
export const RACE_RUNNERS = 5;
/** 管理画面で保存できる表の RTP (luk 0・うんの補正の前)。この外の表は保存できない。 */
export const CASINO_TABLE_RTP_MIN = 0.85;
export const CASINO_TABLE_RTP_MAX = 0.98;

/** スロットの絵柄。triple = 3 つそろったときの賭けの倍。any = どこでも 1/2/3 つ出たときの倍 (やくそう)。 */
export interface SlotSymbol {
  id: string;
  name: string;
  /** 1 リール 32 コマのうちのコマ数。 */
  count: number;
  triple?: number;
  any?: [number, number, number];
}

/** レースの 1 頭ぶん (にんきの順)。prob は勝つ確率 (%)、odds は単勝の倍率の 100 倍。 */
export interface RaceRunner {
  prob: number;
  odds: number;
}

/** 景品。coins はコインの値段。 */
export type CasinoPrize =
  | { kind: 'equipment'; id: string; coins: number }
  | { kind: 'item'; id: string; coins: number };

export interface CasinoTables {
  slots: { symbols: SlotSymbol[] };
  /** k (勝てる数字の数 1〜12) ごとの倍率の 100 倍。mult[k-1]。 */
  highlow: { mult: number[] };
  race: { runners: RaceRunner[] };
  prizes: CasinoPrize[];
}

export interface CasinoRecord extends CasinoTables {
  updatedAt: string;
}

/**
 * 同梱の表。r2 (オーナー承認: luk 0 で 94%・luk 60 で 97%) に合わせて、承認した表から
 * スライム 20→18、ハイローは 13/k×0.94、レースは確率×倍率 ≈ 94% に直した (払い出しの数は内容の扱い)。
 */
export const DEFAULT_CASINO_TABLES: CasinoTables = {
  slots: {
    symbols: [
      { id: 'aozora', name: 'あおぞら', count: 1, triple: 500 },
      { id: 'star', name: 'ほし', count: 2, triple: 150 },
      { id: 'golem', name: 'ゴーレム', count: 3, triple: 60 },
      { id: 'bat', name: 'コウモリ', count: 4, triple: 30 },
      { id: 'slime', name: 'スライム', count: 6, triple: 18 },
      { id: 'herb', name: 'やくそう', count: 5, any: [1, 4, 20] },
      { id: SLOT_BLANK, name: '空き', count: 11 },
    ],
  },
  highlow: { mult: [1222, 611, 407, 306, 244, 204, 175, 153, 136, 122, 111, 102] },
  race: {
    runners: [
      { prob: 40, odds: 235 },
      { prob: 25, odds: 376 },
      { prob: 18, odds: 522 },
      { prob: 12, odds: 783 },
      { prob: 5, odds: 1880 },
    ],
  },
  prizes: [
    { kind: 'equipment', id: 'wp-star-sword', coins: 20_000 },
    { kind: 'equipment', id: 'ar-star-robe', coins: 15_000 },
    { kind: 'equipment', id: 'wp-star-dice', coins: 12_000 },
    { kind: 'equipment', id: 'ch-lucky-charm', coins: 6_000 },
    { kind: 'item', id: 'name-tag', coins: 1_000 },
  ],
};

const isPosInt = (n: unknown): n is number => Number.isInteger(n) && (n as number) > 0;
const isNonNegInt = (n: unknown): n is number => Number.isInteger(n) && (n as number) >= 0;

/** 表の形の問題 (無ければ null)。RTP の範囲は casino.ts の casinoTableRtpIssue が見る。
 *  景品は casinoOnly の品だけ (店と置きアイテムには出ない品)。 */
export function casinoShapeIssue(t: CasinoTables): string | null {
  if (!t || typeof t !== 'object') return '表が無い';
  const symbols = t.slots?.symbols;
  if (!Array.isArray(symbols) || symbols.length === 0) return 'スロットの絵柄が無い';
  const ids = new Set<string>();
  let total = 0;
  for (const s of symbols) {
    if (!s || typeof s.id !== 'string' || !s.id) return 'スロットの絵柄の id が空';
    if (ids.has(s.id)) return `スロットの絵柄が重複 (${s.id})`;
    ids.add(s.id);
    if (typeof s.name !== 'string' || !s.name.trim() || s.name.length > 10) return `${s.id}: 名前は 1〜10 字`;
    if (!isPosInt(s.count)) return `${s.id}: コマ数が不正`;
    total += s.count;
    if (s.triple !== undefined && !isPosInt(s.triple)) return `${s.id}: 3 つの倍率が不正`;
    if (s.any !== undefined && (!Array.isArray(s.any) || s.any.length !== 3 || !s.any.every(isNonNegInt))) return `${s.id}: どこでもの倍率が不正`;
    if (s.triple !== undefined && s.any !== undefined) return `${s.id}: 3 つの倍率と どこでもの倍率は どちらか 1 つ`;
    if (s.id === SLOT_BLANK && (s.triple !== undefined || s.any !== undefined)) return '空きに倍率は付けられない';
  }
  if (!ids.has(SLOT_BLANK)) return '空きの絵柄が無い';
  if (total !== SLOT_REEL_SIZE) return `リールのコマ数の合計は ${SLOT_REEL_SIZE} (今 ${total})`;
  const mult = t.highlow?.mult;
  if (!Array.isArray(mult) || mult.length !== HIGHLOW_CARDS - 1 || !mult.every(isPosInt)) return `ハイローの倍率は ${HIGHLOW_CARDS - 1} 個の正の整数`;
  const runners = t.race?.runners;
  if (!Array.isArray(runners) || runners.length !== RACE_RUNNERS) return `レースは ${RACE_RUNNERS} ひき`;
  if (!runners.every((r) => r && isPosInt(r.prob) && isPosInt(r.odds))) return 'レースの確率と倍率は正の整数';
  if (runners.reduce((a, r) => a + r.prob, 0) !== 100) return 'レースの確率の合計は 100';
  if (!Array.isArray(t.prizes)) return '景品の一覧が無い';
  const prizeIds = new Set<string>();
  for (const p of t.prizes) {
    if (!p || typeof p.id !== 'string') return '景品の id が空';
    if (prizeIds.has(p.id)) return `景品が重複 (${p.id})`;
    prizeIds.add(p.id);
    if (!isPosInt(p.coins) || p.coins > CASINO_COIN_MAX) return `${p.id}: 値段は 1〜${CASINO_COIN_MAX}`;
    if (p.kind === 'equipment') {
      const def = EQUIPMENT_BY_ID[p.id];
      if (!def) return `景品の装備が存在しない (${p.id})`;
      if (!def.casinoOnly) return `${p.id}: 景品の装備は casinoOnly にする`;
    } else if (p.kind === 'item') {
      const def = ITEMS[p.id];
      if (!def) return `景品のどうぐが存在しない (${p.id})`;
      if (!def.casinoOnly) return `${p.id}: 景品のどうぐは casinoOnly にする`;
    } else {
      return `${(p as { id: string }).id}: 景品の種類が不正`;
    }
  }
  return null;
}
