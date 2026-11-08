import { describe, expect, test } from 'vitest';
import { npcDialogueLines } from '../npc-image';
import { scenarioDialogueLines, sceneDialogueLine, hereNpc } from '../scene-dialogue';
import { lineEmotion, lineSpeechText, npcVoice } from './tts-voice';

// D-TTS-001: only Blueskyちゃん speaks (data-driven: the NPC's bundled look `spritePreset: 'bluesky'`).
const futaba = { id: 'futaba-bluesky', name: '{c:bluesky}ちゃん', spritePreset: 'bluesky' as const, x: 1, y: 1, lines: ['やあ'] };
const elder = { id: 'futaba-elder', name: 'むらおさ', spritePreset: 'old-man' as const, x: 1, y: 1, lines: ['やあ'] };

describe('npcVoice (speaker gate)', () => {
  test('a Blueskyちゃん NPC has the bluesky voice; other NPCs and unknown looks have none', () => {
    expect(npcVoice(futaba)).toBe('bluesky');
    expect(npcVoice(elder)).toBeUndefined();
    expect(npcVoice({})).toBeUndefined(); // a name alone (no bluesky look) has no voice
  });
  test('npc lines carry the voice cue (with the expression tag); other speakers and narration do not', () => {
    const lines = npcDialogueLines(futaba, ['[sad][fx:fade-black]おにいちゃんが……', 'ふつう']);
    expect(lines.map((l) => l.voice)).toEqual([{ voice: 'bluesky', expression: 'sad' }, { voice: 'bluesky' }]);
    expect(npcDialogueLines(elder, ['やあ'])[0]!.voice).toBeUndefined();
    expect(sceneDialogueLine({ text: 'ここがギルドだよ。', here: true }, hereNpc(futaba), [futaba]).voice).toEqual({ voice: 'bluesky' });
    expect(sceneDialogueLine({ text: '少女はやくそうを取り出した。' }, undefined, [futaba]).voice).toBeUndefined();
    expect(sceneDialogueLine({ text: 'よかった！', npcId: 'futaba-bluesky' }, undefined, [futaba]).voice).toEqual({ voice: 'bluesky' });
    expect(scenarioDialogueLines([{ text: 'おかえり！', npcId: 'futaba-bluesky' }], [futaba])[0]!.voice).toEqual({ voice: 'bluesky' });
  });
});

describe('lineSpeechText', () => {
  test('reads the shown text but not stage directions in full-width brackets', () => {
    expect(lineSpeechText('（小さな声で）……ようこそ。')).toBe('……ようこそ。');
    expect(lineSpeechText('（ほかの町のBlueskyちゃんが、にこにこ手をふっている。）')).toBeNull();
    expect(lineSpeechText('  わたしはBluesky。  ')).toBe('わたしはBluesky。');
    expect(lineSpeechText('……')).toBeNull();
  });
});

describe('lineEmotion (deterministic rule)', () => {
  test('apology > sad > happy > neutral', () => {
    expect(lineEmotion('ずっと逆光で、ごめんね！')).toEqual({ apologetic: 70, neutral: 30 });
    expect(lineEmotion('すまない、遅れた。')).toEqual({ apologetic: 70, neutral: 30 });
    expect(lineEmotion('おにいちゃんが、いなくなっちゃったの。')).toEqual({ sad: 70, neutral: 30 });
    expect(lineEmotion('ふつうの文。', 'sad')).toEqual({ sad: 70, neutral: 30 });
    expect(lineEmotion('いらっしゃい！')).toEqual({ happy: 70, neutral: 30 });
    expect(lineEmotion('来てくれてうれしいな。')).toEqual({ happy: 70, neutral: 30 });
    expect(lineEmotion('ギルドへようこそ。')).toEqual({ neutral: 100 });
  });
});
