/**
 * あおぞらワールドの曲 (D-SOUND-001)。すべてオリジナル。1 小節 = 4 拍。$ から最後までがループ。
 * いま入っているのは field と battle と、ジングルの levelup。
 */
import type { ChipSong } from './chip-synth';

/** フィールド「あおぞらの道」: ハ長調、はずむ 2 小節の前奏 + 8 小節のループ。 */
export const FIELD: ChipSong = {
  id: 'field',
  tempo: 128,
  pulse1: `@2 v11 q7 l8
    o5 g r g r g a b o6 c | o5 b2 g4 r4 | $
    o5 e4 g o6 c o5 b4 g4 | a4. g e4 c4 | f g a o6 c o5 a4 f4 | g4. a g4 d4 |
    e4 g o6 c e4 d c | o5 b4 g e g4 b4 | a o6 c o5 a f g b o6 d o5 b | o6 c2 o5 g4 r4 |`,
  pulse2: `@1 v6 q5 l8
    o4 [b o5 d]4 | o4 [b o5 d]2 o4 g4 r4 | $
    [o4 c e g e]2 | [o4 a o5 c e c]2 | [o4 a o5 c f c]2 | [o4 b o5 d g d]2 |
    [o4 g o5 c e c]2 | [o4 g b o5 e o4 b]2 | o4 a o5 c f c o4 b o5 d g d | o4 g o5 c e c c4 r4 |`,
  triangle: `v15 q6 l4
    o2 g r g r | g b g r | $
    o3 c g e g | o2 a o3 e c e | o2 f o3 c o2 a o3 c | o2 g o3 d o2 b o3 d |
    o3 c g e g | o2 e b g b | o2 f o3 c o2 g o3 d | o3 c g c2 |`,
  noise: `v6 l8
    k r h r k r s s | k h s h k k s s | $
    [k h s h k k s h]8`,
};

/** ふつうの戦闘「はれぞらバトル」: イ短調だが前のめりで明るめ。1 小節の前奏 + 8 小節のループ。 */
export const BATTLE: ChipSong = {
  id: 'battle',
  tempo: 168,
  pulse1: `@2 v11 q7 l8
    o5 e16 e16 e e16 e16 e e f g g+ | $
    o5 a a o6 c o5 a o6 e4 d c | o5 a4 f a o6 c4 o5 a4 | b b o6 d o5 b o6 g4 f d | e2 o5 a4 r4 |
    o6 e d c d e4 c4 | o5 a b o6 c d c4 o5 a4 | b o6 c d e d4 o5 b4 | g+4. a b2 |`,
  pulse2: `@1 v6 q5 l16
    r1 | $
    [o4 a o5 c e c]4 | [o4 a o5 c f c]4 | [o4 b o5 d g d]4 | [o4 a o5 c e c]4 |
    [o4 a o5 c e c]4 | [o4 a o5 c f c]4 | [o4 b o5 d g d]4 | [o4 g+ b o5 e o4 b]4 |`,
  triangle: `v15 q6 l8
    o2 e e e e e f g g+ | $
    [o2 a o3 a]4 | [o2 f o3 f]4 | [o2 g o3 g]4 | [o2 a o3 a]4 |
    [o2 a o3 a]4 | [o2 f o3 f]4 | [o2 g o3 g]4 | [o2 e o3 e]4 |`,
  noise: `v7 l8
    s s s s s16 s16 s16 s16 s4 | $
    [k h s h k h s h]7 | k s16 s16 s s16 s16 s s s s |`,
};

/** レベルアップ (ジングル、ループしない)。 */
export const LEVELUP: ChipSong = {
  id: 'levelup',
  tempo: 150,
  pulse1: `@2 v12 q7 l16
    o5 c e g o6 c o5 d f a o6 d o5 e g b o6 e f4 g2`,
  pulse2: `@1 v7 q7 l4
    r r r o5 a b2`,
  triangle: `v15 q7 l4
    o3 c d e f g2`,
  noise: `v5 l16
    [h]12 s4 k2`,
};

export const SONGS = { field: FIELD, battle: BATTLE, levelup: LEVELUP } as const;
export type SongId = keyof typeof SONGS;
