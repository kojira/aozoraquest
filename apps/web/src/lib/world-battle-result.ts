import { ITEMS } from '@aozoraquest/core';
import type { ServerAward } from '@/lib/world-server';

/**
 * 決着後の報酬メッセージ行 (経験値・素材・敗北・レベルアップ)。報酬を「同じ固定サイズの
 * メッセージ窓」に畳んで出す (別パネルを出すと枠がでかくなり認知負荷)。空になるのは
 * 実質「逃走 (fled = 経験値もドロップも無し)」のみで、その時は即マップへ戻す。
 */
export function battleResultLines(
  awarded: ServerAward,
  outcome: string,
  /** 敗北時に運ばれた街の名前 (分からなければ null)。 */
  loseTownName: string | null,
): string[] {
  const drops = awarded.drops ?? [];
  const lost = awarded.materialsLost ?? [];
  const dropCounts = new Map<string, number>();
  for (const d of drops) dropCounts.set(d, (dropCounts.get(d) ?? 0) + 1);
  const lostCounts = new Map<string, number>();
  for (const d of lost) lostCounts.set(d, (lostCounts.get(d) ?? 0) + 1);
  const nameOf = (id: string) => ITEMS[id]?.name ?? id;
  const resultLines: string[] = [];
  // **パワー不足で報酬が出なかったことを必ず言う**。
  // 黙って何も起きないと「経験値が入ったように見えて実は入っていない」になる。
  if (awarded.unrewarded) {
    resultLines.push('あおぞらパワーが たりなかった…');
    resultLines.push('けいけんちも そざいも えられなかった。');
    resultLines.push('とうこう すると パワーが たまる。');
  }
  if (awarded.xp && awarded.xp > 0) resultLines.push(`けいけんち を ${awarded.xp} かくとく！`);

  for (const [id, n] of dropCounts) resultLines.push(`${nameOf(id)}${n > 1 ? ` ×${n}` : ''} を てにいれた！`);
  for (const [id, n] of lostCounts) resultLines.push(`${nameOf(id)}${n > 1 ? ` ×${n}` : ''} を おとしてしまった…`);
  if (outcome === 'lose') {
    resultLines.push(loseTownName ? `たおれてしまった… 気がつくと「${loseTownName}」で 手当てされていた。` : 'たおれてしまった… 気がつくと 街で 手当てされていた。');
  }
  // 敵に逃げられた: 悔しさを一言で残す (無言でマップへ戻さない)。
  if (outcome === 'monster-fled') resultLines.push('あいてに にげられてしまった…');
  // レベルアップは**最後**に出す。DQ は「経験値 → アイテム → レベルアップ」の順で、
  // レベルアップが締めになる。負けでも僅かな XP で上がりうるので、その場合は
  // 「たおれてしまった…」の後 = 「力がみなぎった直後に倒れる」順序を避ける。
  if (awarded.leveledUp) {
    const lv = awarded.leveledUp;
    resultLines.push(`レベルが ${lv.to} に あがった！`);
    // **上がった数値は 1 行にまとめる**。1 ステータス 1 行にすると 7 行になり、メッセージ窓は
    // 実測 5 行しか見えないので、**肝心の「おぼえた!」「きずが いえた!」が窓の外へ
    // 押し出されて誰も読めない** (タップ 1 回でマップに戻るので二度と読めない)。
    // 数値は全部出しつつ、窓に収める。
    const gains = lv.gains ?? [];
    if (gains.length) resultLines.push(gains.map((g) => `${g.label}+${g.delta}`).join('　'));
    // 覚えたとくぎ。気づかないと使われないので必ず出す。
    for (const name of lv.learned ?? []) resultLines.push(`${name} を おぼえた！`);
    resultLines.push('きずが すっかり いえた！');
  }
  return resultLines;
}
