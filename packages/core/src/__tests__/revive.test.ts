/**
 * 倒れた仲間を起こす手・全回復・どうぐの回復の量・店に並べない品 (D-REVIVE-001)。
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  BATTLE_TUNING, EQUIPMENT, ITEMS, activeItems, allyAutoAction, isShopForbiddenItem, itemHealAmount, playerCombatant, resolveTargets, resolveTurn, resolveTurnMulti,
  setItemOverrides, setShopOverrides, skillMpCostOf, skillsForJob, startBattle, townShopStock, worldOverlay,
  type BattleState, type Combatant, type ItemDefData,
} from '../index.js';

const mate = (archetype: Parameters<typeof playerCombatant>[0], level: number, name: string): Combatant => ({ ...playerCombatant(archetype, level, 1, name), job: { archetype, level } });

const FEATHER: ItemDefData = { id: 'mezame-hane', name: 'めざめのはね', precious: true, battle: { effects: [{ kind: 'heal', amount: 40, target: 'oneDownAlly' }] } };
const POTION: ItemDefData = { id: 'kizu-gusuri', name: 'きずぐすり', price: { power: 6, materials: 3 }, shopTier: 3, battle: { effects: [{ kind: 'heal', amount: 60 }] } };
const RATIO: ItemDefData = { id: 'old-ratio', name: 'むかしのくすり', battle: { effects: [{ kind: 'heal', ratio: 0.5, target: 'allAllies' }] } };
const withItems = (...extra: ItemDefData[]) => setItemOverrides({ items: [...activeItems(), ...extra], equipment: [...EQUIPMENT] });

/** 主人公 (巫女 Lv25) + 仲間 2 人 (1 人目は倒れている) vs 動かない敵 1 体。 */
function downBattle(hero: Parameters<typeof startBattle>[0] = 'miko', lv = 25): BattleState {
  const base = startBattle(hero, lv, 1, 'ゆうしゃ', 1, 3, 2, undefined, { tonics: 2, battleItems: { 'mezame-hane': 2 } });
  const monster = { ...base.monster, atk: 0, agi: 0, hp: 99999, maxHp: 99999 };
  const a1 = { ...mate('warrior', 20, 'カイト'), hp: 0 };
  const a2 = { ...mate('mage', 20, 'ソラ'), hp: 5 };
  return { ...base, monster, allies: [base.player, a1, a2], enemies: [monster] };
}

afterEach(() => { setItemOverrides(null); setShopOverrides(null); });

describe('倒れた味方をねらう (oneDownAlly)', () => {
  it('倒れた人の何番目かで選び、生きている人は選ばない', () => {
    const a = mate('warrior', 5, 'a'), b = { ...mate('mage', 5, 'b'), hp: 0 }, c = { ...mate('miko', 5, 'c'), hp: 0 };
    expect(resolveTargets(a, 'oneDownAlly', { allies: [a, b, c], enemies: [] }, { allyIndex: 1 })).toEqual([c]);
    expect(resolveTargets(a, 'oneDownAlly', { allies: [a], enemies: [] }, {})).toEqual([]);
  });
});

describe('目覚めの祈り (巫女 Lv16)', () => {
  it('倒れた仲間を最大 HP の 4 割で起こし、MP をふつうより多く使う', () => {
    const s = downBattle();
    const i = s.playerSkills.findIndex((k) => k.kind === 'revive-prayer');
    expect(i).toBeGreaterThan(0);
    const mp = s.player.mp;
    const next = resolveTurnMulti(s, 'skill', 7, i, 0);
    const kaito = next.allies![1]!;
    expect(kaito.hp).toBe(Math.round(kaito.maxHp * 0.4));
    expect(next.player.mp).toBe(mp - skillMpCostOf(s.player, 'revive-prayer'));
    expect(skillMpCostOf(s.player, 'revive-prayer')).toBeGreaterThan(skillMpCostOf(s.player));
    expect(next.lastEvents.some((e) => e.text.includes('カイトが いきかえった'))).toBe(true);
  });

  it('巫女は Lv16 で覚え、聖騎士は Lv22 で覚える', () => {
    expect(skillsForJob('miko', 15).some((k) => k.kind === 'revive-prayer')).toBe(false);
    expect(skillsForJob('miko', 16).some((k) => k.kind === 'revive-prayer')).toBe(true);
    expect(skillsForJob('paladin', 22).some((k) => k.kind === 'revive-prayer')).toBe(true);
  });

  it('仲間の巫女は、倒れた仲間がいればまず起こす', () => {
    const s = downBattle('warrior', 20);
    const miko = mate('miko', 20, 'ミコ');
    const st = { ...s, allies: [s.player, s.allies![1]!, miko] };
    const a = allyAutoAction(st, 2);
    expect(skillsForJob('miko', 20)[a.skillIndex]!.kind).toBe('revive-prayer');
    const next = resolveTurnMulti(st, 'guard', 7);
    expect(next.allies![1]!.hp).toBeGreaterThan(0);
  });
});

describe('全回復のとくぎ', () => {
  it('1 人の全回復は選んだ味方を満タンに', () => {
    const s = downBattle('sage', 22);
    const st = { ...s, allies: [s.player, { ...s.allies![2]! }] };
    const i = st.playerSkills.findIndex((k) => k.kind === 'full-heal-one');
    const next = resolveTurnMulti(st, 'skill', 7, i, 1);
    expect(next.allies![1]!.hp).toBe(next.allies![1]!.maxHp);
  });

  it('みんなの全回復は HP だけ戻し、毒と弱体は残す (眠りは自分の番で覚めうるので弱体で見る)', () => {
    const s = downBattle('miko', 25);
    const sick = (c: Combatant): Combatant => ({ ...c, hp: 3, statuses: [{ id: 'poison', turns: 3, magnitude: 1 }, { id: 'atkDown', turns: 3 }] });
    const st = { ...s, allies: [{ ...s.player, hp: 3 }, sick(s.allies![2]!)] };
    st.player = st.allies[0]!;
    const i = st.playerSkills.findIndex((k) => k.kind === 'full-heal-all');
    expect(i).toBeGreaterThan(0);
    const next = resolveTurnMulti(st, 'skill', 7, i, 0);
    const sora = next.allies![1]!;
    expect(next.allies![0]!.hp).toBe(next.allies![0]!.maxHp);
    expect(sora.statuses?.map((x) => x.id)).toEqual(expect.arrayContaining(['poison', 'atkDown']));
  });
});

describe('どうぐの回復は決まった量', () => {
  it('やくそうは herbHealAmount ぶん (1 人戦・群れ)', () => {
    const base = startBattle('warrior', 20, 1, 'x', 1, 3, 2);
    const s = { ...base, player: { ...base.player, hp: 10 }, monster: { ...base.monster, atk: 0, agi: 0 } };
    expect(resolveTurn(s, 'herb', 7).player.hp).toBe(10 + BATTLE_TUNING.herbHealAmount);
    expect(itemHealAmount('herb')).toBe(BATTLE_TUNING.herbHealAmount);
    const multi = { ...s, allies: [s.player], enemies: [s.monster] };
    expect(resolveTurnMulti(multi, 'herb', 7, 0, 0).player.hp).toBe(10 + BATTLE_TUNING.herbHealAmount);
  });

  it('戦闘のどうぐの amount で回復し、最大 HP の割合では回復しない', () => {
    withItems(POTION);
    expect(itemHealAmount('kizu-gusuri')).toBe(60);
    const base = startBattle('warrior', 30, 1, 'x', 1, 3, 0, undefined, { battleItems: { 'kizu-gusuri': 1 } });
    const s = { ...base, player: { ...base.player, hp: 10 }, monster: { ...base.monster, atk: 0, agi: 0 } };
    expect(resolveTurn(s, 'item', 7, 0, 'kizu-gusuri').player.hp).toBe(70);
  });

  it('めざめのはねは倒れた仲間を決まった量で起こす', () => {
    withItems(FEATHER);
    const next = resolveTurnMulti(downBattle(), 'item', 7, 0, 0, 'mezame-hane');
    expect(next.allies![1]!.hp).toBe(40);
    expect(next.battleItems!['mezame-hane']).toBe(1);
  });
});

describe('店に並べない品 (オーナー: 生き返らせるどうぐは なんでも屋 で買えない)', () => {
  it('生き返らせる・割合で回復・貴重なもの・カジノの景品は isShopForbiddenItem、量で回復する品は並べてよい', () => {
    withItems(FEATHER, POTION, RATIO);
    expect(isShopForbiddenItem('mezame-hane')).toBe(true);
    expect(isShopForbiddenItem('old-ratio')).toBe(true);
    expect(isShopForbiddenItem('holy-water')).toBe(true);
    expect(isShopForbiddenItem('kizu-gusuri')).toBe(false);
    expect(isShopForbiddenItem('herb')).toBe(false);
  });

  it('price・shopTier を付けると保存で弾く', () => {
    expect(() => withItems({ ...FEATHER, shopTier: 1 })).toThrow(/店に並ばない品/);
    expect(() => withItems({ ...RATIO, price: { power: 1, materials: 0 } })).toThrow(/店に並ばない品/);
  });

  it('店の上書きに書くと保存で弾き、生成の品ぞろえにも出ない', () => {
    withItems(FEATHER, POTION);
    expect(() => setShopOverrides([{ x: 1, y: 1, consumables: ['mezame-hane'] }])).toThrow(/店に並べられない品/);
    const town = worldOverlay().towns[0]!;
    ITEMS['mezame-hane'] = { ...ITEMS['mezame-hane']!, shopTier: 1 }; // 検査をすりぬけた定義でも
    expect(townShopStock(town, 0).consumables).not.toContain('mezame-hane');
  });
});

describe('ボスの ねらいうち (strike target mate)', () => {
  it('主人公ではなく、生きている仲間を 1 人ねらう', async () => {
    const { patternAct } = await import('../battle-boss-pattern.js');
    const s = downBattle('warrior', 20);
    const hero = s.allies![0]!, sora = s.allies![2]!;
    const boss = { ...s.monster, atk: 200, hp: 999, maxHp: 999 };
    const def = { id: 'b', name: 'b', species: 'x', level: 1, tier: 6, stats: [1, 1, 1, 1, 1], hp: 999, drops: [], intro: 'x',
      patternSets: [{ patterns: [{ weight: 1, steps: [{ move: 'strike' as const, target: 'mate' as const, power: 3, name: 'ねらいうち', tell: 'にらんでいる' }, { move: 'attack' as const }] }] }] };
    let hits = 0;
    for (let seed = 0; seed < 20; seed++) {
      const allies = [{ ...hero }, { ...s.allies![1]! }, { ...sora, hp: sora.maxHp }];
      let r = seed; const rng = () => ((r = (r * 1103515245 + 12345) % 2147483648) / 2147483648);
      patternAct({ ...boss, pattern: undefined }, def as never, allies, rng, []);
      expect(allies[0]!.hp).toBe(hero.hp);
      if (allies[2]!.hp < sora.maxHp) hits++;
    }
    expect(hits).toBeGreaterThan(10);
  });
});
