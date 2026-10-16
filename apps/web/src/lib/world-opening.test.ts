/** 冒頭の場面の組み立て (D-DIALOGUE-006)。順番・差し込み・話者・場面が無いとき。 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setDialogue, setNpcs, type DialogueData, type NpcDef } from '@aozoraquest/core';
import { starterTownNpcs } from '@aozoraquest/core/src/__tests__/helpers/starter-town-fixture';
import dialogueFixture from '@aozoraquest/core/src/__tests__/fixtures/dialogue.json';
import { handoffAvailable, openingAvailable, openingLines, OPENING_GUIDE_LINES, starterHandoffLines } from './world-opening';
import { sceneDialogue } from './scene-dialogue';
import { cidFor } from '@aozoraquest/core/src/__tests__/helpers/npc-images';

const image = (cid: string) => ({ blob: { $type: 'blob' as const, ref: { $link: cidFor(Buffer.from(cid)) }, mimeType: 'image/webp' as const, size: 10 }, width: 512, height: 768 });
const bluesky = (): NpcDef => ({ ...starterTownNpcs().find((n) => n.id === 'futaba-bluesky')!, portraitImage: image('smile'), expressionImages: { sad: image('sad') } });
const fixture = dialogueFixture as DialogueData;
const texts = (lines: { text: string }[]) => lines.map((l) => l.text);
const without = (id: string): DialogueData => ({ scenes: fixture.scenes.filter((x) => x.id !== id) });

beforeEach(() => { setNpcs([bluesky()]); setDialogue(fixture); });
afterEach(() => { setDialogue(null); setNpcs(null); });

describe('冒頭', () => {
  it('プロローグ → 救護 → 誘い → 操作ガイドの順 (手渡しが無い入場)', () => {
    const lines = openingLines(false);
    expect(lines[0]).toEqual({ text: '……ここは、どこ？', effects: [{ kind: 'fade', to: 'black' }, { kind: 'silhouette', show: true }] });
    expect(lines[1]).toEqual({ speaker: '？？？', text: 'やっと届いた。きみの言葉が。' });
    expect(texts(lines.slice(9, 11))).toEqual(['……聞こえる？　大丈夫？', 'けがしてる……。待って、やくそうがあるから。']);
    expect(texts(lines.slice(-3))).toEqual(['村のギルドで少し休んでいかない？　井戸の北東の建物だよ。ゆっくりおいで。', ...texts([...OPENING_GUIDE_LINES])]);
  });

  it('救護の心配顔は [sad] の表情画像、笑顔は通常の絵、地の文は絵なし (同梱の画像は使わない。J3)', () => {
    const lines = openingLines(true);
    expect(lines[9]).toMatchObject({ speaker: 'Blueskyちゃん', portrait: { src: expect.stringContaining('expression=sad'), name: 'Blueskyちゃん' } });
    expect(lines[9]!.effects).toEqual([{ kind: 'fade', to: 'clear' }, { kind: 'silhouette', show: false }, { kind: 'flash', color: 'white' }]);
    expect(lines[11]).toEqual({ text: '少女はやくそうを取り出し、そっと傷の手当てをしてくれた。' });
    expect(lines[12]!.portrait?.src).toContain(`cid=${cidFor(Buffer.from('smile'))}`);
    expect(lines[12]!.portrait?.src).not.toContain('expression=');
    // 手渡しが続くときは誘いとガイドを手渡しの後へ回す。
    expect(lines).toHaveLength(15);
  });

  it('手渡し → 誘い → 祝福 ({power}) → ガイドの順。祝福はリセット後だけ', () => {
    expect(texts(starterHandoffLines(true))).toEqual([
      'これも持っていて。また痛くなったら使ってね。', 'やくそうを受け取った！', 'そらのはねもあげるね。行ったことのある街へ戻れるの。',
      'そらのはねを受け取った！　コマンドの「どうぐ」から使えます。', '村のギルドで少し休んでいかない？　井戸の北東の建物だよ。ゆっくりおいで。',
      '【ギフト】ことばの ちからであおぞらパワーが20増えた！', ...texts([...OPENING_GUIDE_LINES]),
    ]);
    expect(texts(starterHandoffLines(false))).not.toContain('【ギフト】ことばの ちからであおぞらパワーが20増えた！');
  });

  it('話者の NPC が見つからなければ地の文', () => {
    setNpcs([]);
    expect(openingLines(true)[12]).toEqual({ text: 'よかった……！　気がついたんだね。' });
  });
});

describe('場面が無いとき (コード側の代わりの文は無い)', () => {
  // 読み込みは決まった場面がすべて揃っていないと入らない (validateDialogue) ので、欠けるのはレコードごと無いとき。
  it('冒頭の場面が無ければ冒頭を始めない', () => {
    expect(() => setDialogue(without('opening.prologue'))).toThrow();
    setDialogue(null);
    expect(openingAvailable()).toBe(false);
    expect(openingLines(false)).toEqual([]);
  });

  it('手渡しが無ければ手渡しの窓を出さない', () => {
    setDialogue(null);
    expect(handoffAvailable()).toBe(false);
    expect(starterHandoffLines(true)).toEqual([]);
  });

  it('inn.ask の差し込みとその場の人', () => {
    expect(sceneDialogue('inn.ask', { vars: { price: 3 }, here: (raw) => ({ speaker: 'ふたばの宿', text: raw }) }))
      .toEqual([{ speaker: 'ふたばの宿', text: '一晩3パワーです。泊まっていきますか？' }]);
    setDialogue(null);
    expect(sceneDialogue('inn.ask', { vars: { price: 3 } })).toEqual([]);
  });
});
