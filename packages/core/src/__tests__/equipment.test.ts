import { describe, expect, it } from 'vitest';
import { isSellableMaterial,
  EQUIPMENT,
  EQUIPMENT_BY_ID,
  JOB_EQUIP_KINDS,
  canEquip,
  gearBonus,
  gearBonusFromGear,
  townShopStock,
  shopMaterialBand,
  maxShopGradeForTier,
  JOB_HIGH_PER_TOWN,
} from '../equipment.js';
import { playerCombatant, playerStatsAt } from '../battle.js';
import { worldOverlay, tierForRegion } from '../world.js';
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

  it('ジョブ専用品は自ジョブのみ (遊び人は忍者刀を装備できない)', () => {
    expect(canEquip('ninja', EQUIPMENT_BY_ID['wp-ninja-mid']!)).toBe(true);
    expect(canEquip('performer', EQUIPMENT_BY_ID['wp-ninja-mid']!)).toBe(false);
    expect(canEquip('warrior', EQUIPMENT_BY_ID['wp-ninja-mid']!)).toBe(false);
  });

  it('専用品はカテゴリ不問 — 巫女は鈴カテゴリが無くても神楽鈴を装備できる', () => {
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
    // wp-axe は ninja 装備不可 → 無視。忍者刀 +8 agi、かるわざの衣 +15 def +3 agi、ペンダント +3 maxHp
    // (#518 で防具の def を grade1 +5 / grade2 +15 / grade3 +35 に引き上げ = 守備は防具が主役)
    expect(g.agi).toBe(11);
    expect(g.def).toBe(15);
    expect(g.maxHp).toBe(3);
    expect(g.atk).toBe(0);
  });
});

describe('playerCombatant / playerStatsAt の装備加算', () => {
  it('装備分が丸めの後に加算され、raw 導出と同期している', () => {
    const bare = playerCombatant('bard', 1, 1, 'x');
    const geared = playerCombatant('bard', 1, 1, 'x', undefined, ['wp-bard-mid', 'ch-life']);
    expect(geared.luk).toBe(bare.luk + 8); // 竪琴
    expect(geared.maxHp).toBe(bare.maxHp + 3);
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
    expect(ok.maxHp).toBe(3);
    // weapon 枠に charm を書いても効かない / 3 枠同一武器の重複強化も不成立
    const cheat = gearBonusFromGear('bard', { weapon: 'ch-life', armor: 'wp-bard-high', charm: 'wp-bard-high' });
    expect(cheat.luk).toBe(0);
    expect(cheat.maxHp).toBe(0);
  });
});

describe('装備ボーナスの二重加算防止 (#511)', () => {
  it('equipIds と gear を両方渡しても二重加算されない (gear 優先)', () => {
    const armor = EQUIPMENT.find((e) => e.slot === 'armor' && (e.bonus.def ?? 0) > 0)!;
    const none = playerCombatant('sage', 1, 1, 'x');
    const viaIds = playerCombatant('sage', 1, 1, 'x', undefined, [armor.id]);
    const viaGear = playerCombatant('sage', 1, 1, 'x', undefined, undefined, { armor: armor.id });
    const both = playerCombatant('sage', 1, 1, 'x', undefined, [armor.id], { armor: armor.id });
    expect(viaIds.def).toBeGreaterThan(none.def); // 単独ならボーナスが乗る
    expect(viaGear.def).toBeGreaterThan(none.def);
    // 両方渡しても gear のみと同値 (旧実装は a+b で二重に加算していた: def 15→17→19)
    expect(both.def).toBe(viaGear.def);
    expect(both.maxHp).toBe(viaGear.maxHp);
    // 空の gear ({}) では equipIds が活きる (空判定を対称にしないと装備が黙って消える)
    const emptyGear = playerCombatant('sage', 1, 1, 'x', undefined, [armor.id], {});
    expect(emptyGear.def).toBe(viaIds.def);
    // playerStatsAt (丸め前) も同じ規則で解決する
    const bothRaw = playerStatsAt('sage', 1, 1, undefined, [armor.id], { armor: armor.id });
    const gearRaw = playerStatsAt('sage', 1, 1, undefined, undefined, { armor: armor.id });
    const idsRaw = playerStatsAt('sage', 1, 1, undefined, [armor.id]);
    expect(bothRaw.def).toBe(gearRaw.def); // 同一経路なので厳密一致 (toBeCloseTo だと微差を見逃す)
    expect(bothRaw.maxHp).toBe(gearRaw.maxHp);
    // 空 gear では equipIds が活きる (playerCombatant と同じ規則であることを raw 側でも固定)
    const emptyRaw = playerStatsAt('sage', 1, 1, undefined, [armor.id], {});
    expect(emptyRaw.def).toBe(idsRaw.def);
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
      let s = startBattle('shogun', 15, 1, 'x', 5, seed, BATTLE_TUNING.herbCarryMax, undefined, {
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
    // #507 でジョブ Lv 基準に貼り直し (jobLv15)。実測 **装備なし 15% → フル装備 67%** =
    // 専用品 (def+maxHp 複合) の効果が明確。素の atk 単盛りへの回帰を検知する下限
    expect(wins / 3).toBeGreaterThanOrEqual(55);
  });
});

describe('素材のひきとり (SALE_TUNING)', () => {
  it('ひきとり対象は MONSTERS の素材ドロップと同期している (消耗品は対象外)', async () => {
    const { MONSTERS } = await import('../battle.js');
    const { SELLABLE_MATERIALS, isSellableMaterial } = await import('../equipment.js');
    const { CONSUMABLE_ITEMS } = await import('../equipment.js');
    const consumables = new Set(CONSUMABLE_ITEMS);
    const dropIds = new Set<string>();
    for (const m of MONSTERS) for (const d of m.drops) if (!consumables.has(d.item)) dropIds.add(d.item);
    expect([...dropIds].sort()).toEqual([...SELLABLE_MATERIALS].sort());
    expect(isSellableMaterial('herb')).toBe(false);
    expect(isSellableMaterial('slime-drop')).toBe(true);
  });

  it('レートは戦闘→換金ループが赤字になる水準 (cap 基準の最悪値で仮定フリー)', async () => {
    const { MONSTERS } = await import('../battle.js');
    const { CONSUMABLE_ITEMS, SALE_TUNING, salePowerFor } = await import('../equipment.js');
    // 各売却可能ドロップの率を cap 0.95 とみなす最悪値 (luk 仮定なし) でも
    // 1 戦のパワー 1 を回収できないことを固定
    let worst = 0;
    const consumables = new Set(CONSUMABLE_ITEMS);
    for (const m of MONSTERS) {
      let ev = 0;
      for (const d of m.drops) if (!consumables.has(d.item)) ev += 0.95;
      worst = Math.max(worst, ev);
    }
    expect(worst / SALE_TUNING.materialsPerPower).toBeLessThan(1);
    expect(salePowerFor(4)).toBe(0);
    expect(salePowerFor(5)).toBe(1);
    expect(salePowerFor(12)).toBe(2);
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
    // 複合効果 (軍神の大太刀 atk10/def7/maxHp4) は主効果 (最大値の atk) だけが伸びる。
    // DQ 級スケールで maxHp を 14→4 に縮めたため、primary は maxHp から atk に移った。
    const taito = BY_ID['wp-shogun-high']!;
    const b = bonusWithLevel(taito, 4);
    expect(b.atk).toBe(taito.bonus.atk! + 4); // 主効果 atk が +4
    expect(b.maxHp).toBe(taito.bonus.maxHp); // 副効果 maxHp は据え置き (4)
    expect(leveledName(harp, 3)).toBe('竪琴+3');
    expect(leveledName(harp, -1)).toBe('竪琴-1');
    expect(leveledName(harp, 0)).toBe('竪琴');
  });

  it('signed / bonusText: 負の補正が「+-2」にならず、0 の項目は出ない', async () => {
    const { signed, bonusText, BONUS_STAT_LABELS } = await import('../equipment.js');
    expect(signed(12)).toBe('+12');
    expect(signed(-2)).toBe('-2');
    expect(signed(0)).toBe('0');
    // 表示順は BONUS_STAT_LABELS の並び (定義側のキー順に依存しない)
    expect(bonusText({ agi: -2, atk: 12 })).toBe('こうげき +12 すばやさ -2');
    expect(bonusText({ atk: 0, def: 3, maxHp: -1 })).toBe('まもり +3 さいだいHP -1');
    expect(bonusText({})).toBe('');
    // 装備込み合計 (gearBonusFromGear の全キー入り) もそのまま通る
    expect(bonusText({ atk: 0, def: 0, agi: 0, int: 0, luk: 0, maxHp: 0 })).toBe('');
    expect(Object.keys(BONUS_STAT_LABELS)).toEqual(['atk', 'def', 'agi', 'int', 'luk', 'maxHp']);
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

describe('playerCombatant の gear (GearSelection) 適用', () => {
  it('強化値つき個体のボーナスが乗り、raw 導出と同期する', async () => {
    const { playerStatsAt: raw } = await import('../battle.js');
    const bare = playerCombatant('bard', 1, 1, 'x');
    const geared = playerCombatant('bard', 1, 1, 'x', undefined, undefined, {
      weapon: { id: 'wp-bard-mid', level: 3 }, // 竪琴+3 = luk 8+3
      charm: { id: 'ch-life', level: 0 },
    });
    expect(geared.luk).toBe(bare.luk + 11);
    expect(geared.maxHp).toBe(bare.maxHp + 3);
    const r = raw('bard', 1, 1, undefined, undefined, {
      weapon: { id: 'wp-bard-mid', level: 3 },
      charm: { id: 'ch-life', level: 0 },
    });
    expect(Math.round(r.luk)).toBe(geared.luk);
    expect(Math.round(r.maxHp)).toBe(geared.maxHp);
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

  it('店の素材種は決定的で、その街の危険度で狩れるモンスターの素材 (地元で稼げる)', async () => {
    const { MONSTERS } = await import('../battle.js');
    const { regionDanger, tierForRegion } = await import('../world.js');
    // tier → その tier のモンスターがドロップする素材集合
    // 店の素材は tier を 3 帯に丸めて引く (#536 で tier が 6 段階になった)。
    // 期待値も同じ帯で作る = 「その帯の敵が落とす素材か」を検証する。
    // 帯の定義は equipment.ts の `shopMaterialBand` が単一の正。ここで同じ式を書くと
    // 敵の tier を動かしたときに片方だけ直して事故る (#536 で実際に起きた)。
    const dropsOfBand = (tier: number) => {
      const band = shopMaterialBand(tier);
      const set = new Set<string>();
      for (const m of MONSTERS) if (shopMaterialBand(m.tier) === band) for (const d of m.drops) set.add(d.item);
      return set;
    };
    towns.forEach((t, i) => {
      const stock = townShopStock(t, i);
      expect(townShopStock(t, i).materialId).toBe(stock.materialId); // 決定的
      const danger = regionDanger(t.region);
      const tier = tierForRegion(t.region); // 店も遭遇も tierForRegion が単一の正
      expect(dropsOfBand(tier).has(stock.materialId), `${t.name} (danger${danger}) → ${stock.materialId}`).toBe(true);
      // 消耗品 (やくそう等) が値札に混入する回帰も塞ぐ — ドロップには含まれるため上の検証だけでは通ってしまう
      expect(isSellableMaterial(stock.materialId), `${t.name} → ${stock.materialId} はひきとり可能素材ではない`).toBe(true);
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

describe('装備の段階を地域の危険度で区切る (#565)', () => {
  const towns = worldOverlay().towns;
  const stocks = towns.map((t, i) => ({ t, tier: tierForRegion(t.region), stock: townShopStock(t, i) }));
  const gradeOf = (id: string) => EQUIPMENT_BY_ID[id]?.grade ?? 0;

  it('その帯より上の grade は並ばない', () => {
    // これが無いと、はじまりの帯 (tier1) の街に grade2 の防具 (def+15) が並び、
    // Lv5 の守備が 2 → 18 に跳ねて tier1 の敵 (実効 atk 5〜6) の攻撃が 1 も通らなくなる。
    for (const { t, tier, stock } of stocks) {
      const max = maxShopGradeForTier(tier);
      for (const id of stock.equipment) {
        expect(gradeOf(id), `${t.name} (tier${tier}) に grade${gradeOf(id)} の ${id}`).toBeLessThanOrEqual(max);
      }
    }
  });

  it('tier1 の街は grade1 だけ / tier2 は 2 まで / tier3 は 3 まで', () => {
    const maxIn = (tier: number) =>
      Math.max(...stocks.filter((x) => x.tier === tier).flatMap((x) => x.stock.equipment.map(gradeOf)));
    expect(maxIn(1)).toBe(1);
    expect(maxIn(2)).toBe(2);
    expect(maxIn(3)).toBe(3);
  });

  it('**全 16 職のジョブ専用品 (中位・上位) が世界のどこかに必ず並ぶ**', () => {
    // 帯で絞ると割当が歯抜けになりやすい。全街の index で巡回すると、grade を置けない街が
    // index だけ消費して**世界のどこにも並ばない職**が出る (実測で中位 1 職・上位 3 職が欠けた)。
    const listed = new Set(stocks.flatMap((x) => x.stock.equipment));
    const missing = EQUIPMENT.filter((e) => e.jobOnly && e.grade >= 2 && !listed.has(e.id));
    expect(missing.map((e) => e.name)).toEqual([]);
  });

  it('上位を置ける街が少なくても全職ぶんを賄える', () => {
    // tier3 の街は 7 軒しかない。1 軒 1 品だと 16 職に足りない (7 < 16)。
    const highTowns = stocks.filter((x) => maxShopGradeForTier(x.tier) >= 3).length;
    const highItems = EQUIPMENT.filter((e) => e.jobOnly && e.grade === 3).length;
    expect(highTowns * JOB_HIGH_PER_TOWN, `${highTowns} 軒 × ${JOB_HIGH_PER_TOWN} 品 < ${highItems} 職`)
      .toBeGreaterThanOrEqual(highItems);
  });

  it('どの帯でも全 16 職が何かしら買える (詰まない)', () => {
    for (const tier of [1, 2, 3]) {
      const inTier = stocks.filter((x) => x.tier === tier);
      for (const j of JOBS) {
        const ok = inTier.some((x) => x.stock.equipment.some((id) => {
          const d = EQUIPMENT_BY_ID[id];
          return d && canEquip(j.id, d);
        }));
        expect(ok, `tier${tier} で ${j.id} が何も買えない`).toBe(true);
      }
    }
  });
});
