/** D-ENDGAME-001 PR4: ボスの型 (patternSets) と前ぶれ。§B3r3・§B3m。 */
import { describe, expect, it } from 'vitest';
import { MONSTERS, setMonsterOverrides, startBattle, resolveTurnMulti, resolveTurn, upcomingStep, decodeMonstersFromRecord, playerCombatant, type MonsterDef, type BattleState, type Combatant } from '../index.js';
import { TEST_MONSTERS } from './helpers/monster-fixture.js';

const TELL_S = 'とうろうの火が、しろくふくらんでいく…';
const SAY = 'とうろうのほのおが、塔のてっぺんまでのびた…';
const boss = (over: Partial<MonsterDef> = {}): MonsterDef => ({
  ...(TEST_MONSTERS[0] as MonsterDef), id: 'pt-boss', name: 'ためしのとうろう', storyOnly: true, hp: 400, ability: undefined, abilities: undefined, drops: [],
  patternSets: [
    { patterns: [{ weight: 1, steps: [{ move: 'attack' }, { move: 'smash', name: 'おおあかり', power: 0.5, tell: TELL_S }] }, { weight: 1, steps: [{ move: 'attack' }, { move: 'attack' }, { move: 'smash', name: 'おおあかり', power: 0.5, tell: TELL_S }] }] },
    { below: 0.5, say: SAY, patterns: [{ weight: 1, steps: [{ move: 'smash', name: 'おおあかり', power: 0.5, tell: TELL_S }, { move: 'attack' }] }] },
  ],
  ...over,
} as MonsterDef);
const start = (seed: number) => { setMonsterOverrides([...TEST_MONSTERS, boss()] as never); return startBattle('warrior', 20, 1, 'hero', 1, seed, 2, undefined, { monsterId: 'pt-boss', story: { canFlee: false } }); };

describe('ボスの型 (D-ENDGAME-001 PR4)', () => {
  it('大技の 1 ターン前に、その大技の前ぶれがかならず出る (列がどれでも)', () => {
    for (let seed = 1; seed <= 40; seed++) {
      let s: BattleState = start(seed); let prevTold = false;
      for (let t = 0; t < 8 && s.outcome === 'ongoing'; t++) {
        s = resolveTurn(s, 'guard');
        const smashed = s.lastEvents.some((e) => e.text.includes('おおあかり!'));
        if (smashed) expect(prevTold).toBe(true);
        prevTold = s.lastEvents.some((e) => e.text === TELL_S);
      }
    }
  });
  it('列は戦いごとに乱数で変わる (seed がちがえば 1 巡めの長さがちがうことがある)', () => {
    const firstSmash = new Set<number>();
    for (let seed = 1; seed <= 30; seed++) { let s = start(seed); for (let t = 1; t <= 4; t++) { s = resolveTurn(s, 'guard'); if (s.lastEvents.some((e) => e.text.includes('おおあかり!'))) { firstSmash.add(t); break; } } }
    expect(firstSmash.size).toBeGreaterThan(1);
  });
  it('HP が below を切ったターンのおわりに say が出て、つぎの段の列に入る', () => {
    let s = start(3); s = { ...s, monster: { ...s.monster, hp: Math.floor(s.monster.maxHp * 0.45) } };
    s = resolveTurn(s, 'guard');
    expect(s.lastEvents.some((e) => e.text === SAY)).toBe(true);
    expect(s.monster.pattern?.set).toBe(1);
    expect(upcomingStep(boss(), s.monster)?.move).toBe('smash');
  });
  it('前のターンの state を書きかえない (Combatant は浅いコピー)', () => {
    const s0 = resolveTurn(start(5), 'guard'); const snap = JSON.stringify(s0.monster.pattern);
    resolveTurn(s0, 'guard'); resolveTurn(s0, 'guard');
    expect(JSON.stringify(s0.monster.pattern)).toBe(snap);
  });
  it('仲間がいても同じ型で動く (resolveTurnMulti)', () => {
    const s = start(7); const m = { ...s, allies: [s.player], enemies: [s.monster] };
    const r = resolveTurnMulti(resolveTurnMulti(m, 'guard'), 'guard');
    expect(r.monster.pattern).toBeDefined();
  });
  it('データの検査: 大技に前ぶれが無い・はじめの手に前ぶれ・ちがう手に同じ前ぶれ は MonsterDataError', () => {
    const bad = (sets: unknown) => () => setMonsterOverrides([...TEST_MONSTERS, boss({ patternSets: sets as never })] as never);
    expect(bad([{ patterns: [{ weight: 1, steps: [{ move: 'attack' }, { move: 'smash', power: 0.5 }] }] }])).toThrow(/前ぶれ/);
    expect(bad([{ patterns: [{ weight: 1, steps: [{ move: 'smash', power: 0.5, tell: 'a' }, { move: 'attack' }] }] }])).toThrow(/1 手め/);
    expect(bad([{ patterns: [{ weight: 1, steps: [{ move: 'attack' }, { move: 'smash', name: 'x', power: 0.5, tell: 'a' }, { move: 'drain', name: 'y', tell: 'a' }] }] }])).toThrow(/同じ前ぶれ/);
  });
  it('レコードの小数 (below・weight・power) を文字列から戻す', () => {
    const [d] = decodeMonstersFromRecord([{ ...boss(), patternSets: [{ patterns: [{ weight: '2', steps: [{ move: 'attack' }, { move: 'smash', power: '0.55', tell: TELL_S }] }] }, { below: '0.5', patterns: [{ weight: '1', steps: [{ move: 'attack' }, { move: 'attack' }] }] }] }]);
    expect(d!.patternSets![0]!.patterns[0]!.weight).toBe(2); expect(d!.patternSets![1]!.below).toBe(0.5); expect(d!.patternSets![0]!.patterns[0]!.steps[1]!.power).toBe(0.55);
  });

  it('めいれいの ぼうぎょは行動順によらず大技に間にあう (ターンの頭で構える)', () => {
    // 仲間の agi を 0 にして、いつも仮面より後に動くようにする。大技 (smash 0.5) は 1 手め以外なので、前ぶれのあとのターンで見る。
    const mate: Combatant = { ...playerCombatant('mage', 20, 1, 'ソラ'), agi: 0, job: { archetype: 'mage', level: 20 } };
    for (let seed = 1; seed <= 20; seed++) {
      let s: BattleState = start(seed); s = { ...s, allies: [s.player, mate], enemies: [s.monster] };
      for (let t = 0; t < 6 && s.outcome === 'ongoing'; t++) {
        const told = s.lastEvents.some((e) => e.text === TELL_S);
        const before = s.allies![1]!.hp;
        s = resolveTurnMulti(s, 'guard', undefined, 0, 0, undefined, [undefined, { command: 'guard', skillIndex: 0, targetIndex: 0 }]);
        const hit = s.lastEvents.find((e) => e.text.startsWith('ソラに') && e.damage !== undefined);
        if (told && hit) expect(hit.damage!, `seed${seed}`).toBeLessThanOrEqual(Math.ceil(mate.maxHp * 0.5 * 1.05 * 0.5) + 1);
        void before;
      }
    }
  });
  it('drain は前ぶれのあと弱点の属性で drainBreak 以上うけると止まり、守備↓ 2T になる', () => {
    const TELL_D = 'ひかりが、仮面のひびから もれだした…';
    const drainBoss = boss({ id: 'pt-drain', element: 'wind', drainBreak: 30, patternSets: [{ patterns: [{ weight: 1, steps: [{ move: 'attack' }, { move: 'drain', name: 'ひかりを すう', amount: 0.25, heal: 0.3, tell: TELL_D, broken: 'ひかりがこぼれて、仮面がよろめいた!' }] }] }] });
    setMonsterOverrides([...TEST_MONSTERS, drainBoss] as never);
    const run = (fire: boolean) => {
      let s = startBattle('warrior', 20, 1, 'hero', 1, 11, 2, undefined, { monsterId: 'pt-drain', story: { canFlee: false } });
      // 1 ターンめのおわりに前ぶれ。2 ターンめに弱点 (火) で 40 うけたことにする。
      s = resolveTurn(s, 'guard');
      expect(s.lastEvents.some((e) => e.text === TELL_D)).toBe(true);
      if (fire) s = { ...s, monster: { ...s.monster, weakDmg: 40 } };
      s = resolveTurn(s, 'guard');
      return s;
    };
    const stopped = run(true);
    expect(stopped.lastEvents.some((e) => e.text === 'ひかりがこぼれて、仮面がよろめいた!')).toBe(true);
    expect(stopped.monster.statuses.some((x) => x.id === 'defDown')).toBe(true);
    const drained = run(false);
    expect(drained.lastEvents.some((e) => e.text.includes('のHPが') && e.text.includes('回復'))).toBe(true);
  });
  it('drain の手番はターンのいちばん最後 (止めるすきが まる 1 ターンある)', () => {
    const TELL_D = 'ひかりが、仮面のひびから もれだした…';
    const drainBoss = boss({ id: 'pt-drain2', agi: undefined, stats: [10, 10, 255, 10, 10], drainBreak: 9999, patternSets: [{ patterns: [{ weight: 1, steps: [{ move: 'attack' }, { move: 'drain', name: 'ひかりを すう', amount: 0.1, heal: 0, tell: TELL_D }] }] }] } as never);
    setMonsterOverrides([...TEST_MONSTERS, drainBoss] as never);
    let s = startBattle('warrior', 20, 1, 'hero', 1, 5, 2, undefined, { monsterId: 'pt-drain2', story: { canFlee: false } });
    s = { ...s, allies: [s.player], enemies: [s.monster] };
    s = resolveTurnMulti(s, 'attack');
    s = resolveTurnMulti(s, 'attack');
    const idxDrain = s.lastEvents.findIndex((e) => e.text.includes('ひかりを すう'));
    const idxHero = s.lastEvents.findIndex((e) => e.text.startsWith('heroのこうげき'));
    expect(idxDrain).toBeGreaterThan(idxHero);
  });
});
void MONSTERS;
