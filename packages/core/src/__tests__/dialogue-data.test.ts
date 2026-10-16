/**
 * 会話データ world.dialogue (D-DIALOGUE-006)。場面 ID はコードの決まった一覧、文はデータ。
 * 保存のときに壊れた編集を弾き (知らない場面・欠けた場面・差し込み・話者)、表示では差し込みを埋める。
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  DIALOGUE_SCENE_IDS, missingDialogueNpc, sceneLines, setDialogue, validateDialogue,
  type DialogueData, type DialogueScene, type SceneLine,
} from '../index.js';

/** 決まった場面がすべて 1 行ずつある正しいデータ。 */
function full(extra: DialogueScene[] = [], patch: Partial<Record<string, SceneLine[]>> = {}): DialogueData {
  return { scenes: [...DIALOGUE_SCENE_IDS.map((id) => ({ id, lines: patch[id] ?? [{ text: `${id} の文` }] })), ...extra] };
}
const withLine = (id: string, line: SceneLine) => full([], { [id]: [line] });

describe('validateDialogue', () => {
  it('決まった場面がすべて揃っていれば通る', () => {
    expect(() => validateDialogue(full())).not.toThrow();
  });

  it('知らない場面・重複・欠けた場面・空の場面は弾く', () => {
    expect(() => validateDialogue(full([{ id: 'opening.unknown', lines: [{ text: 'x' }] }]))).toThrow(/知らない場面/);
    expect(() => validateDialogue(full([{ id: 'inn.ask', lines: [{ text: 'x' }] }]))).toThrow(/重複/);
    expect(() => validateDialogue({ scenes: full().scenes.filter((s) => s.id !== 'opening.rescue') })).toThrow(/opening\.rescue/);
    expect(() => validateDialogue(full([], { 'inn.thanks': [] }))).toThrow(/inn\.thanks/);
    expect(() => validateDialogue(full([], { 'shop.tutorial': Array.from({ length: 21 }, () => ({ text: 'x' })) }))).toThrow(/20/);
  });

  it('受付 NPC ごとの上書きは guild の場面だけに認める', () => {
    expect(() => validateDialogue(full([{ id: 'guild.first:futaba-bluesky', lines: [{ here: true, text: 'x' }] }]))).not.toThrow();
    expect(() => validateDialogue(full([{ id: 'guild.return:futaba-bluesky', lines: [{ here: true, text: 'x' }] }]))).not.toThrow();
    expect(() => validateDialogue(full([{ id: 'inn.ask:futaba-bluesky', lines: [{ text: 'x' }] }]))).toThrow(/知らない場面/);
    expect(() => validateDialogue(full([{ id: 'guild.first:', lines: [{ text: 'x' }] }]))).toThrow(/知らない場面/);
  });

  it('差し込みはその場面で使えるものだけ', () => {
    expect(() => validateDialogue(withLine('inn.ask', { here: true, text: '一晩{price}パワーです。' }))).not.toThrow();
    expect(() => validateDialogue(withLine('opening.blessing', { text: '{power}増えた！' }))).not.toThrow();
    expect(() => validateDialogue(withLine('inn.thanks', { here: true, text: '{price}' }))).toThrow(/差し込み/);
    expect(() => validateDialogue(withLine('inn.ask', { here: true, text: '{name}' }))).toThrow(/差し込み/);
  });

  it('話者は 1 つまで、本文は 120 字まで、演出は列挙どおり', () => {
    expect(() => validateDialogue(withLine('opening.rescue', { npcId: 'a', speaker: 'b', text: 'x' }))).toThrow(/話者/);
    expect(() => validateDialogue(withLine('opening.rescue', { npcId: 'a', here: true, text: 'x' }))).toThrow(/話者/);
    expect(() => validateDialogue(withLine('opening.rescue', { text: 'あ'.repeat(121) }))).toThrow(/120/);
    expect(() => validateDialogue(withLine('opening.rescue', { npcId: 'a', text: '[sad]' }))).toThrow(/120/);
    expect(() => validateDialogue(withLine('opening.rescue', { text: 'x', effects: [{ kind: 'flash', color: 'white' }] }))).not.toThrow();
    expect(() => validateDialogue(withLine('opening.rescue', { text: 'x', effects: [{ kind: 'flash', color: 'blue' }] as never }))).toThrow(/演出/);
  });
});

describe('missingDialogueNpc (保存のときだけ見る)', () => {
  it('行の npcId と上書きの <npcId> が実在しなければ説明を返す', () => {
    const data = full([{ id: 'guild.first:futaba-bluesky', lines: [{ here: true, text: 'x' }] }], { 'opening.rescue': [{ npcId: 'bluesky', text: 'x' }] });
    expect(missingDialogueNpc(data, new Set(['bluesky', 'futaba-bluesky']))).toBeNull();
    expect(missingDialogueNpc(data, new Set(['futaba-bluesky']))).toMatch(/bluesky/);
    expect(missingDialogueNpc(data, new Set(['bluesky']))).toMatch(/futaba-bluesky/);
  });
});

describe('sceneLines', () => {
  afterEach(() => setDialogue(null));

  it('差し込みを埋め、ギルドは受付 NPC の上書きを優先する', () => {
    setDialogue(full([{ id: 'guild.first:futaba-bluesky', lines: [{ here: true, text: '村の' }] }], { 'inn.ask': [{ here: true, text: '一晩{price}パワーです。' }] }));
    expect(sceneLines('inn.ask', { price: 12 })).toEqual([{ here: true, text: '一晩12パワーです。' }]);
    expect(sceneLines('guild.first', {}, 'futaba-bluesky')).toEqual([{ here: true, text: '村の' }]);
    expect(sceneLines('guild.first', {}, 'other')).toEqual([{ text: 'guild.first の文' }]);
  });

  it('データが無ければ空 (コードに代わりの文は持たない)', () => {
    expect(sceneLines('opening.prologue')).toEqual([]);
  });
});
