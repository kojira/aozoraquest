/**
 * あおぞらワールドの曲 (D-SOUND-001)。すべてオリジナル。1 小節 = 4 拍。$ から最後までがループ。
 * 場面の曲は field (地方で field2・field3)・town・title・battle・boss・final・victory・casino、ジングルは levelup・inn・defeat。
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

/** 街「ひだまりの広場」: ヘ長調、ゆったり 8 小節のループ。 */
export const TOWN: ChipSong = {
  id: 'town',
  tempo: 112,
  pulse1: `@1 v10 q7 l8 $
    o5 a4 o6 c o5 a g4 f4 | f e d e f4 a4 | b-4 a g f4 d4 | e f g a g2 |
    a4 o6 c d c4 o5 a4 | a g f g a4 d4 | d f b- a g a b- g | f2 r4 c4 |`,
  pulse2: `@2 v5 q4 l8 $
    [r o4 a r o5 c]2 | [r o4 f r a]2 | [r o4 f r b-]2 | [r o4 e r g]2 |
    [r o4 a r o5 c]2 | [r o4 f r a]2 | r o4 f r b- r e r g | r o4 a r o5 c o4 a4 r4 |`,
  triangle: `v14 q6 l4 $
    o2 f o3 c o2 a o3 c | o2 d a f a | o2 b- o3 f d f | o2 c g e g |
    o2 f o3 c o2 a o3 c | o2 d a f a | o2 b- o3 f o2 c g | o2 f o3 c o2 f2 |`,
  noise: `v4 l8 $
    [h h s h h h s h]8`,
};

/** ボス戦「くもまのあらし」: ニ短調、低い刻みと半音で迫る。1 小節の前奏 + 8 小節のループ。 */
export const BOSS: ChipSong = {
  id: 'boss',
  tempo: 176,
  pulse1: `@1 v11 q7 l8
    o4 a r a r a b- b o5 c+ | $
    o5 d4 a4 g+ a f4 | d f b- a g4 f4 | e g o6 c o5 b- a4 g4 | c+4. e a2 |
    o6 d4 c o5 b- a4 f4 | g a b- o6 c d4 o5 b-4 | b- a g f e f g c+ | d2 r4 o4 a4 |`,
  pulse2: `@2 v5 q5 l8
    r1 | $
    [o4 d a d o5 d]2 | [o4 d f b- f]2 | [o4 e g o5 c o4 g]2 | [o4 c+ e a e]2 |
    [o4 d a d o5 d]2 | [o4 d f b- f]2 | o4 d g b- g c+ e a e | [o4 d a d o5 d]2 |`,
  triangle: `v15 q5 l8
    o2 a r a r a b- b o3 c+ | $
    [o2 d]8 | [o1 b-]8 | [o2 c]8 | [o1 a]8 |
    [o2 d]8 | [o1 b-]8 | [o1 g]4 [o1 a]4 | [o2 d]8 |`,
  noise: `v8 l8
    k r k r s16 s16 s16 s16 s s | $
    [k h s k k h s h]7 | k s s16 s16 s s16 s16 s16 s16 s s |`,
};

/** 勝利「やったね!」: 4 小節のファンファーレ + 決着画面のあいだ流れる 4 小節のループ。 */
export const VICTORY: ChipSong = {
  id: 'victory',
  tempo: 140,
  pulse1: `@2 v12 q7 l8
    o5 g16 g16 g16 g16 o6 c4 o5 a b o6 c d | e4. d c4 e4 | f e d c o5 b4 g4 | o6 c4 o5 g4 o6 c4 r4 | $
    @1 v9 o5 e4 g4 a g e4 | f4 a4 o6 c o5 a f4 | d4 g4 b a g f | e4 d4 c2 |`,
  pulse2: `@1 v7 q7 l8
    o5 e16 e16 e16 e16 g4 f g a b | o6 c4. o5 b a4 o6 c4 | o5 a g f e d4 o4 b4 | o5 e4 d4 e4 r4 | $
    v5 q5 [o4 g o5 c e c]2 | [o4 a o5 c f c]2 | [o4 b o5 d g d]2 | [o4 g o5 c e c]2 |`,
  triangle: `v15 q6 l4
    o3 c r o2 f g | o3 c o2 g o3 c e | f d g o2 g | o3 c o2 g o3 c r | $
    o3 c2 o2 g2 | f2 o3 c2 | o2 g2 b2 | o3 c2 o2 g2 |`,
  noise: `v6 l8
    s16 s16 s16 s16 k4 k h s h | [k h s h]2 | [k h s h]2 | k4 s4 k4 r4 | $
    v4 [h r]16`,
};

/** 遠い地方 (tier 3–5)「かぜわたる丘」: ト長調、少し遠くまで来た広がり。2 小節の前奏 + 8 小節のループ。 */
export const FIELD2: ChipSong = {
  id: 'field2',
  tempo: 120,
  pulse1: `@1 v11 q7 l8
    o5 d4 g4 a4 b4 | o6 c4. o5 b a2 | $
    o5 b4. a g4 d4 | e g a b a4 g4 | o6 c4. o5 b a4 e4 | f+ g a b a2 |
    b4. o6 c d4 o5 b4 | o6 c o5 b a g e4 g4 | a b o6 c d e4 d4 | o5 g2. r4 |`,
  pulse2: `@2 v5 q5 l8
    [o4 g b o5 d o4 b]2 | [o4 a o5 c e c]2 | $
    [o4 g b o5 d o4 b]2 | [o4 e g b g]2 | [o4 a o5 c e c]2 | [o4 a o5 d f+ d]2 |
    [o4 g b o5 d o4 b]2 | [o4 e g o5 c o4 g]2 | o4 a o5 c e c o4 a o5 d f+ d | o4 g b o5 d o4 b g4 r4 |`,
  triangle: `v15 q6 l4
    o2 g o3 d o2 g o3 d | o2 a o3 e o2 a o3 e | $
    o2 g o3 d o2 b o3 d | o2 e b g b | o2 a o3 e c e | o2 d a f+ a |
    o2 g o3 d o2 b o3 d | o2 c g e g | o2 a o3 e o2 d a | o2 g o3 d o2 g2 |`,
  noise: `v5 l8
    k r h r s r h r | k r h r s s s s | $
    [k h h h s h k h]8`,
};

/** いちばん遠い地方 (tier 6–8)「はるかな雲の上」: ホ短調、高くて静かで少しこわい。8 小節のループ。 */
export const FIELD3: ChipSong = {
  id: 'field3',
  tempo: 104,
  pulse1: `@3 v10 q7 l8 $
    o5 e4. f+ g4 b4 | a4. g f+2 | e4. f+ g4 o6 c4 | o5 b2. r4 |
    o6 c4. o5 b a4 g4 | f+4. g a4 f+4 | g4 f+4 e4 d+4 | e2. r4 |`,
  pulse2: `@1 v5 q4 l8 $
    [o4 e g b g]2 | [o4 d f+ a f+]2 | [o4 c e g e]2 | [o4 d+ f+ b f+]2 |
    [o4 c e a e]2 | [o4 d f+ a f+]2 | o4 c e g e o3 b o4 d+ f+ d+ | [o4 e g b g]2 |`,
  triangle: `v14 q7 l2 $
    o2 e e | d d | c c | o1 b b |
    a a | o2 d d | c o1 b | o2 e e |`,
  noise: `v3 l8 $
    [h r h h s r h r]8`,
};

/** タイトル (はじめての開始)「あおぞらへ」: ハ長調、ゆっくり始まって広がる。2 小節の前奏 + 8 小節のループ。 */
export const TITLE: ChipSong = {
  id: 'title',
  tempo: 100,
  pulse1: `@2 v11 q8 l4
    o5 c g o6 c2 | o5 b2 g2 | $
    o5 e. f8 g o6 c | o5 b2 a2 | f. g8 a o6 d | o5 b1 |
    o6 c. o5 b8 a g | f2 e2 | d e f g | e1 |`,
  pulse2: `@1 v6 q6 l8
    o4 [c g o5 c o4 g]2 | o4 [d g b g]2 | $
    [o4 c e g e]2 | [o4 d f+ a f+]2 | [o4 c f a f]2 | [o4 d g b g]2 |
    [o4 e g o5 c o4 g]2 | [o4 c f a f]2 | [o4 d f a f]2 | [o4 c e g e]2 |`,
  triangle: `v15 q7 l2
    o3 c o2 g | g g | $
    o3 c o2 a | d d | f f | g g |
    a e | f c | d g | o3 c o2 c |`,
  noise: `v4 l4
    r r r s | r r s8 s8 s | $
    [k h s h]8`,
};

/** イービル・マスク「かめんの王」: ハ短調、速い刻みと半音の上下でいちばんこわい。1 小節の前奏 + 8 小節のループ。 */
export const FINAL: ChipSong = {
  id: 'final',
  tempo: 184,
  pulse1: `@1 v12 q7 l8
    o4 c c c c b- b- b b | $
    o5 c4 g4 f+ g e- c | d4 a-4 g f d o4 b | o5 c4 e-4 g4 o6 c4 | o5 b4. a- g2 |
    o6 c4 o5 b- a- g4 f4 | e- f g a- b-4 g4 | a- g f e- d e- f d | c2 r4 o4 g4 |`,
  pulse2: `@2 v6 q5 l16
    r1 | $
    [o4 c g o5 c o4 g]4 | [o4 d a- o5 d o4 a-]4 | [o4 e- g o5 c o4 g]4 | [o4 d g b g]4 |
    [o4 c g o5 c o4 g]4 | [o4 e- g b- g]4 | [o4 f a- o5 c o4 a-]2 [o4 d f a- f]2 | [o4 c g o5 c o4 g]4 |`,
  triangle: `v15 q5 l8
    o2 c c c c o1 b- b- b b | $
    [o2 c]8 | [o1 a-]8 | [o2 c]8 | [o1 g]8 |
    [o2 c]8 | [o2 e-]8 | [o1 f]4 [o1 g]4 | [o2 c]8 |`,
  noise: `v8 l8
    k k s s16 s16 k k s s | $
    [k h s k k s s h]7 | k s16 s16 s s s16 s16 s16 s16 s s |`,
};

/** カジノ「きらきらコイン」: ヘ長調、はねるリズムでにぎやか。8 小節のループ。 */
export const CASINO: ChipSong = {
  id: 'casino',
  tempo: 144,
  pulse1: `@2 v11 q5 l8 $
    o5 f r a r o6 c r o5 a o6 c | d c o5 a f g4 r4 | e r g r b- r g b- | o6 c o5 b- g e f4 r4 |
    a r o6 c r f r e d | c o5 a f a g4 c4 | d e f g a b- o6 c d | c4 o5 f4 r2 |`,
  pulse2: `@1 v6 q4 l8 $
    [r o4 a r o5 c]2 | [r o4 b- r o5 d]2 | [r o4 g r b-]2 | [r o4 a r o5 c]2 |
    [r o4 a r o5 c]2 | [r o4 a r o5 c]2 | [r o4 b- r o5 d]2 | r o4 a r o5 c o4 a4 r4 |`,
  triangle: `v15 q4 l8 $
    [o2 f r o3 c r]2 | [o2 b- r o3 f r]2 | [o2 c r g r]2 | [o2 f r o3 c r]2 |
    [o2 f r o3 c r]2 | [o2 d r a r]2 | o2 b- r o3 f r o2 c r g r | o2 f r o3 c r o2 f4 r4 |`,
  noise: `v5 l8 $
    [k h s h k h s s]8`,
};

/** 宿屋に泊まった (ジングル、ループしない): ゆっくり下りて、ほっとする終わり。 */
export const INN: ChipSong = {
  id: 'inn',
  tempo: 96,
  pulse1: `@1 v10 q7 l8
    o5 c e g o6 c4 o5 b a | g4 e4 f d | e2. r4 |`,
  pulse2: `@2 v5 q6 l4
    o4 e g a f | e c d o3 b | o4 c2. r |`,
  triangle: `v14 q7 l4
    o3 c e f d | c o2 a b g | o3 c2. r |`,
};

/** 戦闘に負けた (ジングル、ループしない): 下がっていく短い 2 小節。 */
export const DEFEAT: ChipSong = {
  id: 'defeat',
  tempo: 84,
  pulse1: `@2 v10 q7 l8
    o5 a g+ g f+ f4 e4 | d4. c+ d2 |`,
  pulse2: `@1 v5 q6 l4
    o4 f e d c | o3 b- a a2 |`,
  triangle: `v14 q7 l4
    o2 d c+ c o1 b | b- a o2 d2 |`,
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

export const SONGS = {
  field: FIELD, field2: FIELD2, field3: FIELD3, town: TOWN, title: TITLE, battle: BATTLE, boss: BOSS, final: FINAL, victory: VICTORY, casino: CASINO,
  levelup: LEVELUP, inn: INN, defeat: DEFEAT,
} as const;
/** ジングル (ループしない短い曲)。BGM を止めずに下げて鳴らす。 */
export const JINGLES = ['levelup', 'inn', 'defeat'] as const;
export type JingleId = (typeof JINGLES)[number];
/** 場面の曲 (ループする)。 */
export type SongId = Exclude<keyof typeof SONGS, JingleId>;
