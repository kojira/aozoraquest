/**
 * 貴重な装備 (D-RARE-GEAR-001): 店に出さない・ドロップの確率 (運・巫女の直感で上がる)・装備の効果・
 * クエストの報酬の装備と選べる品・保存の検査。
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  ARCHETYPES, BATTLE_TUNING, EQUIPMENT, MONSTERS, activeItems, activeMonsters, applyIncomingCalc, dropChance, gearDropChance, gearEffects, gearPriceDrift,
  gearGradeGaps, isShopForbiddenEquipment, jobGradeSet, listable, maxShopGradeForTier, mpCostFactorOf, playerCombatant, preciousIssue, questRewardChoices,
  rollDrops, rollGearDrops, setGameQuests, setItemOverrides, setMonsterOverrides, setNpcs, setShopOverrides, tierForRegion, townShopStock, worldOverlay,
  applyStatus, type EquipmentDef, type GameQuestDef, type MonsterDef,
} from '../index.js';
import { TEST_MONSTERS } from './helpers/monster-fixture.js';

const RIBBON: EquipmentDef = { id: 'pc-g1-ribbon', name: 'くもいろのリボン', slot: 'head', kind: 'cloth', bonus: { def: 2, agi: 1 }, grade: 1, price: { power: 0, materials: 0 }, precious: true };
const CHARM: EquipmentDef = { id: 'pc-g5-charm', name: 'あおぞらのおまもり', slot: 'charm', kind: 'charm', bonus: { def: 30 }, grade: 5, price: { power: 0, materials: 0 }, precious: true, passive: 'gear-sky-guard' };
const HOOD: EquipmentDef = { id: 'pc-g2-hood', name: 'べにのずきん', slot: 'head', kind: 'cloth', bonus: { def: 5 }, grade: 2, price: { power: 0, materials: 0 }, precious: true, statusResist: ['poison'] };
const STAFF: EquipmentDef = { id: 'pc-g3-staff', name: 'よどみのつえ', slot: 'weapon', kind: 'staff', bonus: { atk: 17, int: 16 }, grade: 3, price: { power: 0, materials: 0 }, precious: true, passive: 'gear-mp-thrift' };
const JOB_SWORD: EquipmentDef = { id: 'pc-job-sword', name: 'そらいろのつるぎ', slot: 'weapon', kind: 'sword', bonus: { atk: 7 }, grade: 1, price: { power: 0, materials: 0 }, precious: true };
const JOB_STAFF: EquipmentDef = { id: 'pc-job-staff', name: 'そらいろのつえ', slot: 'weapon', kind: 'staff', bonus: { atk: 5, int: 4 }, grade: 1, price: { power: 0, materials: 0 }, precious: true };
const JOB_DAGGER: EquipmentDef = { id: 'pc-job-dagger', name: 'そらいろのたんけん', slot: 'weapon', kind: 'dagger', bonus: { atk: 6, agi: 3 }, grade: 1, price: { power: 0, materials: 0 }, precious: true };
const JOB_LUCKY: EquipmentDef = { id: 'pc-job-lucky', name: 'そらいろのダイス', slot: 'weapon', kind: 'lucky', bonus: { atk: 6, luk: 4 }, grade: 1, price: { power: 0, materials: 0 }, precious: true };
const ALL = [RIBBON, CHARM, HOOD, STAFF, JOB_SWORD, JOB_STAFF, JOB_DAGGER, JOB_LUCKY];
const withGear = (...extra: EquipmentDef[]) => setItemOverrides({ items: activeItems(), equipment: [...EQUIPMENT.filter((e) => !extra.some((x) => x.id === e.id)), ...extra] });

afterEach(() => { setItemOverrides(null); setShopOverrides(null); setGameQuests(null); setNpcs(null); setMonsterOverrides(TEST_MONSTERS); });

describe('貴重な装備は店に出ない (shopForbiddenDef の 1 か所)', () => {
  it('生成の品ぞろえ・職の 1 式・職の枠・店の上書き・交換・バザーのどこにも出ない', () => {
    withGear(...ALL);
    expect(isShopForbiddenEquipment(RIBBON.id)).toBe(true);
    const towns = worldOverlay().towns;
    for (const [i, town] of towns.entries()) {
      for (const a of [undefined, ...ARCHETYPES]) {
        const stock = townShopStock(town, i, a);
        expect(stock.equipment.filter((id) => ALL.some((e) => e.id === id))).toEqual([]);
      }
    }
    for (const a of ARCHETYPES) for (const g of [1, 2, 3, 4, 5, 6]) expect(jobGradeSet(a, g).filter((id) => ALL.some((e) => e.id === id))).toEqual([]);
    const town = towns[0]!;
    expect(() => setShopOverrides([{ x: town.x, y: town.y, equipment: [RIBBON.id] }])).toThrow(/店に並べられない装備/);
    expect(() => setShopOverrides([{ x: town.x, y: town.y, exchange: [{ equipmentId: RIBBON.id, stones: 5 }] }])).toThrow(/店に並べられない装備/);
    const top = towns.find((t) => maxShopGradeForTier(tierForRegion(t.region)) >= 5)!;
    expect(listable(CHARM, 0, top)).toEqual({ ok: false, reason: 'precious' });
  });

  it('上書きの店に並んだまま (検査をすりぬけた) でも、店の並びからは落ちる', () => {
    const town = worldOverlay().towns[0]!;
    setShopOverrides([{ x: town.x, y: town.y, equipment: ['wp-knife'] }]);
    withGear({ ...EQUIPMENT.find((e) => e.id === 'wp-knife')!, precious: true, price: { power: 0, materials: 0 } });
    expect(townShopStock(town, 0).equipment).not.toContain('wp-knife');
  });

  it('値段の目安の検査と、職の段ごとの空き (gearGradeGaps) では数えない', () => {
    expect(gearPriceDrift([{ ...RIBBON, price: { power: 999, materials: 0 } }])).toEqual([]);
    const onlyPrecious = [{ ...JOB_SWORD, slot: 'weapon' as const }, { ...RIBBON, slot: 'armor' as const }];
    expect(gearGradeGaps(onlyPrecious, [1])).toHaveLength(ARCHETYPES.length * 2);
  });
});

describe('dropChance (ドロップの確率の式は 1 つ)', () => {
  it('ふつうのドロップは今までと同じ: base + luk × 0.003 + 直感、0.95 まで', () => {
    expect(dropChance(0.1, 0, 0)).toBeCloseTo(0.1);
    expect(dropChance(0.1, 30, 0.1)).toBeCloseTo(0.1 + 0.09 + 0.1);
    expect(dropChance(0.9, 100, 0.1)).toBe(0.95);
  });

  it('貴重な装備: 運と巫女の直感で必ず上がり、運 100 でも 2% は 5% (まれなまま)', () => {
    const lift = BATTLE_TUNING.rareGearLukLift;
    const at = (luk: number, bonus = 0) => dropChance(0.02, luk, bonus, lift);
    expect(at(0)).toBeCloseTo(0.02);
    expect(at(30)).toBeCloseTo(0.029);
    expect(at(60)).toBeCloseTo(0.038);
    expect(at(100)).toBeCloseTo(0.05);
    expect(at(100, 0.1)).toBeCloseTo(0.06); // 巫女の直感 +1pt
    expect(at(30)).toBeGreaterThan(at(0));
    expect(at(30, 0.1)).toBeGreaterThan(at(30));
    expect(dropChance(0.08, 100, 0.1, lift)).toBeCloseTo(0.12);
  });
});

describe('rollGearDrops (まれなドロップ)', () => {
  const mon = (over: Partial<MonsterDef>): MonsterDef => ({ ...TEST_MONSTERS[0]!, ...over });

  it('gearDrop の確率で落ち、運と直感で数が増える (サーバーの seed で決まる)', () => {
    withGear(RIBBON);
    setMonsterOverrides([...TEST_MONSTERS, mon({ id: 'rare-1', gearDrop: { equipment: RIBBON.id, permille: 30 } })]);
    expect(gearDropChance('rare-1', 0)).toBeCloseTo(0.03);
    const count = (luk: number, bonus: number) => { let n = 0; for (let s = 1; s <= 20000; s++) n += rollGearDrops(['rare-1'], luk, s, bonus).length; return n / 20000; };
    const base = count(0, 0), lucky = count(100, 0.1);
    expect(base).toBeGreaterThan(0.02); expect(base).toBeLessThan(0.04);
    expect(lucky).toBeGreaterThan(0.05); expect(lucky).toBeLessThan(0.07);
    expect(rollGearDrops(['rare-1'], 0, 1234)).toEqual(rollGearDrops(['rare-1'], 0, 1234));
  });

  it('ふつうのドロップの結果は変わらない (別の乱数)・群れは 1 体ごとに引く・貴重でない品は落とさない', () => {
    withGear(RIBBON);
    const id = TEST_MONSTERS[0]!.id;
    const before = Array.from({ length: 50 }, (_, s) => rollDrops(id, 10, s));
    setMonsterOverrides([mon({ id, gearDrop: { equipment: RIBBON.id, permille: 1000 } }), ...TEST_MONSTERS.slice(1), mon({ id: 'bad', gearDrop: { equipment: 'wp-knife', permille: 1000 } })]);
    expect(Array.from({ length: 50 }, (_, s) => rollDrops(id, 10, s))).toEqual(before);
    expect(rollGearDrops([id, id, 'bad'], 0, 7)).toEqual([RIBBON.id, RIBBON.id]); // 1000‰ でも 0.95 まで → seed 7 は 2 体とも
  });

  it('gearDrop は {equipment, permille 1〜1000 の整数} だけ (PDS に小数を入れない)', () => {
    expect(() => setMonsterOverrides([...TEST_MONSTERS, mon({ id: 'x', gearDrop: { equipment: 'a', permille: 2.5 } })])).toThrow(/gearDrop/);
    expect(() => setMonsterOverrides([...TEST_MONSTERS, mon({ id: 'x', gearDrop: { equipment: 'a', permille: 0 } })])).toThrow(/gearDrop/);
  });
});

describe('装備の効果 (gear-passives)', () => {
  it('あおぞらの加護: 受けるダメージ ×0.9 (ボスの全体攻撃も applyIncomingCalc を通る)', () => {
    withGear(CHARM);
    const c = playerCombatant('warrior', 20, 1, 'a', undefined, undefined, { charm: CHARM.id });
    expect(c.passives).toContain('gear-sky-guard');
    expect(applyIncomingCalc(100, c, { rng: () => 0, events: [] })).toBeCloseTo(90);
  });

  it('こころのゆとり: とくぎの MP ×0.85、巫女の直感と掛け合わせ', () => {
    withGear(STAFF);
    const c = playerCombatant('miko', 30, 1, 'a', undefined, undefined, { weapon: STAFF.id });
    expect(mpCostFactorOf(c)).toBeCloseTo(0.7 * 0.85);
  });

  it('効かない状態異常: 毒を付けようとしても効かない。装備できない品の効果は付かない', () => {
    withGear(HOOD, STAFF);
    const c = playerCombatant('warrior', 5, 1, 'a', undefined, undefined, { head: HOOD.id, weapon: STAFF.id });
    expect(c.statusResist).toEqual(['poison']);
    expect(applyStatus(c, { id: 'poison', turns: 2 })).toBe(false);
    expect(c.passives ?? []).not.toContain('gear-mp-thrift'); // 戦士は杖を装備できない
    expect(gearEffects('warrior', { charm: CHARM.id, head: CHARM.id }).passives).toEqual([]); // CHARM は未登録 (このテストでは)
  });

  it('装備の statusResist・passive の不正は保存で止める', () => {
    expect(() => withGear({ ...HOOD, statusResist: ['nope' as 'poison'] })).toThrow(/statusResist/);
    expect(() => withGear({ ...CHARM, passive: 'nope' })).toThrow(/passive/);
  });
});

describe('クエストの報酬の装備と、選べる品', () => {
  const quest = (over: Partial<GameQuestDef['reward']>): GameQuestDef => ({
    id: 'side-x', title: 'さいご', npcId: 'n1', intro: ['たのむ'], done: ['ありがとう'],
    objective: { kind: 'talk', npcId: 'n1', line: 'やあ' }, reward: { power: 10, ...over },
  });
  const setup = () => { setNpcs([{ id: 'n1', name: 'そんちょう', x: 1, y: 1, lines: ['やあ'] }]); withGear(...ALL); };

  it('主人公か仲間が装備できる品だけ、主人公の品を先に並べる', () => {
    setup();
    const q = quest({ choices: [JOB_SWORD.id, JOB_STAFF.id, JOB_DAGGER.id, JOB_LUCKY.id] });
    expect(questRewardChoices(q, ['guardian'])).toEqual([JOB_SWORD.id]);
    expect(questRewardChoices(q, ['mage'])).toEqual([JOB_STAFF.id, JOB_DAGGER.id]);
    expect(questRewardChoices(q, ['guardian', 'miko'])).toEqual([JOB_SWORD.id, JOB_STAFF.id, JOB_LUCKY.id]);
  });

  it('選べる品の組で、16 職のどれもが 1 品以上 装備できる (できなければ保存で止める)', () => {
    setup();
    for (const a of ARCHETYPES) expect(questRewardChoices(quest({ choices: [JOB_SWORD.id, JOB_STAFF.id, JOB_DAGGER.id, JOB_LUCKY.id] }), [a]).length).toBeGreaterThan(0);
    expect(preciousIssue({ quests: [quest({ choices: [JOB_SWORD.id, JOB_STAFF.id, JOB_DAGGER.id, JOB_LUCKY.id] })] })).toBeNull();
    expect(preciousIssue({ quests: [quest({ choices: [JOB_STAFF.id, JOB_DAGGER.id] })] })).toMatch(/guardian/);
  });

  it('形の検査: 選べる品は 2〜6 品・重複なし・equipment と同時に付けない', () => {
    setup();
    expect(() => setGameQuests([quest({ choices: [JOB_SWORD.id] })])).toThrow(/2〜6/);
    expect(() => setGameQuests([quest({ choices: [JOB_SWORD.id, JOB_SWORD.id] })])).toThrow(/重複/);
    expect(() => setGameQuests([quest({ equipment: RIBBON.id, choices: [JOB_SWORD.id, JOB_STAFF.id] })])).toThrow(/同時/);
    setGameQuests([quest({ equipment: RIBBON.id })]);
  });

  it('保存の検査: 無い品・カジノの景品は報酬にできない', () => {
    setup();
    expect(preciousIssue({ quests: [quest({ equipment: 'ghost' })] })).toMatch(/存在しない/);
    expect(preciousIssue({ quests: [quest({ equipment: 'wp-star-sword' })] })).toMatch(/カジノ/);
  });
});

describe('preciousIssue (保存の検査)', () => {
  it('貴重な装備の値札は 0・敵の gearDrop は貴重な装備・1 つ上の段の同じ部位に届かない', () => {
    expect(preciousIssue({ equipment: [...EQUIPMENT, RIBBON] })).toBeNull();
    expect(preciousIssue({ equipment: [...EQUIPMENT, { ...RIBBON, price: { power: 5, materials: 0 } }] })).toMatch(/値札は 0/);
    expect(preciousIssue({ equipment: [...EQUIPMENT, RIBBON], monsters: [{ ...MONSTERS[0]!, gearDrop: { equipment: 'wp-knife', permille: 20 } }] })).toMatch(/貴重な装備にする/);
    const g2top = Math.max(...EQUIPMENT.filter((e) => e.grade === 2 && e.slot === 'head' && !e.casinoOnly).map((e) => e.bonus.def ?? 0));
    expect(preciousIssue({ equipment: [...EQUIPMENT, { ...RIBBON, bonus: { def: g2top } }] })).toMatch(/届いている/);
    expect(activeMonsters().length).toBeGreaterThan(0);
  });
});
