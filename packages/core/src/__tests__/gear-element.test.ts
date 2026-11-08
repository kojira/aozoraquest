/**
 * 装備の属性 (D-ELEM-001。D-PARTY-002 §13・§13a・§13b)。
 * - 防具の染まり: 部位の基本値 + 0.05 × 強化値 (0〜1)、合計 1 を超えたら正規化
 * - 被ダメ倍率: 水 75% は火 ×0.625・地 ×1.375。空 100% は 4 元素 ×0.8・空 ×1.2。無属性は等倍
 * - 隣り合う属性は一緒に着られない (空はどれとも着られる)
 * - 武器の属性は通常攻撃だけ (弱点 ×1.5 と告知)。とくぎは自分の属性のまま
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  activeEquipment, activeItems, adjacentArmorConflict, armorDye, armorDyeSummary, armorElementMultiplier, playerCombatant, pieceDye,
  leveledName, resolveTurn, setItemOverrides, setMonsterOverrides, startBattle, wouldConflict,
  type EquipmentDef, type GearSelection, type MonsterDef,
} from '../index.js';
import { TEST_MONSTERS } from './helpers/monster-fixture.js';

const gear = (id: string, slot: EquipmentDef['slot'], element: EquipmentDef['element'], kind: EquipmentDef['kind'] = 'cloth'): EquipmentDef =>
  ({ id, name: id, slot, kind, grade: 1, price: { power: 1, materials: 0 }, bonus: {}, ...(element ? { element } : {}) });
const ELEM_GEAR: EquipmentDef[] = [
  gear('hd-fire', 'head', 'fire'), gear('ar-fire', 'armor', 'fire'), gear('ft-fire', 'feet', 'fire'),
  gear('hd-water', 'head', 'water'), gear('ar-water', 'armor', 'water'), gear('ft-water', 'feet', 'water'), gear('ch-water', 'charm', 'water', 'charm'),
  gear('ar-void', 'armor', 'void'), gear('hd-void', 'head', 'void'), gear('ft-void', 'feet', 'void'), gear('ch-void', 'charm', 'void', 'charm'),
  gear('ar-earth', 'armor', 'earth'), gear('ft-wind', 'feet', 'wind'),
  gear('wp-water', 'weapon', 'water', 'common'), gear('wp-plain', 'weapon', undefined, 'common'),
];
const useGear = () => setItemOverrides({ items: activeItems(), equipment: [...activeEquipment().filter((e) => !e.element), ...ELEM_GEAR] });
afterEach(() => { setItemOverrides(null); setMonsterOverrides(TEST_MONSTERS); });

describe('防具の染まり (§13a・§13b)', () => {
  it('水 75% (胴 0.5 + 頭 0.25) は火の攻撃 ×0.625、地の攻撃 ×1.375、無属性は ×1', () => {
    useGear();
    const dye = armorDye({ armor: 'ar-water', head: 'hd-water' });
    expect(dye.water).toBeCloseTo(0.75);
    expect(armorElementMultiplier(dye, 'fire')).toBeCloseTo(0.625);
    expect(armorElementMultiplier(dye, 'earth')).toBeCloseTo(1.375);
    expect(armorElementMultiplier(dye, undefined)).toBe(1);
    expect(armorDyeSummary({ armor: 'ar-water', head: 'hd-water' })).toBe('水 75%');
  });

  it('空 100% は 4 元素の攻撃 ×0.8、空の攻撃 ×1.2', () => {
    useGear();
    const dye = armorDye({ armor: 'ar-void', head: 'hd-void', feet: 'ft-void' });
    expect(dye.void).toBeCloseTo(1);
    for (const e of ['earth', 'water', 'fire', 'wind'] as const) expect(armorElementMultiplier(dye, e)).toBeCloseTo(0.8);
    expect(armorElementMultiplier(dye, 'void')).toBeCloseTo(1.2);
  });

  it('合計が 1 を超えたら比率を保って 1 に (水 胴0.5+頭+足+お守り = 1.25 → 水 100%)。空と水は比率どおり', () => {
    useGear();
    expect(armorDye({ armor: 'ar-water', head: 'hd-water', feet: 'ft-water', charm: 'ch-water' }).water).toBeCloseTo(1);
    const mix = armorDye({ armor: 'ar-water', head: 'hd-void', feet: 'ft-void', charm: 'ch-void' });
    expect(mix.water).toBeCloseTo(0.4);
    expect(mix.void).toBeCloseTo(0.6);
    expect(armorDyeSummary({ armor: 'ar-water', head: 'hd-void', feet: 'ft-void', charm: 'ch-void' })).toBe('水 40%・空 60%');
  });

  it('強化値: +4 の火のかぶと 0.45、+10 の火のよろい (胴) 1.0、-1 は -0.05', () => {
    useGear();
    expect(pieceDye('head', { id: 'hd-fire', level: 4 })!.dye).toBeCloseTo(0.45);
    expect(pieceDye('armor', { id: 'ar-fire', level: 10 })!.dye).toBeCloseTo(1);
    expect(pieceDye('head', { id: 'hd-fire', level: -1 })!.dye).toBeCloseTo(0.2);
  });

  it('防具で弱点は式より増えない: 火 100% でも、無属性の攻撃は等倍', () => {
    useGear();
    const dye = armorDye({ armor: { id: 'ar-fire', level: 10 } });
    expect(armorElementMultiplier(dye, undefined)).toBe(1);
    expect(armorElementMultiplier(dye, 'water')).toBeCloseTo(1.5);
  });
});

describe('隣り合う属性 (§13a)', () => {
  it('地-水・水-火・火-風・風-地は一緒に着られない。地+火・水+風・空+どれでも は着られる', () => {
    useGear();
    expect(adjacentArmorConflict({ armor: 'ar-water', head: 'hd-fire' })).toEqual(['head', 'armor']);
    expect(adjacentArmorConflict({ armor: 'ar-earth', head: 'hd-water' })).toBeTruthy();
    expect(adjacentArmorConflict({ armor: 'ar-fire', feet: 'ft-wind' })).toBeTruthy();
    expect(adjacentArmorConflict({ armor: 'ar-earth', feet: 'ft-wind' })).toBeTruthy();
    expect(adjacentArmorConflict({ armor: 'ar-earth', head: 'hd-fire' })).toBeUndefined();
    expect(adjacentArmorConflict({ armor: 'ar-water', feet: 'ft-wind' })).toBeUndefined();
    expect(adjacentArmorConflict({ armor: 'ar-fire', head: 'hd-void' })).toBeUndefined();
    expect(wouldConflict({ armor: 'ar-water' }, 'head', 'hd-fire')).toBe(true);
    expect(wouldConflict({ armor: 'ar-water' }, 'head', 'hd-void')).toBe(false);
    expect(wouldConflict({ armor: 'ar-water' }, 'armor', 'ar-fire')).toBe(false); // 同じ部位は入れかえ
  });
});

describe('武器の属性 (§13)', () => {
  const BOSS: MonsterDef = { id: 'fboss', name: 'ほのおのぬし', species: 'slime', level: 5, tier: 1, stats: [1, 5, 1, 1, 1], hp: 999, drops: [], intro: 'x', element: 'fire' };
  const battle = (g: GearSelection) => {
    setMonsterOverrides([...TEST_MONSTERS, BOSS]);
    return startBattle('warrior', 25, 25, '勇者', 1, 3, 0, undefined, { monsterId: 'fboss', gear: g }); // 丸めで比がぶれないよう高い Lv
  };

  it('水の剣の通常攻撃は火のボスに ×1.5 で「弱点を突いた!」', () => {
    useGear();
    // 補正の同じ (0) 武器どうしで、同じ乱数のターンを比べる
    const plain = resolveTurn(battle({ weapon: 'wp-plain' }), 'attack', 7);
    const water = resolveTurn(battle({ weapon: 'wp-water' }), 'attack', 7);
    const hit = (s: typeof plain) => s.lastEvents.find((e) => e.actor === 'player' && e.text.startsWith('勇者のこうげき!'))!.damage!;
    expect(hit(water) / hit(plain)).toBeCloseTo(1.5, 1);
    expect(water.lastEvents.some((e) => e.text === `${BOSS.name}の弱点を突いた!`)).toBe(true);
    expect(plain.lastEvents.some((e) => e.text.includes('弱点'))).toBe(false);
  });

  it('とくぎは自分の属性 (無属性のとくぎは無属性のまま、武器の属性を使わない)', () => {
    useGear();
    const p = playerCombatant('warrior', 5, 5, '勇者', undefined, undefined, { weapon: 'wp-water' });
    expect(p.weaponElement).toBe('water');
    // 無属性の物理とくぎ (スマッシュ): 武器が水でも弱点にならない。同じ乱数なら素の武器と同じダメージ
    const smash = (g: GearSelection) => resolveTurn({ ...battle(g), playerSkills: [{ kind: 'smash', name: 'スマッシュ' }] } as ReturnType<typeof battle>, 'skill', 7, 0);
    const w = smash({ weapon: 'wp-water' }), n = smash({ weapon: 'wp-plain' });
    expect(w.lastEvents.some((e) => e.text.includes('弱点'))).toBe(false);
    expect(w.monster.hp).toBe(n.monster.hp);
  });
});

describe('表示', () => {
  it('装備名の横に属性 (「みずの つるぎ（水）」「みずの つるぎ+2（水）」)。属性なしは今のまま', () => {
    const sword = { ...gear('wp-mizu', 'weapon', 'water', 'common'), name: 'みずの つるぎ' };
    expect(leveledName(sword, 0)).toBe('みずの つるぎ（水）');
    expect(leveledName(sword, 2)).toBe('みずの つるぎ+2（水）');
    expect(leveledName({ ...sword, element: undefined } as never, 2)).toBe('みずの つるぎ+2');
  });
});
