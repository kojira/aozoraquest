/** JobCard のレイアウト定数・配色・rarity / 色別の枠スタイル定義。 */

import type { Color, Rarity } from '@aozoraquest/core';

export const W = 768;
export const H = 1100;

export const PADX = 36;
export const PADY = 36;

// 各セクションの height / y 座標
export const TITLE_Y = PADY;                  // 36
export const TITLE_H = 72;
export const ART_Y = TITLE_Y + TITLE_H + 8;   // 116
export const ART_H = 456;
export const TYPE_Y = ART_Y + ART_H + 10;     // 582
export const TYPE_H = 56;
export const BODY_Y = TYPE_Y + TYPE_H + 10;   // 648
export const BODY_H = H - BODY_Y - PADY - 20; // 20 は footer 分
export const FOOTER_Y = H - PADY - 4;
export const PT_W = 100;
export const PT_H = 60;

// 配色
export const INK = '#2a1a08';            // 主要なインク色 (強め)
export const INK_SOFT = '#5a3f1d';
export const PANEL_FILL = 'rgba(246, 236, 208, 0.94)';  // クリーム (rarity 色がうっすら透けるバランス)
export const PANEL_STROKE = '#4a3416';
export const FRAME_OUTER = '#0e0600';    // カード最外周の縁 (純黒に近い深い焦げ茶)
export const ACCENT = '#7a5220';         // 金寄り

/**
 * rarity 別の枠スタイル。
 * - bodyGradId: 枠の主色 (multi-stop メタリック)
 * - shimmer: 上に重ねるシマー層 (複数可、UR/SSR は 2 重で深みを出す)
 * - trimId: 外側ダブルラインの色 (silver / gold / rainbow)
 * - sparkleCount: 枠帯にちりばめる星の数 (上位レアほど多い)
 * - bigSparkles: 大粒の + 字型スパークルを混ぜるか (SSR/UR のみ)
 */
type RarityFrameStyle = {
  bodyGradId: string;
  shimmer: Array<{ id: string; opacity: number }>;
  trimId: 'silverTrim' | 'goldTrim' | 'rainbowTrim';
  sparkleCount: number;
  bigSparkles: boolean;
};

/** frameColor (manaCost から派生) ごとの body gradient id。
 *  単色 → その色の枠、複数色 → gold、無色 → silver (colorless)。 */
export const COLOR_FRAME_STYLES: Record<'colorless' | Color | 'gold', { bodyGradId: string }> = {
  colorless: { bodyGradId: 'frameColorless' },
  W: { bodyGradId: 'frameW' },
  U: { bodyGradId: 'frameU' },
  B: { bodyGradId: 'frameB' },
  R: { bodyGradId: 'frameR' },
  G: { bodyGradId: 'frameG' },
  gold: { bodyGradId: 'frameGold' },
};

export const FRAME_STYLES: Record<Rarity, RarityFrameStyle> = {
  common:   { bodyGradId: 'commonGrad',   shimmer: [],                                              trimId: 'silverTrim', sparkleCount: 0,  bigSparkles: false },
  uncommon: { bodyGradId: 'uncommonGrad', shimmer: [],                                              trimId: 'silverTrim', sparkleCount: 0,  bigSparkles: false },
  rare:     { bodyGradId: 'rareGrad',     shimmer: [{ id: 'rareShimmer',  opacity: 0.22 }],         trimId: 'goldTrim',   sparkleCount: 0,  bigSparkles: false },
  srare:    { bodyGradId: 'srareGrad',    shimmer: [{ id: 'srareShimmer', opacity: 0.32 }],         trimId: 'goldTrim',   sparkleCount: 8,  bigSparkles: false },
  ssr:      { bodyGradId: 'ssrGrad',      shimmer: [{ id: 'ssrShimmer',   opacity: 0.45 },
                                                    { id: 'ssrShimmer2',  opacity: 0.30 }],         trimId: 'goldTrim',   sparkleCount: 20, bigSparkles: true  },
  ur:       { bodyGradId: 'urGrad',       shimmer: [{ id: 'urShimmer',    opacity: 0.55 },
                                                    { id: 'urShimmer2',   opacity: 0.40 }],         trimId: 'rainbowTrim', sparkleCount: 36, bigSparkles: true  },
};
