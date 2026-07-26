import { describe, expect, it } from 'vitest';
import {
  MONSTERS,
  MAX_POPULATED_TIER,
  TINTABLE_SPECIES,
  DEMON_CASTLE_REGIONS,
  summonMonster,
  regionDanger,
  tierForDanger,
  tierForRegion,
  battleXpFor,
} from '../index.js';

/**
 * #536 で tier を 3 段階 → 8 段階に広げたときに実際に起きた事故を塞ぐ回帰テスト。
 * どれも「型は通る・既存テストも緑・でも遊ぶと壊れている」種類の穴だった。
 */
describe('モンスタープールの充足', () => {
  const REGIONS = Array.from({ length: 64 }, (_, i) => i);

  it('世界のどのリージョンに立っても、その tier に敵が居る', () => {
    // 空プールだと summonMonster が undefined を返し、edge の move が 500 になる。
    // 街のあるリージョンで起きると「その街から出られない」詰みになる。
    for (const region of REGIONS) {
      const tier = tierForRegion(region);
      const pool = MONSTERS.filter((m) => m.tier === tier);
      expect(pool.length, `region#${region} (tier${tier}) に敵が居ない`).toBeGreaterThan(0);
      expect(summonMonster(tier, 1, region * 7919 + 3), `region#${region} の召喚`).toBeDefined();
    }
  });

  it('遭遇に使われる tier は顔ぶれが 3 体以上ある', () => {
    // 1〜2 体だと「毎回まったく同じ敵しか出ない帯」になり、地域相性のヒント
    // (「○○が多い」) も常に同じ名前を指して導線として死ぬ。
    for (const region of REGIONS) {
      const tier = tierForRegion(region);
      expect(MONSTERS.filter((m) => m.tier === tier).length, `tier${tier}`).toBeGreaterThanOrEqual(3);
    }
  });

  it('MAX_POPULATED_TIER 以下の tier はすべて 3 体以上 (帯の途中に穴が無い)', () => {
    for (let t = 1; t <= MAX_POPULATED_TIER; t++) {
      expect(MONSTERS.filter((m) => m.tier === t).length, `tier${t}`).toBeGreaterThanOrEqual(3);
    }
  });

  it('tierForDanger は danger が 0..7 のどこでも安全な tier を返す', () => {
    // regionDanger の上限を広げたのに tierForDanger 側の clamp を直し忘れる、が事故の形。
    for (let d = 0; d <= 7; d++) {
      const tier = tierForDanger(d);
      expect(tier).toBeGreaterThanOrEqual(1);
      expect(tier).toBeLessThanOrEqual(MAX_POPULATED_TIER);
    }
    for (const region of REGIONS) expect(regionDanger(region)).toBeLessThanOrEqual(7);
  });

  it('魔王の城リージョンは、敵を置くまで通常の危険度どおりに扱う', () => {
    // 城が未実装のうちに tier7 を強制すると、そこに在る街 (おおたきの宿) から
    // 出られなくなる。実装したら「tier7 を返す」に反転させる。
    for (const region of DEMON_CASTLE_REGIONS) {
      expect(tierForRegion(region)).toBe(tierForDanger(regionDanger(region)));
    }
  });
});

describe('モンスターの見た目と数値の整合', () => {
  it('tint は絵に反映できる species にだけ付いている', () => {
    // 反映できない species に付けても黙って捨てられ、同じ tier に見分けの
    // つかない敵が並ぶ (いわのゴーレム / こけむしゴーレムが同一の絵だった)。
    for (const m of MONSTERS) {
      if (!m.tint) continue;
      expect(TINTABLE_SPECIES as readonly string[], `${m.name} (${m.species}) の tint`).toContain(m.species);
    }
  });

  it('同じ tier に「同じ species かつ同じ色」の敵が居ない', () => {
    const seen = new Map<string, string>();
    for (const m of MONSTERS) {
      const key = `${m.tier}/${m.species}/${m.tint ?? 'base'}`;
      expect(seen.get(key), `${m.name} と ${seen.get(key)} が同じ tier で同じ見た目`).toBeUndefined();
      seen.set(key, m.name);
    }
  });

  it('tier が上がるほど、獲得 XP の中央値も上がる', () => {
    const median = (xs: number[]) => xs.sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;
    const xpOf = (t: number) =>
      median(MONSTERS.filter((m) => m.tier === t && !m.flatDef).map((m) => battleXpFor(m.id)));
    for (let t = 2; t <= MAX_POPULATED_TIER; t++) {
      expect(xpOf(t), `tier${t} の XP が tier${t - 1} 以下`).toBeGreaterThan(xpOf(t - 1));
    }
  });

  it('想定プレイヤーレベル (level) は tier の帯の中に収まっている', () => {
    // level は「この敵に当たる頃のプレイヤー Lv」。tier の想定と食い違うと
    // 成長モデル (#518) の前提が崩れる。
    const bands: Record<number, [number, number]> = {
      1: [1, 3], 2: [4, 7], 3: [8, 12], 4: [13, 18], 5: [19, 25], 6: [26, 33], 7: [34, 41], 8: [42, 99],
    };
    for (const m of MONSTERS) {
      if (m.level === undefined) continue;
      const [lo, hi] = bands[m.tier]!;
      expect(m.level, `${m.name} (tier${m.tier}) の想定 Lv${m.level}`).toBeGreaterThanOrEqual(lo);
      expect(m.level, `${m.name} (tier${m.tier}) の想定 Lv${m.level}`).toBeLessThanOrEqual(hi);
    }
  });
});
