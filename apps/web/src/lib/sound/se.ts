/**
 * あおぞらワールドの効果音 (D-SOUND-001)。曲と同じ書き方・同じ音源で作る (短い ChipSong)。
 * 効果音は 1 つずつ短いので、ブラウザでは最初に鳴らしたときに PCM にして覚えておく。
 */
import type { ChipSong } from './chip-synth';

const se = (id: string, tempo: number, ch: Omit<ChipSong, 'id' | 'tempo'>): ChipSong => ({ id, tempo, ...ch });

export const SE = {
  /** カーソルを動かす */
  cursor: se('cursor', 240, { pulse1: '@1 v9 q6 o6 e32' }),
  /** 選ぶ (メニューの項目) */
  select: se('select', 240, { pulse1: '@1 v10 q7 o6 c32 g32' }),
  /** 決定 */
  confirm: se('confirm', 200, { pulse1: '@2 v11 q7 l32 o5 g o6 c e g16' }),
  /** キャンセル・もどる */
  cancel: se('cancel', 200, { pulse1: '@1 v10 q7 l32 o6 c o5 g e16' }),
  /** こうげきが当たる */
  hit: se('hit', 150, { noise: 'v13 q4 o6 ^-24 c16', pulse1: '@0 v9 q4 o4 ^-12 c16' }),
  /** かいしんの一撃 */
  critical: se('critical', 150, {
    pulse1: '@0 v11 q8 l32 o6 ^12 c ^0 r ^-24 o5 c8',
    noise: 'v15 q6 l32 r r o7 ^-36 c8',
  }),
  /** じゅもん */
  spell: se('spell', 160, { pulse1: '@1 v10 q8 o5 ^24 c4', pulse2: '@3 v6 q8 r32 o5 ^24 e8.. ' }),
  /** かいふく */
  heal: se('heal', 180, { pulse1: '@2 v10 q7 l32 o5 c e g o6 c e g o7 c16', triangle: 'v12 q8 l16 o4 c e g o5 c' }),
  /** ダメージを受ける */
  damage: se('damage', 150, { noise: 'v14 q6 l16 o4 ^-12 c c', pulse1: '@3 v10 q8 l16 o3 ^-6 b- r' }),
  /** 敵をたおした */
  defeat: se('defeat', 150, { noise: 'v12 q8 o5 ^-24 c4', pulse1: '@0 v8 q8 o5 ^-24 c4' }),
  /** アイテムを手に入れた */
  item: se('item', 180, { pulse1: '@2 v11 q7 l16 o5 a o6 c+ e a4', triangle: 'v12 q7 l16 o3 a o4 c+ e a4' }),
  /** たからばこを開ける */
  chest: se('chest', 180, {
    noise: 'v10 q3 l32 o3 c r c r r16 r4',
    pulse1: '@1 v10 q7 l32 r r r r o5 g o6 c d+ g4',
  }),
  /** とびら・かいだん */
  door: se('door', 200, { pulse1: '@2 v9 q6 l32 o4 ^-3 c r ^0 e r ^-3 g8', noise: 'v6 q2 l32 o3 c r c r r8' }),
  /** すすめない (壁にぶつかる) */
  blocked: se('blocked', 160, { pulse1: '@2 v10 q5 o2 ^-2 g16' }),
  /** 買う・売る (お金) */
  coin: se('coin', 220, { pulse1: '@1 v10 q7 o6 b32 o7 e8' }),
} as const;

export type SeId = keyof typeof SE;
