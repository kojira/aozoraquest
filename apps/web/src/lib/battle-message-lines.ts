import type { BattleState, TurnEvent } from '@aozoraquest/core';

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

/** 行ごとに 見せる HP (自分 + 敵ごと)。 */
export interface BattleLineHp { player: number; monsters: number[] }

export function battleHpOf(s: BattleState): BattleLineHp {
  return { player: s.player.hp, monsters: (s.enemies ?? [s.monster]).map((m) => m.hp) };
}

/**
 * battleMessageLines と 同じ 並びで、各行で 見せる HP を返す (#764)。イベントの 最後の 行
 * (分割の 後半 = ダメージ・回復の 行) で その イベントの hp (core が 直後に 記録) に 変える。
 * 最後の 行は 最終 state。hp の 無い 旧応答は 最後の 行まで before のまま (#757 の 挙動)。
 */
export function battleLineHps(events: readonly TurnEvent[], before: BattleLineHp, final: BattleLineHp): BattleLineHp[] {
  const out: BattleLineHp[] = [];
  let cur = before;
  for (const e of events) {
    const n = splitBattleLine(e.text).length;
    for (let i = 0; i < n; i++) {
      if (i === n - 1 && e.hp) cur = e.hp;
      out.push(cur);
    }
  }
  if (out.length > 0) out[out.length - 1] = final;
  return out;
}
