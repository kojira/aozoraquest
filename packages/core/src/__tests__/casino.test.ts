/**
 * カジノ (D-CASINO-001 PR1)。表から計算した RTP・シミュレーション・景品は店と置きアイテムに出ない。
 * シミュレーションはふだん 1e5 回、`SIM=1` のときだけ 1e6 回。seed は固定 (毎回同じ結果)。
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  casinoEffectiveRtp, casinoTableRtp, casinoTables, casinoTablesIssue, casinoTargetRtp, CasinoDataError, createRng,
  DEFAULT_CASINO_TABLES, EQUIPMENT, EQUIPMENT_BY_ID, ITEMS, loadAdminWorld, placedItemIssue, playCasino, setCasinoTables,
  setItemOverrides, setShopOverrides, townShopStock, worldOverlay, highLowWinCount, slotLukParams,
  type CasinoGame, type CasinoTables,
} from '../index.js';

const SIM_N = process.env.SIM === '1' ? 1_000_000 : 100_000;
const BET = 50;

afterEach(() => { setCasinoTables(null); setItemOverrides(null); setShopOverrides(null); });

describe('目標の RTP (r2: 94% + min(luk,60)/60×3%)', () => {
  it('luk 0 → 94%、30 → 95.5%、60 以上 → 97% で止まる', () => {
    expect(casinoTargetRtp(0)).toBeCloseTo(0.94, 12);
    expect(casinoTargetRtp(30)).toBeCloseTo(0.955, 12);
    expect(casinoTargetRtp(60)).toBeCloseTo(0.97, 12);
    expect(casinoTargetRtp(200)).toBeCloseTo(0.97, 12);
    expect(casinoTargetRtp(-5)).toBeCloseTo(0.94, 12);
  });
});

describe('表から計算した RTP', () => {
  it('同梱の表: スロット 93.58%・ハイロー (有利なほう) 94.1%・レース (いちばん得な 1 頭) 94.0%', () => {
    const r = casinoTableRtp(DEFAULT_CASINO_TABLES);
    expect(r.slots).toBeCloseTo(0.935760498046875, 12);
    expect(r.highlow).toBeCloseTo(0.94118, 5);
    expect(r.race).toBeCloseTo(0.94, 12);
  });

  it('うんを入れた RTP は どのゲームも luk 0/30/60 で 94/95.5/97% ちょうど', () => {
    for (const g of ['slots', 'highlow', 'race'] as CasinoGame[]) {
      for (const [luk, want] of [[0, 0.94], [30, 0.955], [60, 0.97]] as const) {
        expect(casinoEffectiveRtp(DEFAULT_CASINO_TABLES, g, luk), `${g} luk${luk}`).toBeCloseTo(want, 12);
      }
    }
  });

  it('スロットの引き直しの確率は luk 0 で 0.8%・60 で 6.5% (100% には届かない)', () => {
    expect(slotLukParams(DEFAULT_CASINO_TABLES.slots.symbols, 0).respin).toBeCloseTo(0.00806, 4);
    expect(slotLukParams(DEFAULT_CASINO_TABLES.slots.symbols, 60).respin).toBeCloseTo(0.06509, 4);
    expect(slotLukParams(DEFAULT_CASINO_TABLES.slots.symbols, 60).scale).toBe(1);
  });

  it('85〜98% の外の表は保存できない', () => {
    const tooRich: CasinoTables = structuredClone(DEFAULT_CASINO_TABLES);
    tooRich.race.runners[0]!.odds = 260; // 40% × 2.6 = 104%
    expect(casinoTablesIssue(tooRich)).toMatch(/race の RTP 104\.0%/);
    expect(() => setCasinoTables(tooRich)).toThrow(CasinoDataError);
    expect(casinoTables().race.runners[0]!.odds).toBe(235); // 今の表を保つ
  });
});

/** n 回まわした RTP と、払い出しの標本標準偏差から求めた誤差 (4σ)。 */
function simulate(game: CasinoGame, luk: number, n: number, seed: number) {
  const rng = createRng(seed);
  let paid = 0;
  let sq = 0;
  let jackpots = 0;
  let negative = 0;
  for (let i = 0; i < n; i++) {
    let o;
    if (game === 'slots') o = playCasino('slots', BET, {}, luk, rng);
    else if (game === 'race') o = playCasino('race', BET, { runner: i % 5 }, luk, rng);
    else {
      const first = 1 + Math.floor(rng() * 13);
      const pick = highLowWinCount(first, 'high') >= highLowWinCount(first, 'low') ? 'high' : 'low';
      o = playCasino('highlow', BET, { first, pick }, luk, rng);
    }
    if (o.payout < 0) negative++;
    if (o.game === 'slots' && o.reels.every((r) => r === 'aozora')) jackpots++;
    const x = o.payout / BET;
    paid += x;
    sq += x * x;
  }
  const mean = paid / n;
  const sd = Math.sqrt(sq / n - mean * mean);
  return { rtp: mean, tol: (4 * sd) / Math.sqrt(n), jackpots, negative };
}

describe(`シミュレーション (${SIM_N} 回)`, () => {
  for (const luk of [0, 30, 60]) {
    it(`スロット luk ${luk}: 目標 ±4σ に入る・負の払い出しは無い`, () => {
      const s = simulate('slots', luk, SIM_N, 1000 + luk);
      expect(s.negative).toBe(0);
      expect(Math.abs(s.rtp - casinoTargetRtp(luk)), `rtp ${s.rtp} tol ${s.tol}`).toBeLessThan(s.tol);
    });
    it(`ハイロー luk ${luk} (有利なほう): 目標 ±4σ に入る`, () => {
      const s = simulate('highlow', luk, SIM_N, 2000 + luk);
      expect(s.negative).toBe(0);
      expect(Math.abs(s.rtp - casinoTargetRtp(luk)), `rtp ${s.rtp} tol ${s.tol}`).toBeLessThan(s.tol);
    });
    it(`レース luk ${luk} (5 ひきに順に賭ける): どの 1 頭も目標以下なので平均は目標以下`, () => {
      const s = simulate('race', luk, SIM_N, 3000 + luk);
      expect(s.negative).toBe(0);
      expect(s.rtp, `rtp ${s.rtp} tol ${s.tol}`).toBeLessThan(casinoTargetRtp(luk) + s.tol);
      expect(s.rtp).toBeGreaterThan(casinoTargetRtp(luk) - 0.03 - s.tol); // 最も損な 1 頭でも 3pt 以内
    });
  }

  it('大当たり (あおぞら 3 つ) の回数は 1/32768 の理論値に合う (引き直しのぶんを入れて ±4σ)', () => {
    const s = simulate('slots', 0, SIM_N, 4242);
    const p = 1 / 32768 + slotLukParams(DEFAULT_CASINO_TABLES.slots.symbols, 0).respin * (3 * (1 / 32) ** 2 * (11 / 32)) / 32;
    const mu = SIM_N * p;
    expect(Math.abs(s.jackpots - mu)).toBeLessThan(4 * Math.sqrt(mu) + 1);
  });
});

describe('playCasino の約束', () => {
  it('同じ seed なら同じ結果 (edge が rkey ごとに再現できる)', () => {
    expect(playCasino('slots', 10, {}, 30, createRng(7))).toEqual(playCasino('slots', 10, {}, 30, createRng(7)));
    expect(playCasino('race', 20, { runner: 2 }, 0, createRng(9))).toEqual(playCasino('race', 20, { runner: 2 }, 0, createRng(9)));
  });

  it('ハイロー: 同じ数字は負け・勝てる数字が無い選び方は断る', () => {
    const rng = () => 6 / 13 + 0.001; // 2 枚目 = 7
    expect(playCasino('highlow', 10, { first: 7, pick: 'high' }, 0, rng)).toMatchObject({ second: 7, win: false, payout: 0 });
    expect(() => playCasino('highlow', 10, { first: 13, pick: 'high' }, 0, Math.random)).toThrow('勝てる数字が無い');
  });

  it('不正な賭け・走者は断る', () => {
    expect(() => playCasino('slots', 0, {}, 0, Math.random)).toThrow('賭けが不正');
    expect(() => playCasino('race', 10, { runner: 5 }, 0, Math.random)).toThrow('走者が不正');
  });
});

describe('景品 (casinoOnly) は店と置きアイテムに出ない', () => {
  const prizeIds = DEFAULT_CASINO_TABLES.prizes.map((p) => p.id);

  it('景品の装備は r2 の値 (ほしのつるぎ atk18 luk4 空・ころも def20 luk3 空・ダイス luk16・チャーム luk6 agi2)', () => {
    expect(EQUIPMENT_BY_ID['wp-star-sword']).toMatchObject({ bonus: { atk: 18, luk: 4 }, element: 'void', casinoOnly: true });
    expect(EQUIPMENT_BY_ID['ar-star-robe']).toMatchObject({ bonus: { def: 20, luk: 3 }, element: 'void', casinoOnly: true });
    expect(EQUIPMENT_BY_ID['wp-star-dice']).toMatchObject({ kind: 'lucky', bonus: { luk: 16 }, casinoOnly: true });
    expect(EQUIPMENT_BY_ID['ch-lucky-charm']).toMatchObject({ slot: 'charm', bonus: { luk: 6, agi: 2 }, casinoOnly: true });
    expect(DEFAULT_CASINO_TABLES.prizes.map((p) => p.coins)).toEqual([20_000, 15_000, 12_000, 6_000, 1_000]); // + なまえのふだ (PR2)
  });

  it('どの街の生成の品ぞろえにも入らない', () => {
    worldOverlay().towns.forEach((t, i) => {
      for (const id of townShopStock(t, i).equipment) expect(prizeIds, `${t.name}`).not.toContain(id);
    });
  });

  it('店の上書きに書くと保存で弾く', () => {
    expect(() => setShopOverrides([{ x: 1, y: 1, equipment: ['wp-star-sword'] }])).toThrow(/カジノの景品は店に並べられない/);
  });

  it('置きアイテム (宝箱の装備) に書くと弾く', () => {
    expect(placedItemIssue({ id: 'c1', mapId: 'world', x: 1, y: 1, kind: 'chest', rewards: [{ equipment: 'wp-star-sword' }] })).toMatch(/カジノの景品は置けない/);
  });

  it('casinoOnly のどうぐは店 (shopTier) にも置きアイテムにも出せない', () => {
    const items = [...Object.entries(ITEMS).map(([id, v]) => ({ id, ...v })), { id: 'casino-token', name: 'ためしのふだ', casinoOnly: true }];
    setItemOverrides({ items, equipment: [...EQUIPMENT] });
    expect(() => setShopOverrides([{ x: 1, y: 1, consumables: ['casino-token'] }])).toThrow(/カジノの景品は店に並べられない/);
    expect(placedItemIssue({ id: 'c2', mapId: 'world', x: 1, y: 1, kind: 'chest', rewards: [{ item: 'casino-token', count: 1 }] })).toMatch(/カジノの景品は置けない/);
    expect(() => setItemOverrides({ items: [...items.slice(0, -1), { id: 'casino-token', name: 'x', casinoOnly: true, shopTier: 1 }], equipment: [...EQUIPMENT] })).toThrow(/price・shopTier/);
  });

  it('景品の一覧に casinoOnly でない品は入れられない', () => {
    const bad: CasinoTables = structuredClone(DEFAULT_CASINO_TABLES);
    bad.prizes.push({ kind: 'equipment', id: 'wp-knife', coins: 100 });
    expect(casinoTablesIssue(bad)).toMatch(/casinoOnly/);
  });
});

describe('world.casino の読み込み', () => {
  it('items の後・shops の前に読む。あれば適用、無ければ同梱のまま', async () => {
    const read: string[] = [];
    const rec = structuredClone(DEFAULT_CASINO_TABLES);
    rec.prizes[0]!.coins = 19_000;
    await loadAdminWorld(async (name) => { read.push(name); return name === 'casino' ? rec : null; }, () => {});
    expect(read.indexOf('casino')).toBe(read.indexOf('items') + 1);
    expect(read.indexOf('shops')).toBe(read.indexOf('casino') + 1);
    expect(casinoTables().prizes[0]!.coins).toBe(19_000);
  });
});
