/**
 * 戦闘のメッセージ窓の 1 行に合わせて鳴らす効果音 (D-SOUND-001 §4)。
 * 行は battleMessageLines で分けたあとの文 (「会心の一撃!! 〜に 5 のダメージ」「HPが12回復。」など)。
 * 主語のない後半の行は、直前の行 (行動の行) を見て、だれの行動かを決める。
 */
import type { SeId } from './se';

/** line: いまの行。actor: その行の行動をしたのは味方か敵か。 */
export function battleLineSe(line: string, actor: 'player' | 'monster' = 'player'): SeId | null {
  if (/をたおした!/.test(line)) return 'defeat';
  if (/[HM]Pが\d+回復/.test(line)) return 'heal';
  if (/会心の一撃/.test(line)) return 'critical';
  if (/\d+ ?のダメージ/.test(line)) return actor === 'monster' ? 'damage' : 'hit';
  if (/の魔法!$|呪文/.test(line)) return 'spell';
  return null;
}
