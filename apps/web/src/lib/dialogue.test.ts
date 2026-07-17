import { describe, expect, test } from 'vitest';
import { advanceDialogue, charCount, currentLine, lineComplete, startDialogue, tickDialogue, visibleText, type DialogueLine } from './dialogue';

const LINES: DialogueLine[] = [
  { speaker: 'ブルスコン', text: 'やあ!' },
  { text: 'じの ぶん。' },
];

describe('dialogue 進行 (DQ 風セリフ送り)', () => {
  test('tick で 1 文字ずつ進み、全文で止まる', () => {
    let st = startDialogue();
    st = tickDialogue(LINES, st);
    expect(st.chars).toBe(1);
    st = tickDialogue(LINES, st);
    st = tickDialogue(LINES, st);
    expect(st.chars).toBe(3);
    expect(lineComplete(LINES, st)).toBe(true);
    // 全文表示済みでは進まない (文字数がはみ出さない)
    expect(tickDialogue(LINES, st)).toBe(st);
  });

  test('タイプ中のタップは全文表示 (スキップ)、全文表示中のタップは次の行へ', () => {
    let st = startDialogue();
    st = tickDialogue(LINES, st); // 1 文字目
    st = advanceDialogue(LINES, st); // スキップ
    expect(st.chars).toBe(LINES[0]!.text.length);
    expect(st.index).toBe(0);
    st = advanceDialogue(LINES, st); // 次の行
    expect(st.index).toBe(1);
    expect(st.chars).toBe(0);
    expect(currentLine(LINES, st)!.speaker).toBeUndefined();
  });

  test('最後の行を送ると done になり、以降は不変', () => {
    let st = { index: 1, chars: LINES[1]!.text.length, done: false };
    st = advanceDialogue(LINES, st);
    expect(st.done).toBe(true);
    expect(advanceDialogue(LINES, st)).toBe(st);
    expect(tickDialogue(LINES, st)).toBe(st);
  });

  test('空配列でも落ちない (advance で即 done)', () => {
    const st = advanceDialogue([], startDialogue());
    expect(st.done).toBe(true);
  });
});

describe('サロゲートペア (絵文字) の扱い', () => {
  test('絵文字を 1 文字と数え、タイプ途中でも半欠けにならない', () => {
    const text = '🗺 ちず';
    expect(charCount(text)).toBe(4); // 🗺, 空白, ち, ず
    expect(visibleText(text, 1)).toBe('🗺'); // lone surrogate にならない
    const lines: DialogueLine[] = [{ text }];
    let st = startDialogue();
    for (let i = 0; i < 4; i++) st = tickDialogue(lines, st);
    expect(lineComplete(lines, st)).toBe(true); // code unit (5) でなく code point (4) で完了
  });
});
