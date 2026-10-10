/**
 * 戦闘メッセージを DQ 風に 1 行ずつ止めるための行分け (#757)。
 *
 * core の 1 イベント = 1 文は「ゆうしゃのこうげき! スライムに 5 のダメージ」のように
 * 行動と結果が連結済み。文言は変えず、最初の「! 」(半角 ! + 空白) で 2 行に分ける。
 * 会心「! 会心の一撃!! …」・魔法「の魔法! …」・回避「! しかし …」・毒「のダメージ! N の
 * ダメージ」はどれも最初の「! 」が行動と結果の境目になる。割れ目が無ければ 1 行のまま。
 */
export function splitBattleLine(text: string): string[] {
  const at = text.indexOf('! ');
  if (at < 0) return [text];
  const head = text.slice(0, at + 1);
  const tail = text.slice(at + 2).trim();
  return tail ? [head, tail] : [text];
}

/** イベント文の列を、1 タップで 1 行ずつ出す行の列にする。 */
export function battleMessageLines(texts: readonly string[]): string[] {
  return texts.flatMap(splitBattleLine);
}
