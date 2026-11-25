/**
 * あおぞらワールドの効果音 (D-SOUND-001)。曲と同じ書き方・同じ音源で作る (短い ChipSong)。
 * 効果音は 1 つずつ短いので、ブラウザでは最初に鳴らしたときに PCM にして覚えておく。
 */
import type { ChipSong } from './chip-synth';

const se = (id: string, tempo: number, ch: Omit<ChipSong, 'id' | 'tempo'>): ChipSong => ({ id, tempo, ...ch });

export const SE = {
  /** 選ぶ (メニューの項目) */
  select: se('select', 240, { pulse1: '@1 v10 q7 o6 c32 g32' }),
  /** 決定 */
  confirm: se('confirm', 200, { pulse1: '@2 v11 q7 l32 o5 g o6 c e g16' }),
  /** キャンセル・もどる */
  cancel: se('cancel', 200, { pulse1: '@1 v10 q7 l32 o6 c o5 g e16' }),
  /** こうげきが当たる */
  hit: se('hit', 150, { noise: 'v13 q4 o6 ^-24 c16', pulse1: '@0 v9 q4 o4 ^-12 c16' }),
  /** かいふく */
  heal: se('heal', 180, { pulse1: '@2 v10 q7 l32 o5 c e g o6 c e g o7 c16', triangle: 'v12 q8 l16 o4 c e g o5 c' }),
} as const;

export type SeId = keyof typeof SE;
