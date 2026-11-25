/**
 * 戦闘のメッセージ窓の 1 行に合わせて鳴らす効果音 (D-SOUND-001 §4)。
 * 行は battleMessageLines で分けたあとの文 (「〜に 5 のダメージ」「HPが12回復。」など)。
 */
import type { SeId } from './se';

export function battleLineSe(line: string): SeId | null {
  if (/[HM]Pが\d+回復/.test(line)) return 'heal';
  if (/\d+ ?のダメージ/.test(line)) return 'hit';
  return null;
}
