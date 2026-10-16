/** ギルドのあいさつは会話データから作る (D-DIALOGUE-006)。受付ごとの上書き → 既定 → 無いときはメニュー。 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setDialogue, setNpcs, starterTownNpcs, type DialogueData, type NpcDef } from '@aozoraquest/core';
import dialogueFixture from '@aozoraquest/core/src/__tests__/fixtures/dialogue.json';
import { guildEntryTalk, guildMetKey, npcTalkPortrait } from './guild-greeting';

const DID = 'did:plc:player';
const bluesky = (): NpcDef => starterTownNpcs().find((n) => n.id === 'futaba-bluesky')!;
const homura: NpcDef = { id: 'homura-guild', name: 'ほむら', mapId: 'homura-town', x: 5, y: 5, lines: ['よう。'], guildReception: true };
const portraitImage = { blob: { $type: 'blob' as const, ref: { $link: 'bafkreiportrait' }, mimeType: 'image/webp' as const, size: 10 }, width: 512, height: 768 };

describe('guildMetKey', () => {
  it('futaba-bluesky は従来のキーのまま (会ったことのある人に再び出さない)', () => {
    expect(guildMetKey(DID, 'futaba-bluesky')).toBe(`aq-futaba-guild-met:${DID}`);
  });

  it('ほかの受付は NPC ごとの別キー (ふたばで会っても ほむらのあいさつは出る)', () => {
    expect(guildMetKey(DID, homura.id)).toBe(`aq-guild-met:${homura.id}:${DID}`);
    expect(guildMetKey(DID, homura.id)).not.toBe(guildMetKey(DID, 'futaba-bluesky'));
  });
});

describe('guildEntryTalk (会話データ)', () => {
  beforeEach(() => { setNpcs([bluesky(), homura]); setDialogue(dialogueFixture as DialogueData); });
  afterEach(() => { setDialogue(null); setNpcs(null); });

  it('受付ごとの上書きがあればそれ: ふたばは「村の」', () => {
    const talk = guildEntryTalk(bluesky(), false);
    expect(talk.guild).toBe('reunion');
    expect(talk.lines).toEqual(['来てくれたんだね。体の具合はどう？', 'ここが村の冒険者ギルドだよ。少し休んでいってね。']);
    expect(talk.dialogue?.every((l) => l.speaker === 'Blueskyちゃん')).toBe(true);
  });

  it('上書きが無ければ既定: ほかの受付は「この町の」で、話者はその受付', () => {
    const talk = guildEntryTalk(homura, false);
    expect(talk.lines).toContain('ここがこの町の冒険者ギルドだよ。少し休んでいってね。');
    expect(talk.lines.join('')).not.toContain('村');
    expect(talk.dialogue?.[0]?.speaker).toBe('ほむら');
  });

  it('2 回目以降は「おかえり」のあとメニュー', () => {
    expect(guildEntryTalk(homura, true)).toMatchObject({ guild: 'menu', lines: ['おかえり。冒険者ギルドへようこそ。'] });
  });

  it('場面が無いときはあいさつを飛ばしてギルドのメニュー (コード側の代わりの文は無い)', () => {
    setDialogue(null);
    expect(guildEntryTalk(homura, false)).toEqual({ npc: homura, guild: 'menu', lines: ['冒険者ギルドへようこそ。どうする？'] });
    expect(guildEntryTalk(bluesky(), true).lines).toEqual(['冒険者ギルドへようこそ。どうする？']);
  });
});

describe('npcTalkPortrait', () => {
  it('絵の無い NPC は文字だけ (Blueskyちゃんでも同梱の絵に倒さない。J3)', () => {
    expect(npcTalkPortrait(homura)).toBeUndefined();
    const { portraitImage: _, ...plain } = bluesky();
    expect(npcTalkPortrait(plain)).toBeUndefined();
  });

  it('絵のある NPC は自分の絵', () => {
    expect(npcTalkPortrait({ ...homura, portraitImage })).toEqual({ src: expect.stringContaining('npcId=homura-guild'), name: 'ほむら' });
  });
});
