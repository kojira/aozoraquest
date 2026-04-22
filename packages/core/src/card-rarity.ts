/**
 * カードのレアリティ (6 段階) と出現率。
 * 引き直すたびに rollRarity で決まり、PDS に保存される。
 * 希少度が高いほど LLM に珍しい能力を書かせる (色もゴージャスになる)。
 */

export const RARITIES = ['common', 'uncommon', 'rare', 'srare', 'ssr', 'ur'] as const;
export type Rarity = (typeof RARITIES)[number];

/** 出現率 (合計 100)。ガチャ相場に準拠した感覚値。 */
export const RARITY_DROP_RATES: Record<Rarity, number> = {
  common: 55,
  uncommon: 25,
  rare: 12,
  srare: 5,
  ssr: 2.5,
  ur: 0.5,
};

export const RARITY_LABEL: Record<Rarity, string> = {
  common: 'コモン',
  uncommon: 'アンコモン',
  rare: 'レア',
  srare: 'Sレア',
  ssr: 'SSR',
  ur: 'UR',
};

export const RARITY_SHORT: Record<Rarity, string> = {
  common: 'C',
  uncommon: 'UC',
  rare: 'R',
  srare: 'SR',
  ssr: 'SSR',
  ur: 'UR',
};

/** 希少度別の色 (カードのレアリティバッジ用)。 */
export const RARITY_COLOR: Record<Rarity, string> = {
  common: '#7a7066',
  uncommon: '#4c7a5a',
  rare: '#5c7aa8',
  srare: '#9e60c0',
  ssr: '#c49833',
  ur: '#c93c6a',
};

/** LLM プロンプトに渡す「希少度の雰囲気」ガイド文。 */
export const RARITY_GUIDANCE: Record<Rarity, string> = {
  common: '地に足のついた、誰もが持ちうる身近な能力。派手さは無いが確かな性質。',
  uncommon: '少し珍しい、日々の中にたまに光る得意技。場を動かすほどではない。',
  rare: '目に見えて輝く技量。特定の場面で確実に力を発揮する。',
  srare: '特殊な力。敵味方に明らかな影響を与え、物語を動かす。',
  ssr: '伝説級の力。場そのものを支配し、周囲の理に干渉する。',
  ur: '神話級。世界の理を一時的に書き換えるほどの、極めて稀有な力。',
};

/** 0..1 の seed (or undefined でランダム) から rarity を抽選。 */
export function rollRarity(seed?: number): Rarity {
  const r = (seed === undefined ? Math.random() : Math.abs(seed) % 1) * 100;
  let cum = 0;
  for (const rarity of RARITIES) {
    cum += RARITY_DROP_RATES[rarity];
    if (r < cum) return rarity;
  }
  return 'common';
}

export function isRarity(s: unknown): s is Rarity {
  return typeof s === 'string' && (RARITIES as readonly string[]).includes(s);
}
