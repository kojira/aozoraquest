/**
 * カジノ (D-CASINO-001 PR2)。コインの増減はここだけ。どれも readModifyWrite 1 回 = 書き込み 1 回。
 *
 * - 両替 `exchange {power, rkey}`: 1・10・50 パワー → ×10 コイン。上限を超えるなら断る。**コイン → パワーの道は無い**
 * - 毎日のコイン `bonus {rkey}`: 50 コイン。その日 (JST) に投稿の申告がある (claimDay が今日) ときだけ。1 日 1 回
 * - 遊ぶ `play {game, bet, choice, rkey}`: 結果は edge の乱数 (kuda + CSPRNG の seed) で決める。賭けは 10・20・50
 *   - スロット: choice.times = 10 で 10 回まとめて (書き込みは 1 回・回数も 1 回と数える)
 *   - ハイロー: 配る (bet) → 上か下か (choice.pick) → 勝てば 3 回まで続けられる → やめる (choice.cashout)。
 *     途中の賭けは casinoHL に残し、次に配るときに自動で払い出す (消えない)
 *   - レース: 顔ぶれは rkey から決まる (raceLineupSeed)。choice.runner に賭ける
 * - 景品 `prize {prizeId, rkey}`: 装備は pieces に (MAX_OWNED_PIECES まで)、どうぐは materials に (99 まで)
 * - 冪等: 同じ rkey の 2 回目は何もせず、casinoLast に覚えた同じ結果 (無ければ今のコイン) を返す
 * - 回数の上限: 1 分 6 回・1 日 150 回 (書き込みの回数)。超えると 429。
 *   **途中のハイローの 上か下か・やめる は止めない** (数えはする)。賭けたコインが宙に浮かないように
 * - 場所: 署名トークンの位置 (無ければ state) が、そのカジノの両替・景品・そのゲームの台のマスであること
 */
import {
  CASINO_BETS, CASINO_COIN_MAX, casinoSpotAt, casinoTables, dealHighLow, EQUIPMENT_BY_ID, interiorById, ITEMS, playCasino, raceLineup,
  raceLineupSeed, regionOf, highLowWinCount, tierForRegion, type CasinoGame, type CasinoOutcome, type HighLowPick,
} from '@aozoraquest/core';
import { createRng } from '@aozoraquest/core';
import { readModifyWrite, type GameState, type OwnedPiece } from './game-state';
import { MAX_ITEM_STACK, MAX_OWNED_PIECES } from './shop';
import { ResolverError } from './battle-resolver';
import { dayKey } from './xp-claim';

export const MAX_CASINO_OPS = 100;
export const CASINO_EXCHANGE_POWER: readonly number[] = [1, 10, 50];
export const CASINO_COINS_PER_POWER = 10;
export const CASINO_DAILY_BONUS = 50;
export const CASINO_RATE_PER_MINUTE = 6;
export const CASINO_RATE_PER_DAY = 150;
export const CASINO_SLOT_BATCH = 10;
/** ハイローで当たったあと続けられる回数。 */
export const CASINO_HL_MAX_STEP = 3;

export type CasinoPos = { mapId?: string; x: number; y: number };

export interface CasinoResult {
  coins: number;
  duplicate?: boolean;
  power?: number;
  /** ゲームの結果 (スロットのまとめは 10 件)。 */
  outcomes?: CasinoOutcome[];
  /** ハイローの途中 (配ったとき・当たって続けられるとき)。 */
  highlow?: { first: number; stake: number; step: number; canContinue: boolean };
  /** ハイローで やめた・自動で払い出したときのコイン。 */
  cashout?: number;
  race?: { runners: Array<{ id: string; name: string; species: string }> };
  pieces?: OwnedPiece[];
  materials?: Record<string, number>;
}

const err = (msg: string, code: string, status = 400) => new ResolverError(msg, status, code);

function assertRkey(rkey: unknown): asserts rkey is string {
  if (typeof rkey !== 'string' || !rkey || rkey.length > 128) throw err('rkey が不正', 'bad_request');
}

/** 位置が そのカジノのマスか。kind が exchange/prize ならそのマス、game ならそのゲームの台。 */
function assertSpot(pos: CasinoPos, want: { kind: 'exchange' } | { kind: 'prize' } | { kind: 'game'; game: CasinoGame }): void {
  const spot = pos.mapId ? casinoSpotAt(pos.mapId, pos.x, pos.y) : undefined;
  const ok = spot && spot.kind === want.kind && (spot.kind !== 'game' || (want.kind === 'game' && spot.game === want.game));
  if (!ok) throw err('ここでは できない', 'not_at_casino');
}

/** 1 分・1 日の回数を 1 足す。blockable なら上限で 429。 */
function bumpRate(cur: GameState, now: number, blockable: boolean): GameState['casinoRate'] {
  const minute = Math.floor(now / 60);
  const day = dayKey(now);
  const r = cur.casinoRate;
  const perMinute = r?.minute === minute ? r.perMinute : 0;
  const perDay = r?.day === day ? r.perDay : 0;
  if (blockable && perDay >= CASINO_RATE_PER_DAY) throw err('今日はここまでです。また明日どうぞ。', 'rate_day', 429);
  if (blockable && perMinute >= CASINO_RATE_PER_MINUTE) throw err('すこし休んでいきませんか。また少ししたら遊べます。', 'rate_minute', 429);
  return { minute, perMinute: perMinute + 1, day, perDay: perDay + 1 };
}

const withOp = (cur: GameState, rkey: string) => [...(cur.casinoOps ?? []), rkey].slice(-MAX_CASINO_OPS);

/**
 * 共通の書き込み。同じ rkey なら覚えた結果を返す (書かない)。mutate は新しい state と返す結果を作る。
 */
async function casinoWrite(
  env: Parameters<typeof readModifyWrite>[0], did: string, rkey: string, now: number,
  init: ((did: string, iso: string) => Promise<GameState>) | undefined,
  mutate: (cur: GameState) => { next: GameState; res: Omit<CasinoResult, 'coins'> },
): Promise<CasinoResult> {
  let res: CasinoResult | undefined;
  const after = await readModifyWrite(env, did, (cur) => {
    if ((cur.casinoOps ?? []).includes(rkey)) {
      const last = cur.casinoLast?.rkey === rkey ? (cur.casinoLast.res as Omit<CasinoResult, 'coins'>) : {};
      res = { ...last, coins: cur.casinoCoins ?? 0, duplicate: true };
      return cur;
    }
    const m = mutate(cur);
    res = { ...m.res, coins: m.next.casinoCoins ?? 0 };
    return { ...m.next, casinoOps: withOp(cur, rkey), casinoLast: { rkey, res: m.res as Record<string, unknown> } };
  }, init ? { now, init } : { now });
  return { ...res!, coins: after.casinoCoins ?? 0 };
}

/** 両替 (パワー → コイン)。 */
export async function casinoExchange(env: Parameters<typeof readModifyWrite>[0], did: string, input: { power: unknown; rkey: unknown; pos: CasinoPos }, now: number, init?: (d: string, iso: string) => Promise<GameState>): Promise<CasinoResult> {
  assertRkey(input.rkey);
  const power = input.power;
  if (typeof power !== 'number' || !CASINO_EXCHANGE_POWER.includes(power)) throw err('両替の額が不正', 'bad_request');
  assertSpot(input.pos, { kind: 'exchange' });
  return casinoWrite(env, did, input.rkey, now, init, (cur) => {
    if (cur.power < power) throw err('パワーが足りないみたいです。', 'no_power');
    const coins = (cur.casinoCoins ?? 0) + power * CASINO_COINS_PER_POWER;
    if (coins > CASINO_COIN_MAX) throw err(`コインは ${CASINO_COIN_MAX} 枚までです。`, 'coins_full');
    return { next: { ...cur, power: cur.power - power, casinoCoins: coins }, res: { power: cur.power - power } };
  });
}

/** 毎日のコイン。 */
export async function casinoBonus(env: Parameters<typeof readModifyWrite>[0], did: string, input: { rkey: unknown; pos: CasinoPos }, now: number, init?: (d: string, iso: string) => Promise<GameState>): Promise<CasinoResult> {
  assertRkey(input.rkey);
  assertSpot(input.pos, { kind: 'exchange' });
  const today = dayKey(now);
  return casinoWrite(env, did, input.rkey, now, init, (cur) => {
    if (cur.claimDay !== today) throw err('今日もう投稿した方に、コインをお配りしています。', 'no_post_today');
    if (cur.casinoBonusDay === today) throw err('今日のぶんは もう お渡ししました。', 'bonus_taken');
    const coins = Math.min(CASINO_COIN_MAX, (cur.casinoCoins ?? 0) + CASINO_DAILY_BONUS);
    return { next: { ...cur, casinoCoins: coins, casinoBonusDay: today }, res: {} };
  });
}

/** 景品と交換。 */
export async function casinoPrize(env: Parameters<typeof readModifyWrite>[0], did: string, input: { prizeId: unknown; rkey: unknown; pos: CasinoPos }, now: number, init?: (d: string, iso: string) => Promise<GameState>): Promise<CasinoResult> {
  assertRkey(input.rkey);
  const prize = casinoTables().prizes.find((p) => p.id === input.prizeId);
  if (!prize) throw err('その景品は ない', 'unknown_prize');
  if (prize.kind === 'equipment' ? !EQUIPMENT_BY_ID[prize.id] : !ITEMS[prize.id]) throw err('その景品は ない', 'unknown_prize');
  assertSpot(input.pos, { kind: 'prize' });
  const rkey = input.rkey;
  return casinoWrite(env, did, rkey, now, init, (cur) => {
    const have = cur.casinoCoins ?? 0;
    if (have < prize.coins) throw err('コインが 足りない', 'no_coins');
    const base = { ...cur, casinoCoins: have - prize.coins };
    if (prize.kind === 'equipment') {
      const pieces = cur.pieces ?? [];
      if (pieces.length >= MAX_OWNED_PIECES) throw err(`もちものが いっぱいだ (${MAX_OWNED_PIECES} 個)`, 'pieces_full');
      const next = [...pieces, { rkey, itemId: prize.id, level: 0 }];
      return { next: { ...base, pieces: next }, res: { pieces: next } };
    }
    const owned = cur.materials[prize.id] ?? 0;
    if (owned >= MAX_ITEM_STACK) throw err(`これ以上は もてない (${MAX_ITEM_STACK} 個)`, 'stack_full');
    const materials = { ...cur.materials, [prize.id]: owned + 1 };
    return { next: { ...base, materials }, res: { materials } };
  });
}

/** レースの顔ぶれ (賭ける前に画面が出す。rkey から決まるので play と同じ)。 */
export function casinoRaceLineup(pos: CasinoPos, rkey: string) {
  const town = pos.mapId ? interiorById(pos.mapId)?.casino?.town : undefined;
  const tier = town ? tierForRegion(regionOf(town.x, town.y)) : 1;
  return raceLineup(tier, createRng(raceLineupSeed(rkey)));
}

export interface CasinoPlayInput {
  game: unknown;
  bet?: unknown;
  choice?: { pick?: unknown; cashout?: unknown; runner?: unknown; times?: unknown };
  rkey: unknown;
  pos: CasinoPos;
  luk: number;
  /** 結果を決める seed (edge が entropyU32 で引く)。 */
  seed: number;
}

/** 遊ぶ。 */
export async function casinoPlay(env: Parameters<typeof readModifyWrite>[0], did: string, input: CasinoPlayInput, now: number, init?: (d: string, iso: string) => Promise<GameState>): Promise<CasinoResult> {
  assertRkey(input.rkey);
  const game = input.game as CasinoGame;
  if (game !== 'slots' && game !== 'highlow' && game !== 'race') throw err('ゲームが不正', 'bad_request');
  assertSpot(input.pos, { kind: 'game', game });
  const choice = input.choice ?? {};
  const pick = choice.pick as HighLowPick | undefined;
  const cashout = choice.cashout === true;
  const hlFollowUp = game === 'highlow' && (pick !== undefined || cashout);
  const bet = input.bet;
  if (!hlFollowUp && (typeof bet !== 'number' || !CASINO_BETS.includes(bet))) throw err('賭けは 10・20・50', 'bad_request');
  const rng = createRng(input.seed);
  const rkey = input.rkey;
  return casinoWrite(env, did, rkey, now, init, (cur) => {
    const casinoRate = bumpRate(cur, now, !hlFollowUp);
    let coins = cur.casinoCoins ?? 0;
    if (game === 'highlow') return highLow(cur, { coins, casinoRate, bet: bet as number, pick, cashout, luk: input.luk, rng });
    if (game === 'slots') {
      const times = choice.times === CASINO_SLOT_BATCH ? CASINO_SLOT_BATCH : 1;
      if (coins < (bet as number) * times) throw err('コインが 足りない', 'no_coins');
      const outcomes: CasinoOutcome[] = [];
      for (let i = 0; i < times; i++) {
        const o = playCasino('slots', bet as number, {}, input.luk, rng);
        coins = Math.min(CASINO_COIN_MAX, coins - (bet as number) + o.payout);
        outcomes.push(o);
      }
      return { next: { ...cur, casinoCoins: coins, casinoRate }, res: { outcomes } };
    }
    const runner = choice.runner;
    if (typeof runner !== 'number') throw err('走者が不正', 'bad_request');
    if (coins < (bet as number)) throw err('コインが 足りない', 'no_coins');
    const o = playCasino('race', bet as number, { runner }, input.luk, rng);
    coins = Math.min(CASINO_COIN_MAX, coins - (bet as number) + o.payout);
    return { next: { ...cur, casinoCoins: coins, casinoRate }, res: { outcomes: [o], race: { runners: casinoRaceLineup(input.pos, rkey) } } };
  });
}

function highLow(cur: GameState, a: { coins: number; casinoRate: GameState['casinoRate']; bet: number; pick?: HighLowPick; cashout: boolean; luk: number; rng: () => number }) {
  const hl = cur.casinoHL;
  const { casinoHL: _drop, ...rest } = cur;
  if (a.cashout) {
    if (!hl || hl.step === 0) throw err('いまは やめられない', 'no_hand');
    const coins = Math.min(CASINO_COIN_MAX, a.coins + hl.stake);
    return { next: { ...rest, casinoCoins: coins, casinoRate: a.casinoRate }, res: { cashout: hl.stake } };
  }
  if (a.pick !== undefined) {
    if (!hl) throw err('まだ 札を 配っていない', 'no_hand');
    if (a.pick !== 'high' && a.pick !== 'low') throw err('上か下かが不正', 'bad_request');
    if (highLowWinCount(hl.first, a.pick) === 0) throw err('その選び方では 勝てない', 'bad_request');
    const o = playCasino('highlow', hl.stake, { first: hl.first, pick: a.pick }, a.luk, a.rng) as Extract<CasinoOutcome, { game: 'highlow' }>;
    if (!o.win) return { next: { ...rest, casinoRate: a.casinoRate }, res: { outcomes: [o] } };
    const step = hl.step + 1;
    if (step > CASINO_HL_MAX_STEP) {
      const coins = Math.min(CASINO_COIN_MAX, a.coins + o.payout);
      return { next: { ...rest, casinoCoins: coins, casinoRate: a.casinoRate }, res: { outcomes: [o], cashout: o.payout } };
    }
    const next = { first: o.second, stake: o.payout, step };
    return { next: { ...rest, casinoHL: next, casinoRate: a.casinoRate }, res: { outcomes: [o], highlow: { ...next, canContinue: true } } };
  }
  // 配っただけで まだ選んでいない手があれば、同じ手をもう一度見せる (引き直して 1 枚目を選べないように)。
  if (hl && hl.step === 0) return { next: cur, res: { highlow: { ...hl, canContinue: true } } };
  // 途中の勝ちがあれば先に払い出す (賭けたコインを消さない)。
  const paidBack = hl ? hl.stake : 0;
  let coins = a.coins + paidBack;
  if (coins < a.bet) throw err('コインが 足りない', 'no_coins');
  coins = Math.min(CASINO_COIN_MAX, coins) - a.bet;
  const first = dealHighLow(a.rng);
  const next = { first, stake: a.bet, step: 0 };
  return { next: { ...rest, casinoCoins: coins, casinoHL: next, casinoRate: a.casinoRate }, res: { highlow: { ...next, canContinue: true }, ...(paidBack ? { cashout: paidBack } : {}) } };
}
