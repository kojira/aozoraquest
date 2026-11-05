/**
 * カジノの edge 権威 (D-CASINO-001 PR2)。
 * 二重払いしない・コイン不足・1 分 7 回目は 429 (10 回まとめは 1 回)・カジノの外は断る・コイン→パワーは無い・
 * 毎日のコインは投稿した日だけ・途中のハイローは止めない・景品・なまえのふだ。
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { BASE_PALETTE, ITEMS, rollDefeatLoss, setInteriors, setStory, worldOverlay, type InteriorMap } from '@aozoraquest/core';
import { casinoBonus, casinoExchange, casinoPlay, casinoPrize, CASINO_RATE_PER_MINUTE, type CasinoPos } from '../src/casino';
import { handlePartyRename } from '../src/party-rename';
import { handlePartySet } from '../src/party-route';
import { handleCasinoRoute } from '../src/casino-route';
import { dayKey } from '../src/xp-claim';
import { GS, guildRoom, makeEnv, near, NOW, pds, RECEPTION, USER } from './support/party-env';
import { setNpcs } from '@aozoraquest/core';

const F = BASE_PALETTE.indexOf('plains');
const town = () => worldOverlay().towns[0]!;
const casinoRoom = (): InteriorMap => ({
  id: 'casino', name: 'カジノ', size: 8, tiles: new Uint8Array(64).fill(F),
  casino: { town: { x: town().x, y: town().y }, exchange: { x: 1, y: 1 }, prize: { x: 2, y: 1 }, games: [{ x: 1, y: 3, game: 'slots' }, { x: 2, y: 3, game: 'highlow' }, { x: 3, y: 3, game: 'race' }] },
});
const AT = {
  exchange: { mapId: 'casino', x: 1, y: 1 }, prize: { mapId: 'casino', x: 2, y: 1 },
  slots: { mapId: 'casino', x: 1, y: 3 }, highlow: { mapId: 'casino', x: 2, y: 3 }, race: { mapId: 'casino', x: 3, y: 3 },
} satisfies Record<string, CasinoPos>;

async function setup(over: Parameters<typeof GS>[0] = {}) {
  const env = await makeEnv();
  const m = pds(GS(over));
  globalThis.fetch = m.fn;
  return { env, m };
}
const play = (env: Awaited<ReturnType<typeof makeEnv>>, rkey: string, input: Partial<Parameters<typeof casinoPlay>[2]> = {}, now = NOW) =>
  casinoPlay(env, USER, { game: 'slots', bet: 10, rkey, pos: AT.slots, luk: 0, seed: 1, ...input }, now);

describe('カジノ (D-CASINO-001)', () => {
  const orig = globalThis.fetch;
  beforeAll(() => {
    setInteriors([casinoRoom(), guildRoom()], []);
    setNpcs([RECEPTION]);
    setStory({ battles: [], recruits: [{ id: 'r-1', name: 'カイト', archetype: 'warrior', guild: 'g-bluesky', line: 'よろしく。' }] });
  });
  afterAll(() => { setInteriors(null, null); setNpcs(null); setStory(null); });
  afterEach(() => { globalThis.fetch = orig; });

  describe('両替', () => {
    it('10 パワー → 100 コイン。同じ rkey をもう一度送っても 1 回分しか払わない', async () => {
      const { env, m } = await setup({ power: 30 });
      const a = await casinoExchange(env, USER, { power: 10, rkey: 'x1', pos: AT.exchange }, NOW);
      const b = await casinoExchange(env, USER, { power: 10, rkey: 'x1', pos: AT.exchange }, NOW);
      expect(a).toMatchObject({ coins: 100, power: 20 });
      expect(b).toMatchObject({ coins: 100, duplicate: true });
      expect(m.gs()).toMatchObject({ power: 20, casinoCoins: 100 });
    });

    it('パワーが足りない・決まった額でない・両替のマスでないと断る', async () => {
      const { env } = await setup({ power: 5 });
      await expect(casinoExchange(env, USER, { power: 10, rkey: 'x2', pos: AT.exchange }, NOW)).rejects.toMatchObject({ code: 'no_power' });
      await expect(casinoExchange(env, USER, { power: 3, rkey: 'x3', pos: AT.exchange }, NOW)).rejects.toMatchObject({ code: 'bad_request' });
      await expect(casinoExchange(env, USER, { power: 1, rkey: 'x4', pos: AT.prize }, NOW)).rejects.toMatchObject({ code: 'not_at_casino' });
      await expect(casinoExchange(env, USER, { power: 1, rkey: 'x5', pos: { x: town().x, y: town().y } }, NOW)).rejects.toMatchObject({ code: 'not_at_casino' });
    });

    it('コイン → パワーの道は無い (/api/casino/* に それらしい道が無く、未知の道は null)', async () => {
      const env = await makeEnv();
      for (const path of ['/api/casino/sell', '/api/casino/withdraw', '/api/casino/redeem', '/api/casino/power']) {
        const req = new Request(`https://edge.example${path}`, { method: 'POST', headers: { authorization: 'Bearer x' } });
        expect(await handleCasinoRoute(req, new URL(req.url), env, NOW, 'app.aozoraquest', () => new Response(), () => new Response())).toBeNull();
      }
    });
  });

  describe('毎日のコイン', () => {
    it('投稿していない日 (claimDay が今日でない) は出ない', async () => {
      const { env } = await setup({ claimDay: dayKey(NOW - 86400) });
      await expect(casinoBonus(env, USER, { rkey: 'b1', pos: AT.exchange }, NOW)).rejects.toMatchObject({ code: 'no_post_today' });
    });
    it('投稿した日は 50 コイン、1 日 1 回', async () => {
      const { env, m } = await setup({ claimDay: dayKey(NOW) });
      expect(await casinoBonus(env, USER, { rkey: 'b2', pos: AT.exchange }, NOW)).toMatchObject({ coins: 50 });
      await expect(casinoBonus(env, USER, { rkey: 'b3', pos: AT.exchange }, NOW)).rejects.toMatchObject({ code: 'bonus_taken' });
      expect(m.gs().casinoBonusDay).toBe(dayKey(NOW));
    });
  });

  describe('遊ぶ', () => {
    it('コインが足りないと断る・台のマスでないと断る', async () => {
      const { env } = await setup({ casinoCoins: 5 });
      await expect(play(env, 'p1')).rejects.toMatchObject({ code: 'no_coins' });
      await expect(play(env, 'p2', { pos: AT.race })).rejects.toMatchObject({ code: 'not_at_casino' });
      await expect(play(env, 'p3', { bet: 15 })).rejects.toMatchObject({ code: 'bad_request' });
    });

    it('同じ rkey の再送は同じ結果を返し、二度払わせない', async () => {
      const { env, m } = await setup({ casinoCoins: 100 });
      const a = await play(env, 'p4', { seed: 42 });
      const b = await play(env, 'p4', { seed: 999 });
      expect(b.outcomes).toEqual(a.outcomes);
      expect(b.duplicate).toBe(true);
      expect(m.gs().casinoCoins).toBe(a.coins);
      expect(m.gs().casinoCoins).toBe(100 - 10 + a.outcomes![0]!.payout);
    });

    it('1 分に 7 回目は 429。10 回まとめて回すのは 1 回と数える。次の分なら また遊べる', async () => {
      const { env, m } = await setup({ casinoCoins: 5000 });
      const r = await play(env, 'batch', { choice: { times: 10 } });
      expect(r.outcomes).toHaveLength(10);
      for (let i = 1; i < CASINO_RATE_PER_MINUTE; i++) await play(env, `r${i}`);
      expect(m.gs().casinoRate?.perMinute).toBe(6);
      await expect(play(env, 'r7')).rejects.toMatchObject({ status: 429, code: 'rate_minute' });
      expect((await play(env, 'r8', {}, NOW + 60)).outcomes).toHaveLength(1);
    });

    it('1 日 150 回で 429 (rate_day)', async () => {
      const { env } = await setup({ casinoCoins: 5000, casinoRate: { minute: 0, perMinute: 0, day: dayKey(NOW), perDay: 150 } });
      await expect(play(env, 'd1')).rejects.toMatchObject({ status: 429, code: 'rate_day' });
    });

    it('ハイロー: 配る → 当たり → やめる。途中の 上か下か・やめる は回数の上限でも止めない', async () => {
      const { env, m } = await setup({ casinoCoins: 100 });
      const dealt = await casinoPlay(env, USER, { game: 'highlow', bet: 10, rkey: 'h1', pos: AT.highlow, luk: 0, seed: 7 }, NOW);
      const first = dealt.highlow!.first;
      expect(m.gs().casinoCoins).toBe(90);
      // 上限まで使い切った状態にする
      const gs = m.gs();
      gs.casinoRate = { minute: Math.floor(NOW / 60), perMinute: 6, day: dayKey(NOW), perDay: 6 };
      const pick = first <= 7 ? 'high' : 'low';
      // seed を探して勝つ手にする
      let seed = 0, res;
      for (; seed < 200; seed++) {
        res = await casinoPlay(env, USER, { game: 'highlow', choice: { pick }, rkey: `h2-${seed}`, pos: AT.highlow, luk: 0, seed }, NOW).catch((e) => e);
        if (res?.highlow) break;
        if (res?.outcomes) { // 負け: もう一度配りなおして続ける
          m.gs().casinoHL = { first, stake: 10, step: 0 };
        }
      }
      expect(res.highlow).toMatchObject({ step: 1, canContinue: true });
      const stake = res.highlow.stake;
      const before = m.gs().casinoCoins!;
      const out = await casinoPlay(env, USER, { game: 'highlow', choice: { cashout: true }, rkey: 'h3', pos: AT.highlow, luk: 0, seed: 1 }, NOW);
      expect(out.cashout).toBe(stake);
      expect(m.gs().casinoCoins).toBe(before + stake);
      expect(m.gs().casinoHL).toBeUndefined();
      // 新しく配るのは止まる
      await expect(casinoPlay(env, USER, { game: 'highlow', bet: 10, rkey: 'h4', pos: AT.highlow, luk: 0, seed: 1 }, NOW)).rejects.toMatchObject({ status: 429 });
    });

    it('ハイロー: 当たりのまま次を配ると、途中の賭けを先に払い出す (消えない)', async () => {
      const { env, m } = await setup({ casinoCoins: 100, casinoHL: { first: 5, stake: 40, step: 2 } });
      const r = await casinoPlay(env, USER, { game: 'highlow', bet: 10, rkey: 'h5', pos: AT.highlow, luk: 0, seed: 3 }, NOW);
      expect(r.cashout).toBe(40);
      expect(m.gs().casinoCoins).toBe(130);
      expect(m.gs().casinoHL).toMatchObject({ stake: 10, step: 0 });
    });

    it('レース: 顔ぶれを返し、払い出しは賭けを含む', async () => {
      const { env, m } = await setup({ casinoCoins: 100 });
      const r = await casinoPlay(env, USER, { game: 'race', bet: 20, choice: { runner: 0 }, rkey: 'rc1', pos: AT.race, luk: 0, seed: 5 }, NOW);
      expect(r.race!.runners).toHaveLength(5);
      expect(m.gs().casinoCoins).toBe(80 + r.outcomes![0]!.payout);
    });
  });

  describe('景品', () => {
    it('装備は pieces に、コインが足りないと断る', async () => {
      const { env, m } = await setup({ casinoCoins: 20_000 });
      const r = await casinoPrize(env, USER, { prizeId: 'wp-star-sword', rkey: 'z1', pos: AT.prize }, NOW);
      expect(r.coins).toBe(0);
      expect(m.gs().pieces).toEqual([{ rkey: 'z1', itemId: 'wp-star-sword', level: 0 }]);
      await expect(casinoPrize(env, USER, { prizeId: 'name-tag', rkey: 'z2', pos: AT.prize }, NOW)).rejects.toMatchObject({ code: 'no_coins' });
      await expect(casinoPrize(env, USER, { prizeId: 'wp-knife', rkey: 'z3', pos: AT.prize }, NOW)).rejects.toMatchObject({ code: 'unknown_prize' });
    });
    it('なまえのふだ は materials に。負けても失わない', async () => {
      const { env, m } = await setup({ casinoCoins: 1000 });
      await casinoPrize(env, USER, { prizeId: 'name-tag', rkey: 'z4', pos: AT.prize }, NOW);
      expect(m.gs().materials['name-tag']).toBe(1);
      expect(ITEMS['name-tag']?.casinoOnly).toBe(true);
      for (let s = 0; s < 50; s++) expect(rollDefeatLoss({ 'name-tag': 1, herb: 0 }, 0, s)).toEqual([]);
    });
  });

  describe('なまえのふだ', () => {
    const party = { ids: ['r-1'] };
    it('名前を変えると ふだが 1 枚へる。同じ rkey の 2 回目は何もしない', async () => {
      const { env, m } = await setup({ materials: { 'name-tag': 2 }, party });
      await handlePartyRename(env, USER, 'r-1', '  ソラ  ', 'n1', NOW, 'app.aozoraquest');
      await handlePartyRename(env, USER, 'r-1', 'ソラ', 'n1', NOW, 'app.aozoraquest');
      expect(m.gs().party!.names).toEqual({ 'r-1': 'ソラ' });
      expect(m.gs().materials['name-tag']).toBe(1);
    });
    it('長すぎる・空・{c: ・今と同じ・ふだ無しは断り、ふだは へらない', async () => {
      const { env, m } = await setup({ materials: { 'name-tag': 1 }, party });
      for (const [name, code] of [['12345678901', 'bad_name'], ['  ', 'bad_name'], ['{c:x}', 'bad_name'], ['カイト', 'bad_name'], ['a\nb', 'bad_name']] as const) {
        await expect(handlePartyRename(env, USER, 'r-1', name, `n-${name}`, NOW, 'app.aozoraquest')).rejects.toMatchObject({ code });
      }
      expect(m.gs().materials['name-tag']).toBe(1);
      const none = await setup({ party });
      await expect(handlePartyRename(none.env, USER, 'r-1', 'ソラ', 'n9', NOW, 'app.aozoraquest')).rejects.toMatchObject({ code: 'no_name_tag' });
    });
    it('仲間をはずすと名前も消える', async () => {
      const { env, m } = await setup({ flags: ['futaba_letter_done'], party: { ids: ['r-1'], names: { 'r-1': 'ソラ' } } });
      await handlePartySet(env, USER, 'g-bluesky', [], near(env), NOW);
      expect(m.gs().party?.names).toBeUndefined();
    });
  });
});

describe('せいなるみず (ふっかつのはね の代わり。D-CASINO-001 PR4)', () => {
  it('景品の一覧に 800 枚で並び、戦闘で使える・店には出ない・負けても失わない', async () => {
    const { casinoTables, isBattleItem, rollDefeatLoss: loss } = await import('@aozoraquest/core');
    expect(casinoTables().prizes.find((p) => p.id === 'holy-water')).toMatchObject({ kind: 'item', coins: 800 });
    expect(isBattleItem('holy-water')).toBe(true);
    expect(loss({ 'holy-water': 3 }, 0, 1)).toEqual([]);
  });
});
