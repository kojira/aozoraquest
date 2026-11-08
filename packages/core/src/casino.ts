/**
 * **カジノの 1 回の結果と払い出し** (D-CASINO-001)。純関数。乱数は呼び出し側 (edge) が seed から作る。
 *
 * RTP (賭けたうち戻る割合の期待値) は うん で決まる (r2): `94% + min(luk, 60) / 60 × 3%`。
 * 100% には届かないので、コインを増やし続けることはできない。
 * - スロット: 空きのコマが出たリールを 1 つ、確率 p で引き直す。p は表から計算して RTP がちょうど目標になる値
 *   (表の RTP が目標より高いときだけ、払い出しを目標/表 の比で下げる)
 * - ハイロー: 倍率に 目標/表の RTP をかける。表の RTP は **いつも有利なほうを選んだとき** (どれを選んでも目標以下)
 * - レース: 倍率に 目標/表の RTP をかける。表の RTP は **いちばん得な 1 頭** (どれに賭けても目標以下)
 * 払い出しの端数は確率で丸める (floor に、端数の確率で 1 を足す)。期待値が目標と同じになる。
 */
import {
  casinoShapeIssue, CasinoDataError, CASINO_TABLE_RTP_MAX, CASINO_TABLE_RTP_MIN, DEFAULT_CASINO_TABLES, HIGHLOW_CARDS, SLOT_BLANK, SLOT_REEL_SIZE,
  type CasinoGame, type CasinoTables, type SlotSymbol,
} from './casino-data.js';
import { MONSTERS } from './battle-monsters.js';

let current: CasinoTables = structuredClone(DEFAULT_CASINO_TABLES);

/** 今の表 (world.casino があればそれ、無ければ同梱)。 */
export function casinoTables(): CasinoTables {
  return current;
}

/** 形と RTP の範囲をまとめて見る (無ければ null)。保存と読み込みはどちらもこれを通す。 */
export function casinoTablesIssue(t: CasinoTables): string | null {
  return casinoShapeIssue(t) ?? casinoTableRtpIssue(t);
}

/** 検証して差し替える。`null` で同梱の表へ戻す。壊れていれば CasinoDataError (今の表を保つ)。 */
export function setCasinoTables(rec: CasinoTables | null): void {
  if (rec === null) {
    current = structuredClone(DEFAULT_CASINO_TABLES);
    return;
  }
  const issue = casinoTablesIssue(rec);
  if (issue) throw new CasinoDataError(issue);
  current = structuredClone({ slots: rec.slots, highlow: rec.highlow, race: rec.race, prizes: rec.prizes });
}

const RACE_LINEUP = 5;

/** うんの効き: この値で上限。 */
export const CASINO_LUK_CAP = 60;
export const CASINO_RTP_BASE = 0.94;
export const CASINO_RTP_LUK_BONUS = 0.03;

/** その うん での目標の RTP。 */
export function casinoTargetRtp(luk: number): number {
  const l = Math.min(CASINO_LUK_CAP, Math.max(0, Number.isFinite(luk) ? luk : 0));
  return CASINO_RTP_BASE + (l / CASINO_LUK_CAP) * CASINO_RTP_LUK_BONUS;
}

// ─── スロット ────────────────────────────────────────

/** 3 つの絵柄の払い出し (賭けの倍)。3 つそろい → どこでもの絵柄 の順。 */
export function slotMultiplier(reels: readonly string[], symbols: readonly SlotSymbol[]): number {
  const [a, b, c] = reels;
  if (a === b && b === c) {
    const s = symbols.find((x) => x.id === a);
    if (s?.triple) return s.triple;
  }
  let best = 0;
  for (const s of symbols) {
    if (!s.any) continue;
    const n = reels.filter((r) => r === s.id).length;
    if (n > 0) best = Math.max(best, s.any[n - 1]!);
  }
  return best;
}

function reelStrip(symbols: readonly SlotSymbol[]): string[] {
  return symbols.flatMap((s) => Array<string>(s.count).fill(s.id));
}

/** 引き直さないときの RTP (r0) と、空きを必ず引き直すときの RTP (r1)。全 32^3 通りを数える。 */
export function slotRtpParts(symbols: readonly SlotSymbol[]): { r0: number; r1: number } {
  const strip = reelStrip(symbols);
  const n = strip.length;
  let r0 = 0;
  let r1 = 0;
  for (const a of strip) for (const b of strip) for (const c of strip) {
    const reels = [a, b, c];
    const m = slotMultiplier(reels, symbols);
    r0 += m;
    const i = reels.indexOf(SLOT_BLANK);
    if (i < 0) { r1 += m; continue; }
    let sum = 0;
    for (const r of strip) { const re = [...reels]; re[i] = r; sum += slotMultiplier(re, symbols); }
    r1 += sum / n;
  }
  return { r0: r0 / n ** 3, r1: r1 / n ** 3 };
}

const slotPartsCache = new WeakMap<object, { r0: number; r1: number }>();
function slotParts(symbols: readonly SlotSymbol[]): { r0: number; r1: number } {
  let p = slotPartsCache.get(symbols);
  if (!p) { p = slotRtpParts(symbols); slotPartsCache.set(symbols, p); }
  return p;
}

/** スロットのうんの効き: 引き直しの確率 respin と、払い出しにかける scale (表が目標より高いときだけ 1 未満)。 */
export function slotLukParams(symbols: readonly SlotSymbol[], luk: number): { respin: number; scale: number } {
  const { r0, r1 } = slotParts(symbols);
  const target = casinoTargetRtp(luk);
  if (target <= r0) return { respin: 0, scale: target / r0 };
  if (target >= r1) return { respin: 1, scale: target / r1 };
  return { respin: (target - r0) / (r1 - r0), scale: 1 };
}

// ─── ハイロー ────────────────────────────────────────

export type HighLowPick = 'high' | 'low';

/** 1 枚目が first のとき、pick で勝てる数字の数 (同じ数字は負け)。 */
export function highLowWinCount(first: number, pick: HighLowPick): number {
  return pick === 'high' ? HIGHLOW_CARDS - first : first - 1;
}

/** ハイローの表の RTP (いつも有利なほうを選んだとき)。 */
export function highLowTableRtp(mult: readonly number[]): number {
  let sum = 0;
  for (let c = 1; c <= HIGHLOW_CARDS; c++) {
    const r = (k: number) => (k > 0 ? (k / HIGHLOW_CARDS) * (mult[k - 1]! / 100) : 0);
    sum += Math.max(r(highLowWinCount(c, 'high')), r(highLowWinCount(c, 'low')));
  }
  return sum / HIGHLOW_CARDS;
}

// ─── レース ──────────────────────────────────────────

/** レースの表の RTP (いちばん得な 1 頭)。 */
export function raceTableRtp(runners: CasinoTables['race']['runners']): number {
  return Math.max(...runners.map((r) => (r.prob / 100) * (r.odds / 100)));
}

// ─── 表の RTP ────────────────────────────────────────

/** 各ゲームの表の RTP (うんの補正の前)。管理画面はこれを見せ、85〜98% の外なら保存できない。 */
export function casinoTableRtp(t: CasinoTables): Record<CasinoGame, number> {
  return { slots: slotParts(t.slots.symbols).r0, highlow: highLowTableRtp(t.highlow.mult), race: raceTableRtp(t.race.runners) };
}

/** 表の RTP の問題 (無ければ null)。 */
export function casinoTableRtpIssue(t: CasinoTables): string | null {
  const rtp = casinoTableRtp(t);
  for (const g of Object.keys(rtp) as CasinoGame[]) {
    const v = rtp[g];
    if (!(v >= CASINO_TABLE_RTP_MIN && v <= CASINO_TABLE_RTP_MAX)) {
      return `${g} の RTP ${(v * 100).toFixed(1)}% は ${CASINO_TABLE_RTP_MIN * 100}〜${CASINO_TABLE_RTP_MAX * 100}% の外`;
    }
  }
  return null;
}

/** 選び方ごとの、うんを入れた本当の RTP (テストと管理画面の表示用)。 */
export function casinoEffectiveRtp(t: CasinoTables, game: CasinoGame, luk: number): number {
  const target = casinoTargetRtp(luk);
  if (game === 'slots') {
    const { r0, r1 } = slotParts(t.slots.symbols);
    const { respin, scale } = slotLukParams(t.slots.symbols, luk);
    return (r0 + respin * (r1 - r0)) * scale;
  }
  return target; // ハイローとレースは scale で、いちばん得な選び方をちょうど目標にする
}

// ─── 1 回 ────────────────────────────────────────────

/** ゲームごとの選び方。スロットは選ぶものが無い。ハイローの first は edge が先に引いて見せた 1 枚目。 */
export interface CasinoChoiceMap {
  slots: Record<string, never>;
  highlow: { first: number; pick: HighLowPick };
  race: { runner: number };
}

export type CasinoOutcome =
  | { game: 'slots'; reels: string[]; respun: number | null; payout: number }
  | { game: 'highlow'; first: number; second: number; win: boolean; payout: number }
  | { game: 'race'; runner: number; winner: number; payout: number };

export class CasinoPlayError extends Error {}

/** 端数を確率で丸める: floor(x) に、端数の確率で 1 を足す。期待値は x のまま。 */
export function roundStochastic(x: number, rng: () => number): number {
  const f = Math.floor(x);
  return rng() < x - f ? f + 1 : f;
}

/** ハイローの 1 枚目 (1〜13)。edge が先に引いて見せる。 */
export function dealHighLow(rng: () => number): number {
  return 1 + Math.floor(rng() * HIGHLOW_CARDS);
}

/**
 * 1 回遊ぶ。bet は賭けたコイン、luk は装備込みの うん。払い出しは賭けを含む (外れは 0)。
 * 表は今の表 (casinoTables)。コインの増減は呼び出し側がする。
 */
export function playCasino<G extends CasinoGame>(
  game: G, bet: number, choice: CasinoChoiceMap[G], luk: number, rng: () => number, t: CasinoTables = casinoTables(),
): CasinoOutcome {
  if (!Number.isInteger(bet) || bet <= 0) throw new CasinoPlayError('賭けが不正');
  if (game === 'slots') {
    const strip = reelStrip(t.slots.symbols);
    const spin = () => strip[Math.floor(rng() * SLOT_REEL_SIZE)]!;
    const reels = [spin(), spin(), spin()];
    const { respin, scale } = slotLukParams(t.slots.symbols, luk);
    const blank = reels.indexOf(SLOT_BLANK);
    let respun: number | null = null;
    // 乱数の消費を結果によらず一定にする (seed から結果を再現しやすく)。
    const roll = rng();
    if (blank >= 0 && roll < respin) { reels[blank] = spin(); respun = blank; }
    const m = slotMultiplier(reels, t.slots.symbols);
    return { game: 'slots', reels, respun, payout: m > 0 ? roundStochastic(bet * m * scale, rng) : 0 };
  }
  const scale = casinoTargetRtp(luk) / (game === 'highlow' ? highLowTableRtp(t.highlow.mult) : raceTableRtp(t.race.runners));
  if (game === 'highlow') {
    const { first, pick } = (choice ?? {}) as CasinoChoiceMap['highlow'];
    if (!Number.isInteger(first) || first < 1 || first > HIGHLOW_CARDS) throw new CasinoPlayError('1 枚目が不正');
    if (pick !== 'high' && pick !== 'low') throw new CasinoPlayError('上か下かが不正');
    const k = highLowWinCount(first, pick);
    if (k === 0) throw new CasinoPlayError('勝てる数字が無い');
    const second = dealHighLow(rng);
    const win = pick === 'high' ? second > first : second < first;
    return { game: 'highlow', first, second, win, payout: win ? roundStochastic((bet * t.highlow.mult[k - 1]! * scale) / 100, rng) : 0 };
  }
  if (game !== 'race') throw new CasinoPlayError('ゲームが不正');
  const { runner } = (choice ?? {}) as CasinoChoiceMap['race'];
  const runners = t.race.runners;
  if (!Number.isInteger(runner) || runner < 0 || runner >= runners.length) throw new CasinoPlayError('走者が不正');
  let u = rng() * 100;
  let winner = runners.length - 1;
  for (let i = 0; i < runners.length; i++) { u -= runners[i]!.prob; if (u < 0) { winner = i; break; } }
  return { game: 'race', runner, winner, payout: winner === runner ? roundStochastic((bet * runners[runner]!.odds * scale) / 100, rng) : 0 };
}

/**
 * レースに出る 5 ひき (にんきの順)。その tier の、物語だけの敵を除いたモンスターから乱数で選ぶ。
 * 足りなければ 1 つ下の tier から足し、それでも足りなければ同じ敵を重ねて出す (名前の後ろに番号)。
 */
export function raceLineup(tier: number, rng: () => number): Array<{ id: string; name: string; species: string }> {
  const out: Array<{ id: string; name: string; species: string }> = [];
  for (let t = tier; t >= 1 && out.length < RACE_LINEUP; t--) {
    const pool = MONSTERS.filter((m) => m.tier === t && !m.storyOnly && !out.some((o) => o.id === m.id));
    while (pool.length && out.length < RACE_LINEUP) {
      const m = pool.splice(Math.floor(rng() * pool.length), 1)[0]!;
      out.push({ id: m.id, name: m.name, species: m.species });
    }
  }
  const base = out.length ? [...out] : [{ id: 'slime', name: 'スライム', species: 'slime' }];
  for (let i = 0; out.length < RACE_LINEUP; i++) {
    const b = base[i % base.length]!;
    out.push({ ...b, name: `${b.name}${out.length + 1}` });
  }
  return out;
}


/** レースの顔ぶれの seed (rkey から決まる。顔ぶれは見た目だけなので、画面が賭ける前に同じものを出せる)。 */
export function raceLineupSeed(rkey: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < rkey.length; i++) h = Math.imul(h ^ rkey.charCodeAt(i), 0x01000193);
  return h >>> 0;
}
