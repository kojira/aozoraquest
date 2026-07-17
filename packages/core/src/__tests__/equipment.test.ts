import { describe, expect, it } from 'vitest';
import {
  EQUIPMENT,
  EQUIPMENT_BY_ID,
  JOB_EQUIP_KINDS,
  canEquip,
  gearBonus,
  townShopStock,
} from '../equipment.js';
import { playerCombatant, playerStatsAt } from '../battle.js';
import { worldOverlay } from '../world.js';
import { JOBS } from '../jobs.js';

describe('EQUIPMENT 定義', () => {
  it('id が一意で、全 16 職に専用武器が中位・上位の 2 本ずつある', () => {
    const ids = EQUIPMENT.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const job of JOBS) {
      const own = EQUIPMENT.filter((e) => e.jobOnly === job.id);
      expect(own.length, job.id).toBe(2);
      expect(own.some((e) => e.grade === 2)).toBe(true);
      expect(own.some((e) => e.grade === 3)).toBe(true);
    }
  });

  it('名前が一意 (店の表示で紛れない)', () => {
    const names = EQUIPMENT.map((e) => e.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe('canEquip (装備適性)', () => {
  it('戦士は杖と運具以外ぜんぶ装備できる (MP が低い代わりの広適性)', () => {
    expect(canEquip('warrior', EQUIPMENT_BY_ID['wp-axe']!)).toBe(true);
    expect(canEquip('warrior', EQUIPMENT_BY_ID['wp-iron-shield']!)).toBe(true);
    expect(canEquip('warrior', EQUIPMENT_BY_ID['wp-swift-dagger']!)).toBe(true);
    expect(canEquip('warrior', EQUIPMENT_BY_ID['ar-iron']!)).toBe(true);
    expect(canEquip('warrior', EQUIPMENT_BY_ID['wp-novice-staff']!)).toBe(false);
    expect(canEquip('warrior', EQUIPMENT_BY_ID['wp-lucky-dice']!)).toBe(false);
  });

  it('ジョブ専用品は自ジョブのみ (遊び人は忍者刀を装備できない — オーナー指摘)', () => {
    expect(canEquip('ninja', EQUIPMENT_BY_ID['wp-ninja-mid']!)).toBe(true);
    expect(canEquip('performer', EQUIPMENT_BY_ID['wp-ninja-mid']!)).toBe(false);
    expect(canEquip('warrior', EQUIPMENT_BY_ID['wp-ninja-mid']!)).toBe(false);
  });

  it('専用品はカテゴリ不問 — 巫女は鈴カテゴリが無くても神楽鈴を装備できる (オーナー決定)', () => {
    const bell = EQUIPMENT_BY_ID['wp-miko-mid']!;
    expect(bell.name).toBe('神楽鈴');
    expect(canEquip('miko', bell)).toBe(true);
    // マトリクスに同 kind の適性が無い職でも jobOnly 一致なら OK という規則の裏
    expect(canEquip('sage', bell)).toBe(false);
  });

  it('共用 (common/cloth/charm) は全ジョブ装備できる', () => {
    for (const job of JOBS) {
      expect(canEquip(job.id, EQUIPMENT_BY_ID['wp-knife']!), job.id).toBe(true);
      expect(canEquip(job.id, EQUIPMENT_BY_ID['ar-cloth']!), job.id).toBe(true);
      expect(canEquip(job.id, EQUIPMENT_BY_ID['ch-traveler']!), job.id).toBe(true);
    }
  });

  it('カテゴリ制限つき装備は、少なくとも 1 職が装備できる (誰も使えない品を作らない)', () => {
    // 逆方向の検証: マトリクス側は将来カテゴリ (剣など) を先に持っていてよいが、
    // 実在する装備が孤児になってはいけない
    for (const e of EQUIPMENT) {
      const someone = JOBS.some((j) => canEquip(j.id, e));
      expect(someone, e.id).toBe(true);
    }
    void JOB_EQUIP_KINDS;
  });
});

describe('gearBonus', () => {
  it('装備の合計を返し、未知 id と装備不可の品は無視する', () => {
    const g = gearBonus('ninja', ['wp-ninja-mid', 'ar-nimble', 'ch-life', 'no-such-item', 'wp-axe']);
    // wp-axe は ninja 装備不可 → 無視。忍者刀 +8 agi、かるわざ +4 def +3 agi、ペンダント +10 maxHp
    expect(g.agi).toBe(11);
    expect(g.def).toBe(4);
    expect(g.maxHp).toBe(10);
    expect(g.atk).toBe(0);
  });
});

describe('playerCombatant / playerStatsAt の装備加算', () => {
  it('装備分が丸めの後に加算され、raw 導出と同期している', () => {
    const bare = playerCombatant('bard', 1, 1, 'x');
    const geared = playerCombatant('bard', 1, 1, 'x', undefined, ['wp-bard-mid', 'ch-life']);
    expect(geared.luk).toBe(bare.luk + 8); // 竪琴
    expect(geared.maxHp).toBe(bare.maxHp + 10);
    expect(geared.hp).toBe(geared.maxHp);
    const raw = playerStatsAt('bard', 1, 1, undefined, ['wp-bard-mid', 'ch-life']);
    expect(Math.round(raw.luk)).toBe(geared.luk);
    expect(Math.round(raw.maxHp)).toBe(geared.maxHp);
  });
});

describe('townShopStock (品揃えの決定的生成)', () => {
  const towns = worldOverlay().towns;

  it('決定的 (同じ街は同じ品揃え)', () => {
    const t = towns[0]!;
    expect(townShopStock(t, 0)).toEqual(townShopStock(t, 0));
  });

  it('全店に基本枠 (やくそう/そらのしずく/そらのはね) がある', () => {
    towns.forEach((t, i) => {
      const stock = townShopStock(t, i);
      expect(stock.consumables).toEqual(expect.arrayContaining(['herb', 'sky-dew', 'sky-feather']));
    });
  });

  it('全 16 職の専用品が世界のどこかの店に必ず並ぶ (巡回割当)', () => {
    const jobsSeen = new Set<string>();
    towns.forEach((t, i) => {
      for (const id of townShopStock(t, i).equipment) {
        const def = EQUIPMENT_BY_ID[id];
        if (def?.jobOnly) jobsSeen.add(def.jobOnly);
      }
    });
    for (const job of JOBS) expect(jobsSeen.has(job.id), job.id).toBe(true);
  });

  it('品揃えの id はすべて実在し、店ごとに重複しない', () => {
    towns.forEach((t, i) => {
      const { equipment } = townShopStock(t, i);
      expect(new Set(equipment).size).toBe(equipment.length);
      for (const id of equipment) expect(EQUIPMENT_BY_ID[id], id).toBeDefined();
    });
  });
});
