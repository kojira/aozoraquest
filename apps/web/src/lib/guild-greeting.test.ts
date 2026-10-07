/** ギルドの初対面あいさつは受付 NPC ごと。絵の無い NPC は文字だけ (D-STORY-008)。 */
import { describe, expect, it } from 'vitest';
import { starterTownNpcs, type NpcDef } from '@aozoraquest/core';
import { guildEntryTalk, guildMetKey, npcTalkPortrait } from './guild-greeting';

const DID = 'did:plc:player';
const bluesky = (): NpcDef => starterTownNpcs().find((n) => n.id === 'futaba-bluesky')!;
const homura: NpcDef = { id: 'homura-guild', name: 'ほむら', mapId: 'homura-town', x: 5, y: 5, lines: ['よう。'], guildReception: true };

describe('guildMetKey', () => {
  it('futaba-bluesky は従来のキーのまま (会ったことのある人に再び出さない)', () => {
    expect(guildMetKey(DID, 'futaba-bluesky')).toBe(`aq-futaba-guild-met:${DID}`);
  });

  it('ほかの受付は NPC ごとの別キー (ふたばで会っても ほむらのあいさつは出る)', () => {
    expect(guildMetKey(DID, homura.id)).toBe(`aq-guild-met:${homura.id}:${DID}`);
    expect(guildMetKey(DID, homura.id)).not.toBe(guildMetKey(DID, 'futaba-bluesky'));
  });
});

describe('guildEntryTalk', () => {
  it('ふたばの初対面は従来どおり「村の」', () => {
    expect(guildEntryTalk(bluesky(), false).lines).toContain('ここが 村の 冒険者ギルドだよ。すこし やすんでいってね。');
  });

  it('ほかの受付は「村」と言わない', () => {
    const talk = guildEntryTalk(homura, false);
    expect(talk.guild).toBe('reunion');
    expect(talk.lines.join('')).not.toContain('村');
    expect(talk.lines).toContain('ここが この まちの 冒険者ギルドだよ。すこし やすんでいってね。');
  });

  it('2 回目以降は受付メニュー', () => {
    expect(guildEntryTalk(homura, true)).toMatchObject({ guild: 'menu', lines: ['おかえり。冒険者ギルドへ ようこそ。'] });
  });
});

describe('npcTalkPortrait', () => {
  it('絵の無い NPC はギルドでも Blueskyちゃんの絵に倒さない (文字だけ)', () => {
    expect(npcTalkPortrait(homura, true)).toBeUndefined();
    expect(npcTalkPortrait(homura, false)).toBeUndefined();
  });

  it('Blueskyちゃん本人は登録が無くても同梱の絵 (従来どおり)', () => {
    expect(npcTalkPortrait(bluesky(), true)?.name).toBe('Blueskyちゃん');
  });

  it('絵のある NPC は自分の絵', () => {
    const portraitImage = { blob: { $type: 'blob' as const, ref: { $link: 'bafkreiportrait' }, mimeType: 'image/webp' as const, size: 10 }, width: 512, height: 768 };
    expect(npcTalkPortrait({ ...homura, portraitImage }, true)).toEqual({ src: expect.stringContaining('npcId=homura-guild'), name: 'ほむら' });
  });
});
