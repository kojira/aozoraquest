import { describe, expect, it } from 'vitest';
import {
  EQUIPMENT,
  EQUIPMENT_BY_ID,
  JOB_EQUIP_KINDS,
  canEquip,
  gearBonus,
  gearBonusFromGear,
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
    expect(canEquip('warrior', EQUIPMENT_BY_ID['ar-scholar']!)).toBe(false); // ローブも不可
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

describe('gearBonusFromGear (スロット検証つき入口)', () => {
  it('スロットと slot が一致する品だけ数える (weapon 枠に武器以外・重複強化を弾く)', () => {
    // 正常系
    const ok = gearBonusFromGear('bard', { weapon: 'wp-bard-mid', armor: 'ar-fortune', charm: 'ch-life' });
    expect(ok.luk).toBe(8 + 3);
    expect(ok.maxHp).toBe(10);
    // weapon 枠に charm を書いても効かない / 3 枠同一武器の重複強化も不成立
    const cheat = gearBonusFromGear('bard', { weapon: 'ch-life', armor: 'wp-bard-high', charm: 'wp-bard-high' });
    expect(cheat.luk).toBe(0);
    expect(cheat.maxHp).toBe(0);
  });
});

describe('専用装備の弱点補完 (将軍)', () => {
  it('将軍の専用品は耐久複合で、フル装備の tier3 勝率が band に入る (≥55%)', async () => {
    const { BATTLE_TUNING, resolveTurn, startBattle } = await import('../battle.js');
    const gear = EQUIPMENT_BY_ID['wp-shogun-high']!;
    expect(gear.bonus.def ?? 0).toBeGreaterThan(0);
    expect(gear.bonus.maxHp ?? 0).toBeGreaterThan(0);
    let wins = 0;
    for (let seed = 0; seed < 300; seed++) {
      let s = startBattle('shogun', 8, 15, 'x', 3, seed, BATTLE_TUNING.herbCarryMax, undefined, {
        equipIds: ['wp-shogun-high', 'ar-iron', 'ch-life'],
      });
      for (let i = 0; i < 60 && s.outcome === 'ongoing'; i++) {
        const p = s.player;
        const cmd = s.monster.charging
          ? 'guard'
          : s.herbs > 0 && p.hp < p.maxHp * 0.45
            ? 'herb'
            : p.mp >= BATTLE_TUNING.skillMpCost
              ? 'skill'
              : 'attack';
        s = resolveTurn(s, cmd);
      }
      if (s.outcome === 'win') wins++;
    }
    // 実測 65% (300 seed)。素の 45% (atk 単盛り) への回帰を検知する下限
    expect(wins / 3).toBeGreaterThanOrEqual(55);
  });
});

describe('制作の強化値 (craftLevelRoll / bonusWithLevel / 合成)', () => {
  it('決定的で、制作ロールは −1〜+5 に収まる (+6 以上は制作では出ない)', async () => {
    const { craftLevelRoll, craftSeedFromRkey, CRAFT_TUNING } = await import('../equipment.js');
    const seed = craftSeedFromRkey('c-abc123');
    expect(craftLevelRoll(seed, 20)).toBe(craftLevelRoll(seed, 20));
    for (let i = 0; i < 1000; i++) {
      const lv = craftLevelRoll(i, 10);
      expect(lv).toBeGreaterThanOrEqual(CRAFT_TUNING.craftMin);
      expect(lv).toBeLessThanOrEqual(CRAFT_TUNING.craftMax);
    }
  });

  it('luk が下限を引き上げる (luk 20 で失敗作 −1 が出なくなる。統計でも平均上昇)', async () => {
    const { craftLevelRoll } = await import('../equipment.js');
    let low = 0;
    let high = 0;
    let minHigh = 10;
    for (let seed = 0; seed < 1000; seed++) {
      low += craftLevelRoll(seed, 0);
      const lv = craftLevelRoll(seed, 40);
      high += lv;
      minHigh = Math.min(minHigh, lv);
    }
    expect(high / 1000).toBeGreaterThan(low / 1000);
    expect(minHigh).toBeGreaterThanOrEqual(2); // luk40 → floor(40×0.05)=2
    // luk 20 → floor 1 なので −1/0 は出ない
    for (let seed = 0; seed < 300; seed++) {
      expect(craftLevelRoll(seed, 20)).toBeGreaterThanOrEqual(1);
    }
  });

  it('強化値は主効果に加算され (「ナイフ+3」)、−1 でも 1 未満に潰れない', async () => {
    const { bonusWithLevel, leveledName, EQUIPMENT_BY_ID: BY_ID } = await import('../equipment.js');
    const harp = BY_ID['wp-bard-mid']!; // luk +8
    expect(bonusWithLevel(harp, 3).luk).toBe(11);
    expect(bonusWithLevel(harp, -1).luk).toBe(7);
    expect(bonusWithLevel(harp, 0)).toEqual(harp.bonus);
    const knife = BY_ID['wp-knife']!; // atk +2
    expect(bonusWithLevel(knife, -1).atk).toBe(1);
    // 複合効果 (将軍の大太刀) は主効果 (maxHp 14) だけが伸びる
    const taito = BY_ID['wp-shogun-high']!;
    const b = bonusWithLevel(taito, 4);
    expect(b.maxHp).toBe(18);
    expect(b.atk).toBe(taito.bonus.atk);
    expect(leveledName(harp, 3)).toBe('竪琴+3');
    expect(leveledName(harp, -1)).toBe('竪琴-1');
    expect(leveledName(harp, 0)).toBe('竪琴');
  });

  it('合成: +1 ずつ、上限 +10。gearBonusFromGear は強化値つき個体を受ける', async () => {
    const { canForge, forgedLevel, CRAFT_TUNING } = await import('../equipment.js');
    expect(forgedLevel(5)).toBe(6);
    expect(forgedLevel(9)).toBe(10);
    expect(canForge(10)).toBe(false);
    expect(CRAFT_TUNING.levelMax).toBe(10);
    const g = gearBonusFromGear('bard', { weapon: { id: 'wp-bard-mid', level: 10 } });
    expect(g.luk).toBe(18); // 8 + 10
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

  it('全 16 職の専用品 (中位・上位とも) が世界のどこかの店に必ず並ぶ (巡回割当)', () => {
    // 初版は上位がハッシュ乱択で sage/mage/guardian が全店欠品した (レビュー実測)。
    // 中位・上位を別々にピンして再発を検知する
    const midSeen = new Set<string>();
    const highSeen = new Set<string>();
    towns.forEach((t, i) => {
      for (const id of townShopStock(t, i).equipment) {
        const def = EQUIPMENT_BY_ID[id];
        if (!def?.jobOnly) continue;
        (def.grade === 2 ? midSeen : highSeen).add(def.jobOnly);
      }
    });
    for (const job of JOBS) {
      expect(midSeen.has(job.id), `mid:${job.id}`).toBe(true);
      expect(highSeen.has(job.id), `high:${job.id}`).toBe(true);
    }
  });

  it('店の素材種は決定的で、実在の素材 id を返す', () => {
    towns.forEach((t, i) => {
      const stock = townShopStock(t, i);
      expect(typeof stock.materialId).toBe('string');
      expect(stock.materialId.length).toBeGreaterThan(0);
      expect(townShopStock(t, i).materialId).toBe(stock.materialId);
    });
  });

  it('品揃えの id はすべて実在し、店ごとに重複しない', () => {
    towns.forEach((t, i) => {
      const { equipment } = townShopStock(t, i);
      expect(new Set(equipment).size).toBe(equipment.length);
      for (const id of equipment) expect(EQUIPMENT_BY_ID[id], id).toBeDefined();
    });
  });
});
