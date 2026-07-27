/**
 * DQ 風セリフウィンドウの進行ロジック (純関数)。
 *
 * 「話者名 + セリフを 1 文字ずつ表示」 の状態機械。
 * コンポーネント (dialogue-window.tsx) は interval でこの tick を回し、
 * タップで advance を呼ぶだけの薄いレンダラーにする — テスト環境が node
 * (DOM なし) なので、進行の正しさはここで担保する。
 *
 * 進行の流れ (DQ の会話送りと同じ):
 *   タイプ中にタップ → その行を全文表示 (せっかちスキップ)
 *   全文表示中にタップ → 次の行へ (最後の行なら done)
 */

export interface DialogueLine {
  /** 話者名 (名前プレートに出す)。省略時はプレートなし (地の文) */
  speaker?: string;
  text: string;
}

export interface DialogueState {
  /** 表示中の行 index */
  index: number;
  /** 表示済み文字数 (0 〜 text.length) */
  chars: number;
  /** 全行を送り終えた */
  done: boolean;
}

export function startDialogue(): DialogueState {
  return { index: 0, chars: 0, done: false };
}

/** code point 単位の文字数 (サロゲートペア = 絵文字を 1 文字と数える)。
 *  code unit (String.length) 基準だと 🗺 等が半欠けの壊れグリフで 1 tick
 *  表示される (レビュー指摘)。chars はすべてこの単位。 */
export function charCount(text: string): number {
  return Array.from(text).length;
}

/** タイプ途中の表示文字列 (code point 単位で先頭 chars 文字) */
export function visibleText(text: string, chars: number): string {
  return Array.from(text).slice(0, chars).join('');
}

export function currentLine(lines: readonly DialogueLine[], st: DialogueState): DialogueLine | null {
  return lines[st.index] ?? null;
}

/** 表示中の行が全文表示済みか */
export function lineComplete(lines: readonly DialogueLine[], st: DialogueState): boolean {
  const line = lines[st.index];
  return !!line && st.chars >= charCount(line.text);
}

/** 1 文字進める (interval から呼ぶ)。全文表示済み・done なら何もしない */
export function tickDialogue(lines: readonly DialogueLine[], st: DialogueState): DialogueState {
  if (st.done || lineComplete(lines, st)) return st;
  return { ...st, chars: st.chars + 1 };
}

/** タップ: タイプ中なら全文表示、全文表示済みなら次の行 (最後なら done) */
export function advanceDialogue(lines: readonly DialogueLine[], st: DialogueState): DialogueState {
  if (st.done) return st;
  const line = lines[st.index];
  if (!line) return { ...st, done: true };
  if (st.chars < charCount(line.text)) return { ...st, chars: charCount(line.text) };
  if (st.index + 1 >= lines.length) return { ...st, done: true };
  return { index: st.index + 1, chars: 0, done: false };
}
