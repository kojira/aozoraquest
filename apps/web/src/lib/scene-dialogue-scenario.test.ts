import { describe, expect, it } from 'vitest';
import type { NpcDef, NpcImage } from '@aozoraquest/core';
import { scenarioDialogueLines } from './scene-dialogue';

const img = (link: string, width: number, height: number): NpcImage => ({ blob: { $type: 'blob', ref: { $link: link }, mimeType: 'image/webp', size: 10 }, width, height });
const SPRITE = 'bafkreicch5ajm7w7u2hvhcggzoge6ebdrxntd74g5o5gfoydt2rk5xbg4y';
const PORTRAIT = 'bafkreidbonwwairlotv3zp45dzm6dstjwga4vbk3xeaifyogixuufvpsyy';
const bird = (extra: Partial<NpcDef> = {}): NpcDef => ({ id: 'homura-bird', name: '{c:homura}', x: 7, y: 3, lines: ['ふう'], spriteImage: img(SPRITE, 64, 32), ...extra });

/** 目を覚ました鳥が、お知らせのあとに自分で話す (#907)。 */
describe('scenarioDialogueLines', () => {
  it('npcId の無いお知らせは地の文のまま (演出も保つ)', () => {
    expect(scenarioDialogueLines([{ text: '夜が明けた', effects: [{ kind: 'flash', color: 'red' }] }], [bird()]))
      .toEqual([{ text: '夜が明けた', effects: [{ kind: 'flash', color: 'red' }] }]);
  });
  it('会話イラストがあれば、その NPC の名前とイラストで話す', () => {
    const [line] = scenarioDialogueLines([{ text: 'よく寝た', npcId: 'homura-bird' }], [bird({ portraitImage: img(PORTRAIT, 768, 512) })]);
    expect(line!.speaker).toBe('{c:homura}');
    expect(line!.text).toBe('よく寝た');
    expect(line!.portrait?.src).toContain(`kind=portrait&cid=${PORTRAIT}`);
    expect(line!.portrait?.mapSprite).toBeUndefined();
  });
  it('会話イラストが無ければ、マップのドット絵 (2コマ) を大きく出す', () => {
    const [line] = scenarioDialogueLines([{ text: 'よく寝た', npcId: 'homura-bird' }], [bird()]);
    expect(line!.speaker).toBe('{c:homura}');
    expect(line!.portrait?.src).toContain(`kind=sprite&cid=${SPRITE}`);
    expect(line!.portrait?.mapSprite).toEqual({ frames: 2 });
  });
  it('NPC が見つからなければ地の文に倒す', () => {
    expect(scenarioDialogueLines([{ text: 'よく寝た', npcId: 'gone' }], [bird()])).toEqual([{ text: 'よく寝た' }]);
  });
});
