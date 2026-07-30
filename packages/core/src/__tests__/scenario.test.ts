/**
 * シナリオ (イベント列 + フラグ) (#545)。守るべき不変条件:
 * - **発火済み (全フラグが立っている) イベントは二度と出さない** (お知らせが毎回出る事故)
 * - 連鎖 (A のフラグで B が発火) を 1 回の呼び出しで解決する
 * - 存在しないクエスト・ジョブ・アイテムを条件にさせない
 * - 壊れた 1 件で全体を落とす
 */
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import {
  ScenarioError,
  flagsSatisfied,
  pendingScenario,
  scenarioEvents,
  setScenario,
  type ScenarioEvent,
  type ScenarioProgress,
} from '../scenario.js';
import { setGameQuests, type GameQuestDef } from '../quest-data.js';
import { setNpcs, npcLinesFor, type NpcDef } from '../npc-data.js';
import { MONSTERS } from '../battle.js';

const MON = MONSTERS[0]!.id;
const QUEST: GameQuestDef = {
  id: 'q1', title: 'たいじ', npcId: 'n1',
  intro: ['たのむ'], done: ['ありがとう'],
  objective: { kind: 'defeat', monsterId: MON, count: 1 },
};

const progress = (over: Partial<ScenarioProgress> = {}): ScenarioProgress => ({
  flags: [], questsDone: [], jobXpLevels: {}, materials: {}, ...over,
});

beforeEach(() => {
  setNpcs([{ id: 'n1', name: 'そんちょう', x: 1, y: 1, lines: ['やあ'] }]);
  setGameQuests([QUEST]);
});
afterEach(() => {
  setScenario(null);
  setGameQuests(null);
  setNpcs(null);
});

describe('setScenario の検証', () => {
  const base: ScenarioEvent = { id: 'e1', title: '第1章', when: [{ kind: 'questDone', questId: 'q1' }], setFlags: ['ch1_done'] };

  it('正常な定義を受け付ける', () => {
    setScenario([base]);
    expect(scenarioEvents()).toHaveLength(1);
  });

  it('存在しないクエスト・ジョブ・アイテムを弾く', () => {
    expect(() => setScenario([{ ...base, when: [{ kind: 'questDone', questId: 'ghost' }] }])).toThrow(ScenarioError);
    expect(() => setScenario([{ ...base, when: [{ kind: 'jobLevel', job: 'nobody' as never, level: 5 }] }])).toThrow(ScenarioError);
    expect(() => setScenario([{ ...base, when: [{ kind: 'itemCount', itemId: 'ghost', count: 1 }] }])).toThrow(ScenarioError);
  });

  it('フラグ名の書式を強制する (空白・大文字・長すぎを弾く)', () => {
    for (const flag of ['', 'A B', 'UPPER', 'x'.repeat(60)]) {
      expect(() => setScenario([{ ...base, setFlags: [flag] }]), flag).toThrow(ScenarioError);
    }
  });

  it('立てるフラグが無いイベントを弾く (何も起きないイベントは書き間違い)', () => {
    expect(() => setScenario([{ ...base, setFlags: [] }])).toThrow(ScenarioError);
  });

  it('自分が立てるフラグを自分の条件にできない (一度発火したら二度と成立しない)', () => {
    expect(() => setScenario([{ ...base, when: [{ kind: 'flag', flag: 'ch1_done' }], setFlags: ['ch1_done'] }])).toThrow(ScenarioError);
  });

  it('id 重複・お知らせの長さを弾く', () => {
    expect(() => setScenario([base, base])).toThrow(ScenarioError);
    expect(() => setScenario([{ ...base, notice: 'x'.repeat(200) }])).toThrow(ScenarioError);
  });

  it('壊れた 1 件で全体を落とす', () => {
    setScenario([base]);
    expect(() => setScenario([{ ...base, id: 'ok' }, { ...base, id: 'bad', setFlags: [''] }])).toThrow(ScenarioError);
    expect(scenarioEvents().map((e) => e.id)).toEqual(['e1']); // 前の状態のまま
  });
});

describe('pendingScenario', () => {
  it('条件を満たすと発火してフラグが立つ', () => {
    setScenario([{ id: 'e1', title: '第1章', when: [{ kind: 'questDone', questId: 'q1' }], setFlags: ['ch1'], notice: '橋が なおった' }]);
    expect(pendingScenario(progress()).fired).toHaveLength(0); // まだ達成していない
    const r = pendingScenario(progress({ questsDone: ['q1'] }));
    expect(r.fired.map((e) => e.id)).toEqual(['e1']);
    expect(r.flags).toContain('ch1');
  });

  it('**発火済みは二度と出さない** (毎回同じお知らせが出ない)', () => {
    setScenario([{ id: 'e1', title: '第1章', when: [{ kind: 'questDone', questId: 'q1' }], setFlags: ['ch1'] }]);
    const r = pendingScenario(progress({ questsDone: ['q1'], flags: ['ch1'] }));
    expect(r.fired).toHaveLength(0);
  });

  it('連鎖を 1 回で解決する (1 歩ごとに 1 段ずつ進まない)', () => {
    setScenario([
      { id: 'e2', title: '第2章', when: [{ kind: 'flag', flag: 'ch1' }], setFlags: ['ch2'] },
      { id: 'e1', title: '第1章', when: [{ kind: 'questDone', questId: 'q1' }], setFlags: ['ch1'] },
    ]);
    const r = pendingScenario(progress({ questsDone: ['q1'] }));
    expect(r.fired.map((e) => e.id).sort()).toEqual(['e1', 'e2']);
    expect(r.flags).toEqual(expect.arrayContaining(['ch1', 'ch2']));
  });

  it('notFlag で「まだ〜していない」を表せる', () => {
    setScenario([{ id: 'e1', title: '未着手', when: [{ kind: 'notFlag', flag: 'ch1' }], setFlags: ['hint'] }]);
    expect(pendingScenario(progress()).fired).toHaveLength(1);
    expect(pendingScenario(progress({ flags: ['ch1'] })).fired).toHaveLength(0);
  });

  it('jobLevel / itemCount は閾値以上で成立する', () => {
    setScenario([
      { id: 'lv', title: 'Lv', when: [{ kind: 'jobLevel', job: 'warrior', level: 5 }], setFlags: ['lv5'] },
      { id: 'it', title: '素材', when: [{ kind: 'itemCount', itemId: 'herb', count: 3 }], setFlags: ['herb3'] },
    ]);
    expect(pendingScenario(progress({ jobXpLevels: { warrior: 4 }, materials: { herb: 2 } })).fired).toHaveLength(0);
    const r = pendingScenario(progress({ jobXpLevels: { warrior: 5 }, materials: { herb: 3 } }));
    expect(r.fired.map((e) => e.id).sort()).toEqual(['it', 'lv']);
  });

  it('条件が空なら最初から発火する (導入イベント)', () => {
    setScenario([{ id: 'e0', title: '開始', when: [], setFlags: ['started'] }]);
    expect(pendingScenario(progress()).fired.map((e) => e.id)).toEqual(['e0']);
  });

  it('条件が永久に満たされないイベントは発火しない (無限ループしない)', () => {
    setScenario([{ id: 'e1', title: '不能', when: [{ kind: 'flag', flag: 'never_set' }], setFlags: ['x'] }]);
    expect(pendingScenario(progress()).fired).toHaveLength(0);
  });
});

describe('フラグによる出し分け', () => {
  it('flagsSatisfied は required を全部・forbidden を 1 つも満たさないときだけ true', () => {
    expect(flagsSatisfied(['a'], undefined, ['a', 'b'])).toBe(true);
    expect(flagsSatisfied(['a', 'c'], undefined, ['a', 'b'])).toBe(false);
    expect(flagsSatisfied(undefined, ['b'], ['a', 'b'])).toBe(false);
    expect(flagsSatisfied(undefined, undefined, [])).toBe(true);
  });

  it('npcLinesFor は最初に条件を満たす分岐を返し、無ければ既定のセリフ', () => {
    const npc: NpcDef = {
      id: 'n2', name: 'むらびと', x: 2, y: 2, lines: ['ふつうの はなし'],
      altLines: [
        { flags: ['ch2'], lines: ['第2章の はなし'] },
        { flags: ['ch1'], lines: ['第1章の はなし'] },
      ],
    };
    expect(npcLinesFor(npc, [])).toEqual(['ふつうの はなし']);
    expect(npcLinesFor(npc, ['ch1'])).toEqual(['第1章の はなし']);
    // 上から順なので、両方立っていれば ch2 (後の章) が勝つ
    expect(npcLinesFor(npc, ['ch1', 'ch2'])).toEqual(['第2章の はなし']);
  });

  it('notFlags で「まだ〜していない間だけ」のセリフを書ける', () => {
    const npc: NpcDef = {
      id: 'n3', name: 'むらびと', x: 3, y: 3, lines: ['ふつう'],
      altLines: [{ notFlags: ['ch1'], lines: ['はやく たすけて'] }],
    };
    expect(npcLinesFor(npc, [])).toEqual(['はやく たすけて']);
    expect(npcLinesFor(npc, ['ch1'])).toEqual(['ふつう']);
  });
});

describe('レビュー指摘の回帰 (#545)', () => {
  it('フラグ総数が上限を超える定義は保存で弾く (切り捨てで章が巻き戻らない)', () => {
    // 上限を超えると pendingScenario の slice が古いフラグを捨て、そのイベントが
    // 「未発火」に戻って毎回再発火する。定義側で超えさせないのが唯一の確実な防ぎ方。
    const many: ScenarioEvent[] = Array.from({ length: 200 }, (_, i) => ({
      id: `e${i}`, title: `e${i}`, when: [], setFlags: [`a${i}`, `b${i}`, `c${i}`],
    }));
    expect(() => setScenario(many)).toThrow(ScenarioError); // 600 > 500
  });

  it('クエストの解禁フラグもシナリオと同じ書式で弾く (typo が永久ロックにならない)', () => {
    expect(() => setGameQuests([{ ...QUEST, requireFlags: ['Chapter2'] }])).toThrow();
    expect(() => setGameQuests([{ ...QUEST, requireFlags: ['chapter2'] }])).not.toThrow();
  });

  it('NPC のフラグ別セリフも同じ書式で弾く', () => {
    const bad: NpcDef = { id: 'n9', name: 'x', x: 9, y: 9, lines: ['a'], altLines: [{ flags: ['UPPER'], lines: ['b'] }] };
    expect(() => setNpcs([bad])).toThrow();
    const ok: NpcDef = { ...bad, altLines: [{ flags: ['upper'], lines: ['b'] }] };
    expect(() => setNpcs([ok])).not.toThrow();
  });
});

describe('notFlag の順序独立性 (#545 レビュー ★★)', () => {
  /** 同じ回に両方の条件が揃うケース。定義の並び順で結果が変わってはいけない。 */
  const pair = (order: 'aFirst' | 'bFirst'): ScenarioEvent[] => {
    const a: ScenarioEvent = { id: 'A', title: '第2章へ', when: [{ kind: 'itemCount', itemId: 'herb', count: 1 }], setFlags: ['ch2'] };
    const b: ScenarioEvent = {
      id: 'B', title: '第2章前だけの噂',
      when: [{ kind: 'itemCount', itemId: 'herb', count: 1 }, { kind: 'notFlag', flag: 'ch2' }],
      setFlags: ['rumor'], notice: 'いまだけの うわさ',
    };
    return order === 'aFirst' ? [a, b] : [b, a];
  };

  it('定義の並び順に関わらず、同じ回に条件が揃えば両方発火する', () => {
    for (const order of ['aFirst', 'bFirst'] as const) {
      setScenario(pair(order));
      const r = pendingScenario(progress({ materials: { herb: 1 } }));
      expect(r.fired.map((e) => e.id).sort(), order).toEqual(['A', 'B']);
    }
  });

  it('既にフラグが立っている状態なら notFlag のイベントは発火しない', () => {
    setScenario(pair('aFirst'));
    const r = pendingScenario(progress({ materials: { herb: 1 }, flags: ['ch2'] }));
    expect(r.fired.map((e) => e.id)).toEqual([]); // A は発火済み、B は notFlag が成立しない
  });

  it('連鎖 (次の周で発火) は引き続き 1 回の呼び出しで解決する', () => {
    setScenario([
      { id: 'e3', title: '3', when: [{ kind: 'flag', flag: 'f2' }], setFlags: ['f3'] },
      { id: 'e1', title: '1', when: [], setFlags: ['f1'] },
      { id: 'e2', title: '2', when: [{ kind: 'flag', flag: 'f1' }], setFlags: ['f2'] },
    ]);
    const r = pendingScenario(progress());
    expect(r.fired.map((e) => e.id).sort()).toEqual(['e1', 'e2', 'e3']);
  });
});
