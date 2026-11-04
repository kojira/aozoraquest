import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  BATTLE_TUNING,
  ITEMS,
  activeEquipment,
  activeItems,
  resolveTurn,
  resolveTurnMulti,
  setItemOverrides,
  startBattle,
  type BattleState,
  type ItemDefData,
} from '../index.js';
import { battleItemsFrom, materialsAfterBattleUse } from '../battle-items.js';

const NEMURI: ItemDefData = {
  id: 'nemuri-kona', name: 'ねむりごな', desc: '敵 1 体を眠らせる',
  price: { power: 3, materials: 1 }, shopTier: 1,
  battle: { effects: [{ kind: 'status', status: 'sleep', target: 'enemy', chance: 1, turns: 3 }] },
};
const KEMURI: ItemDefData = {
  id: 'kemuri-dama', name: 'けむりだま',
  battle: { effects: [{ kind: 'status', status: 'accDown', target: 'allEnemies', chance: 1, turns: 3 }] },
};
const MISS: ItemDefData = {
  id: 'miss-kona', name: 'はずれごな',
  battle: { effects: [{ kind: 'status', status: 'stun', target: 'enemy', chance: 0, turns: 1 }] },
};

function withItems(extra: ItemDefData[]): void {
  setItemOverrides({ items: [...activeItems(), ...extra], equipment: [...activeEquipment()] });
}

const has = (c: { statuses?: { id: string }[] }, id: string) => (c.statuses ?? []).some((s) => s.id === id);
const texts = (s: BattleState) => s.lastEvents.map((e) => e.text);

beforeEach(() => withItems([NEMURI, KEMURI, MISS]));
afterEach(() => setItemOverrides(null));

function solo(items: Record<string, number> = { 'nemuri-kona': 2 }): BattleState {
  // 一撃で倒れない相手 (倒すと眠りが残ったまま決着するので、起きるかを見られない)
  return startBattle('warrior', 1, 1, '勇者', 1, 11, 0, undefined, { battleItems: items, monsterId: 'pale-shroom' });
}

function group(items: Record<string, number> = { 'nemuri-kona': 2, 'kemuri-dama': 2 }): BattleState {
  return startBattle('warrior', 5, 5, '勇者', 1, 11, 0, undefined, { battleItems: items, extraEnemies: 2 });
}

describe('戦闘のどうぐ (D-ITEM-001)', () => {
  it('ねむりごなで敵が眠り、「つかった」→眠りの文→「(のこり 1)」の順に出て、殴ると起きる', () => {
    const s1 = resolveTurn(solo(), 'item', 1, 0, 'nemuri-kona');
    expect(has(s1.monster, 'sleep')).toBe(true);
    const t = texts(s1);
    const used = t.indexOf('勇者は ねむりごなを つかった!');
    const slept = t.findIndex((x) => x.endsWith('は眠ってしまった!'));
    const left = t.indexOf('(のこり 1)');
    expect(used).toBeGreaterThanOrEqual(0);
    expect(slept).toBeGreaterThan(used);
    expect(left).toBeGreaterThan(slept);
    expect(s1.battleItems).toEqual({ 'nemuri-kona': 1 });
    expect(s1.battleItemsUsed).toEqual({ 'nemuri-kona': 1 });
    // 殴ると起きる (wakeOnHit)。当たるまで殴る。
    let s = s1;
    for (let i = 0; i < 10 && has(s.monster, 'sleep') && s.outcome === 'ongoing'; i++) {
      const hp = s.monster.hp;
      s = resolveTurn(s, 'attack', 100 + i);
      if (s.monster.hp < hp) break;
    }
    expect(has(s.monster, 'sleep')).toBe(false);
  });

  it('持っていないどうぐは「〇〇を もっていない!」で たたかう に落ち、数は動かない', () => {
    const s1 = resolveTurn(solo({}), 'item', 1, 0, 'nemuri-kona');
    expect(texts(s1)).toContain('ねむりごなを もっていない!');
    expect(has(s1.monster, 'sleep')).toBe(false);
    expect(s1.battleItemsUsed).toEqual({});
    // 戦闘用でない品 (やくそう) も item では使えない
    const s2 = resolveTurn(solo({ herb: 2 }), 'item', 1, 0, 'herb');
    expect(texts(s2)).toContain('やくそうを もっていない!');
  });

  it('種類ごとに battleItemCarryMax まで持ちこめ、戦闘で使えない品は持ちこまない', () => {
    const s = solo({ 'nemuri-kona': 9, 'kemuri-dama': 1, herb: 5 });
    expect(BATTLE_TUNING.battleItemCarryMax).toBe(2);
    expect(s.battleItems).toEqual({ 'nemuri-kona': 2, 'kemuri-dama': 1 });
    expect(battleItemsFrom({ 'nemuri-kona': 9, herb: 3, 'slime-drop': 4 })).toEqual({ 'nemuri-kona': 9 });
  });

  it('群れで targetIndex=1 なら 2 体目にだけ効く', () => {
    const s1 = resolveTurnMulti(group(), 'item', 1, 0, 1, 'nemuri-kona');
    expect(s1.enemies!.map((e) => has(e, 'sleep'))).toEqual([false, true, false]);
  });

  it('全体のどうぐは敵全員に効く', () => {
    const s1 = resolveTurnMulti(group(), 'item', 1, 0, 0, 'kemuri-dama');
    expect(s1.enemies!.every((e) => has(e, 'accDown'))).toBe(true);
    expect(texts(s1)).toContain('(のこり 1)');
  });

  it('確率で外れたら「しかし 〇〇には きかなかった!」を出す', () => {
    const s0 = solo({ 'miss-kona': 1 });
    const s1 = resolveTurn(s0, 'item', 1, 0, 'miss-kona');
    expect(has(s1.monster, 'stun')).toBe(false);
    expect(texts(s1)).toContain(`しかし ${s0.monster.name}には きかなかった!`);
    expect(texts(s1)).toContain('(のこり 0)');
  });

  it('決着で使った数を materials から引く (やくそう・しずくもまとめて、0 は消す)', () => {
    const m = materialsAfterBattleUse(
      { herb: 3, 'sky-dew': 1, 'nemuri-kona': 2, 'slime-drop': 4 },
      { herbsUsed: 1, tonicsUsed: 1, battleItemsUsed: { 'nemuri-kona': 2 } },
    );
    expect(m).toEqual({ herb: 2, 'slime-drop': 4 });
  });

  it('古い封印 state (battleItems の欄なし) でも動き、item は たたかう に落ちる', () => {
    const old = startBattle('warrior', 5, 5, '勇者', 1, 11);
    expect(old.battleItems).toBeUndefined();
    const s1 = resolveTurn(old, 'item', 1, 0, 'nemuri-kona');
    expect(texts(s1)).toContain('ねむりごなを もっていない!');
    expect(materialsAfterBattleUse({ herb: 1 }, s1)).toEqual({ herb: 1 });
  });

  it('activeItems は全部の欄を複製で返す (エディタで保存しても key・battle が消えない #854)', () => {
    setItemOverrides({ items: [...activeItems(), { id: 'old-letter', name: 'ふるい手紙', key: true }], equipment: [...activeEquipment()] });
    const got = activeItems();
    expect(got.find((x) => x.id === 'nemuri-kona')).toEqual(NEMURI);
    expect(got.find((x) => x.id === 'old-letter')).toEqual({ id: 'old-letter', name: 'ふるい手紙', key: true });
    got.find((x) => x.id === 'nemuri-kona')!.battle!.effects.length = 0;
    expect(ITEMS['nemuri-kona']?.battle?.effects).toHaveLength(1);
  });

  it('battle の欄が ITEMS に載る (読み込みで落ちない)', () => {
    expect(ITEMS['nemuri-kona']?.battle?.effects[0]).toMatchObject({ status: 'sleep' });
    expect(ITEMS['nemuri-kona']?.price).toEqual({ power: 3, materials: 1 });
  });
});

describe('どうぐの検証 (validateItems)', () => {
  const bad = (it: Partial<ItemDefData>) => () => withItems([{ id: 'bad', name: 'わるいどうぐ', ...it }]);

  it('battle と key は同時に付けられない', () => {
    expect(bad({ key: true, battle: NEMURI.battle! })).toThrow(/key/);
  });
  it('やくそう・そらのしずくは専用のコマンドで使うので、battle を付けられない (同じ手持ちを二重に使えないように)', () => {
    for (const id of ['herb', 'sky-dew']) {
      const items = activeItems().map((x) => (x.id === id ? { ...x, battle: NEMURI.battle! } : x));
      expect(() => setItemOverrides({ items, equipment: [...activeEquipment()] })).toThrow(new RegExp(`${id}: .*battle`));
    }
  });
  it('chance が 1 を超えたら弾く', () => {
    expect(bad({ battle: { effects: [{ kind: 'status', status: 'sleep', target: 'enemy', chance: 1.5 }] } })).toThrow(/chance/);
  });
  it('turns は 1〜5、状態は STATUS_REGISTRY にあること', () => {
    expect(bad({ battle: { effects: [{ kind: 'status', status: 'sleep', target: 'enemy', turns: 9 }] } })).toThrow(/turns/);
    expect(bad({ battle: { effects: [{ kind: 'status', status: 'nope' as 'sleep', target: 'enemy' }] } })).toThrow(/状態/);
  });
  it('damage・recoil はどうぐに使えない、target はその効果で使える値だけ', () => {
    expect(bad({ battle: { effects: [{ kind: 'damage', stat: 'atk' }] } })).toThrow(/使えない効果/);
    expect(bad({ battle: { effects: [{ kind: 'recoil', ratio: 0.1 }] } })).toThrow(/使えない効果/);
    expect(bad({ battle: { effects: [{ kind: 'cleanse', target: 'enemy' as 'self' }] } })).toThrow(/target/);
  });
  it('price は 0 以上、desc は 60 字まで、shopTier は 1〜3', () => {
    expect(bad({ price: { power: -1, materials: 0 } })).toThrow(/price/);
    expect(bad({ desc: 'あ'.repeat(61) })).toThrow(/desc/);
    expect(bad({ shopTier: 4 as 1 })).toThrow(/shopTier/);
  });
});
