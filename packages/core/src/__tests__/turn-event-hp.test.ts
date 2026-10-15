import { describe, it, expect } from 'vitest';
import { startBattle, resolveTurn, resolveTurnMulti, type BattleState, type Command, type TurnEvent } from '../index.js';

// #764: 各 TurnEvent の hp は「そのイベント直後の HP」。UI はダメージの行でこの値に変える。
type Hp = { player: number; monsters: number[] };
const hpOf = (s: BattleState): Hp => ({ player: s.player.hp, monsters: (s.enemies ?? [s.monster]).map((m) => m.hp) });

/** イベント文から「誰の HP がいくつ動いたか」を読む (検証用)。読めない文は undefined = 無変化を期待しない。 */
function expectedAfter(e: TurnEvent, before: Hp, names: { player: string; monsters: string[] }): Hp | undefined {
  const next = { player: before.player, monsters: [...before.monsters] };
  const hit = (name: string, d: number) => {
    if (name === names.player) next.player = Math.max(0, next.player + d);
    else { const i = names.monsters.indexOf(name); next.monsters[i] = Math.max(0, next.monsters[i]! + d); }
  };
  let m: RegExpMatchArray | null;
  if ((m = e.text.match(/^(\S+)は毒のダメージ! (\d+) のダメージ$/))) hit(m[1]!, -Number(m[2]));
  else if ((m = e.text.match(/^(\S+)はやくそうを使った! HP が (\d+) 回復/))) next.player = before.player + Number(m[2]); // 上限 maxHp は 呼び出し側で 緩く 見る
  else if (e.text.includes('しかし') && e.text.includes('身をかわした')) { /* 回避: 変化なし */ }
  else if ((m = e.text.match(/! (?:会心の一撃!! )?(\S+)に (\d+) のダメージ/)) && !e.text.includes('反射')) hit(m[1]!, -Number(m[2]));
  else return undefined;
  return next;
}

/** ターンを進めながら全イベントの hp を検証し、確認できた種類を数える。 */
function check(states: BattleState[], step: (s: BattleState) => BattleState, kinds: Map<string, number>) {
  for (const s0 of states) {
    let s = s0;
    for (let t = 0; t < 40 && s.outcome === 'ongoing'; t++) {
      const next = step(s);
      let before = hpOf(s);
      const names = { player: s.player.name, monsters: (s.enemies ?? [s.monster]).map((m) => m.name) };
      for (const e of next.lastEvents) {
        expect(e.hp).toBeDefined();
        expect([e.hp!.player, ...e.hp!.monsters].every(Number.isInteger)).toBe(true);
        const want = expectedAfter(e, before, names);
        if (want && e.text.includes('やくそう')) expect(e.hp!.player).toBeGreaterThan(before.player);
        else if (want) expect(e.hp).toEqual(want);
        if (want) {
          const kind = e.text.includes('毒') ? 'poison' : e.text.includes('やくそう') ? 'herb' : e.text.includes('かわした') ? 'miss'
            : e.text.includes('会心') ? 'crit' : e.text.includes('の魔法') || e.text.includes('ファイア') ? 'magic' : 'attack';
          kinds.set(kind, (kinds.get(kind) ?? 0) + 1);
        }
        before = e.hp!;
      }
      if (next.lastEvents.length > 0) expect(next.lastEvents.at(-1)!.hp).toEqual(hpOf(next));
      s = next;
    }
  }
}

describe('TurnEvent.hp (#764)', () => {
  it('ソロ: こうげき/会心/回避/毒/やくそう で 各イベント直後の HP を 持つ', () => {
    const kinds = new Map<string, number>();
    const seeds = Array.from({ length: 40 }, (_, i) => i);
    const cmds: Command[] = ['attack', 'herb', 'attack'];
    check(seeds.map((seed) => startBattle('warrior', 3, 5, '勇者', 2, seed, 3)), (s) => resolveTurn(s, cmds[s.turn % 3]!), kinds);
    // 毒: 敵に毒を盛った状態から
    check(seeds.map((seed) => {
      const b = startBattle('warrior', 5, 10, '勇者', 1, seed);
      return { ...b, monster: { ...b.monster, statuses: [{ id: 'poison' as const, turns: 3, magnitude: 2 }] } };
    }), (s) => resolveTurn(s, 'guard'), kinds);
    for (const k of ['attack', 'crit', 'miss', 'poison', 'herb']) expect(kinds.get(k) ?? 0, k).toBeGreaterThan(0);
  });

  it('魔法 (sage の とくぎ) の ダメージ行も 直後の HP', () => {
    const kinds = new Map<string, number>();
    const states = Array.from({ length: 20 }, (_, seed) => startBattle('sage', 5, 10, '賢者', 1, seed, 0, { mp: 999 }));
    let magic = 0;
    check(states, (s) => {
      const next = resolveTurn({ ...s, player: { ...s.player, mp: s.player.maxMp } }, 'skill');
      magic += next.lastEvents.filter((e) => e.actor === 'player' && e.damage !== undefined && e.text.includes('賢者の')).length;
      return next;
    }, kinds);
    expect(magic).toBeGreaterThan(0);
  });

  it('群れ: monsters は 敵ごとの HP 配列で、当たった敵だけが減る', () => {
    const kinds = new Map<string, number>();
    const states = Array.from({ length: 20 }, (_, seed) => {
      const b = startBattle('warrior', 8, 15, '勇者', 1, seed, 3, undefined, { extraEnemies: 2 });
      const enemies = b.enemies!.map((e, i) => ({ ...e, name: `敵${i}` }));
      return { ...b, enemies, monster: enemies[0]! };
    });
    check(states, (s) => resolveTurnMulti(s, 'attack', undefined, 0, s.enemies!.findIndex((e) => e.hp > 0)), kinds);
    expect(states[0]!.enemies).toHaveLength(3);
    expect(kinds.get('attack') ?? 0).toBeGreaterThan(0);
  });

  it('lastEvents は 普通の 配列 (JSON で そのまま 往復する)', () => {
    const s = resolveTurn(startBattle('warrior', 3, 5, '勇者', 2, 1), 'attack');
    expect(Object.getOwnPropertyDescriptor(s.lastEvents, 'push')).toBeUndefined();
    expect(JSON.parse(JSON.stringify(s.lastEvents))).toEqual(s.lastEvents);
  });
});
