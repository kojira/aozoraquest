import type { ReactNode } from 'react';
import type { Archetype } from '@aozoraquest/core';
import { JOBS_BY_ID } from '@aozoraquest/core';

/**
 * ジョブごとに合う装備アイコンを返す。
 * - primary: 右下に重ねるメインの装備
 * - secondary: 左上に重ねる副装備 (任意)
 * - accentColor: Avatar のリング色。各ジョブの最大ステ軸の色に寄せる。
 */
export interface JobEquipment {
  primary: ReactNode;
  secondary?: ReactNode;
  accentColor: string;
}

// 便利関数: 単一 svg を size=100 の正方 viewBox で返す
function svg(children: ReactNode): ReactNode {
  return (
    <svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      {children}
    </svg>
  );
}

// よく使うパス (色は CSS currentColor を推奨、ここはフィルム的に指定)

// 黒の縁取り (どんな背景でも輪郭が切れない)
const OUTLINE = '#0a1528';
const OUTLINE_W = 4.5;
const HIGHLIGHT = '#ffffff';

const sword = (color: string) =>
  svg(
    <g stroke={OUTLINE} strokeWidth={OUTLINE_W} strokeLinejoin="round">
      {/* 柄 */}
      <rect x="40" y="68" width="20" height="14" rx="2" fill="#6a3a10" />
      <rect x="32" y="64" width="36" height="8" fill="#b87a1e" />
      <rect x="42" y="82" width="16" height="8" fill="#a06b32" />
      {/* 刃 */}
      <polygon points="43,62 57,62 55,14 50,6 45,14" fill={color} />
      {/* 刃のハイライト */}
      <polygon points="48,60 50,16 52,60" fill={HIGHLIGHT} stroke="none" opacity="0.75" />
    </g>,
  );

const shield = (color: string) =>
  svg(
    <g stroke={OUTLINE} strokeWidth={OUTLINE_W} strokeLinejoin="round">
      <path d="M 50 8 L 88 22 L 84 58 Q 78 82 50 94 Q 22 82 16 58 L 12 22 Z" fill={color} />
      <path d="M 50 22 L 72 30 L 70 56 Q 66 70 50 78 Q 34 70 30 56 L 28 30 Z" fill="rgba(255,255,255,0.3)" stroke="rgba(255,255,255,0.65)" strokeWidth="2" />
      <path d="M 50 35 L 58 60 L 42 60 Z" fill={HIGHLIGHT} stroke="none" opacity="0.85" />
    </g>,
  );

const staff = (color: string) =>
  svg(
    <g stroke={OUTLINE} strokeWidth={OUTLINE_W} strokeLinejoin="round">
      <rect x="44" y="34" width="12" height="60" rx="2" fill="#6a3a10" />
      <circle cx="50" cy="22" r="18" fill={color} />
      <path d="M 50 10 l 3 9 l 9 0 l -7 5 l 3 9 l -8 -5 l -8 5 l 3 -9 l -7 -5 l 9 0 z" fill={HIGHLIGHT} stroke="none" />
    </g>,
  );

const book = (color: string) =>
  svg(
    <g stroke={OUTLINE} strokeWidth={OUTLINE_W} strokeLinejoin="round">
      <rect x="10" y="20" width="80" height="62" rx="4" fill={color} />
      <rect x="16" y="28" width="68" height="46" fill="#f7efd5" />
      <line x1="50" y1="26" x2="50" y2="76" stroke={OUTLINE} strokeWidth="3" />
      <line x1="24" y1="42" x2="46" y2="42" stroke="#5a3a15" strokeWidth="2.5" />
      <line x1="24" y1="52" x2="44" y2="52" stroke="#5a3a15" strokeWidth="2.5" />
      <line x1="54" y1="42" x2="76" y2="42" stroke="#5a3a15" strokeWidth="2.5" />
      <line x1="54" y1="52" x2="74" y2="52" stroke="#5a3a15" strokeWidth="2.5" />
    </g>,
  );

const feather = (color: string) =>
  svg(
    <g stroke={OUTLINE} strokeWidth={OUTLINE_W} strokeLinejoin="round">
      <path d="M 18 90 Q 32 58 56 32 Q 78 12 92 8 Q 86 30 74 50 Q 58 72 38 84 Z" fill={color} />
      <line x1="22" y1="86" x2="62" y2="44" stroke={OUTLINE} strokeWidth="2.5" />
    </g>,
  );

const musicNote = (color: string) =>
  svg(
    <g stroke={OUTLINE} strokeWidth={OUTLINE_W} strokeLinejoin="round">
      <ellipse cx="32" cy="80" rx="18" ry="12" fill={color} />
      <rect x="44" y="12" width="12" height="70" fill={color} />
      <path d="M 52 12 Q 82 16 82 40 L 82 34 Q 62 32 52 46 Z" fill={color} />
    </g>,
  );

const crystalBall = (color: string) =>
  svg(
    <g stroke={OUTLINE} strokeWidth={OUTLINE_W} strokeLinejoin="round">
      <circle cx="50" cy="48" r="36" fill={color} />
      <ellipse cx="38" cy="34" rx="12" ry="7" fill="rgba(255,255,255,0.75)" stroke="none" />
      <path d="M 14 86 Q 50 70 86 86 Q 72 94 50 94 Q 28 94 14 86" fill="#6a3a10" />
    </g>,
  );

const compass = (color: string) =>
  svg(
    <g stroke={OUTLINE} strokeWidth={OUTLINE_W} strokeLinejoin="round">
      <circle cx="50" cy="50" r="40" fill="#f7efd5" />
      <polygon points="50,14 60,50 50,54 40,50" fill={color} />
      <polygon points="50,86 60,50 50,46 40,50" fill="#c9d4e0" />
      <circle cx="50" cy="50" r="6" fill={OUTLINE} stroke="none" />
    </g>,
  );

const fist = (color: string) =>
  svg(
    <g stroke={OUTLINE} strokeWidth={OUTLINE_W} strokeLinejoin="round">
      <rect x="18" y="28" width="64" height="56" rx="14" fill={color} />
      <line x1="26" y1="46" x2="74" y2="46" strokeWidth="3" />
      <line x1="26" y1="62" x2="74" y2="62" strokeWidth="3" />
      <rect x="18" y="18" width="64" height="14" rx="4" fill="#a05515" />
    </g>,
  );

const fan = (color: string) =>
  svg(
    <g stroke={OUTLINE} strokeWidth={OUTLINE_W} strokeLinejoin="round">
      <path d="M 50 92 L 8 26 Q 50 8 92 26 Z" fill={color} />
      <line x1="50" y1="92" x2="24" y2="34" strokeWidth="2" />
      <line x1="50" y1="92" x2="36" y2="22" strokeWidth="2" />
      <line x1="50" y1="92" x2="64" y2="22" strokeWidth="2" />
      <line x1="50" y1="92" x2="76" y2="34" strokeWidth="2" />
    </g>,
  );

const starEpaulet = (color: string) =>
  svg(
    <g stroke={OUTLINE} strokeWidth={OUTLINE_W} strokeLinejoin="round">
      <rect x="16" y="42" width="68" height="26" rx="6" fill="#6a3a10" />
      <path d="M 50 18 l 6 14 l 15 0 l -12 9 l 5 15 l -14 -9 l -14 9 l 5 -15 l -12 -9 l 15 0 z" fill={color} />
    </g>,
  );

const bell = (color: string) =>
  svg(
    <g stroke={OUTLINE} strokeWidth={OUTLINE_W} strokeLinejoin="round">
      <path d="M 26 30 Q 26 14 50 14 Q 74 14 74 30 L 80 72 L 20 72 Z" fill={color} />
      <rect x="16" y="72" width="68" height="10" rx="3" fill="#3a2a15" />
      <circle cx="50" cy="84" r="7" fill={OUTLINE} stroke="none" />
    </g>,
  );

const twinSwords = (color: string) =>
  svg(
    <g stroke={OUTLINE} strokeWidth={OUTLINE_W} strokeLinejoin="round">
      <g transform="rotate(-22 50 50)">
        <rect x="40" y="72" width="20" height="14" rx="2" fill="#6a3a10" />
        <rect x="34" y="70" width="32" height="6" fill="#b87a1e" />
        <polygon points="43,66 57,66 55,14 50,6 45,14" fill={color} />
      </g>
      <g transform="rotate(22 50 50)">
        <rect x="40" y="72" width="20" height="14" rx="2" fill="#6a3a10" />
        <rect x="34" y="70" width="32" height="6" fill="#b87a1e" />
        <polygon points="43,66 57,66 55,14 50,6 45,14" fill={color} />
      </g>
    </g>,
  );

const windFeather = (color: string) =>
  svg(
    <g stroke={OUTLINE} strokeWidth={OUTLINE_W} strokeLinejoin="round">
      <path d="M 50 94 Q 26 72 22 38 Q 20 14 38 6 Q 52 24 60 52 Q 66 80 50 94 Z" fill={color} />
      <line x1="50" y1="94" x2="42" y2="28" strokeWidth="2.5" />
    </g>,
  );

// 軍配
const uchiwa = (color: string) =>
  svg(
    <g stroke={OUTLINE} strokeWidth={OUTLINE_W} strokeLinejoin="round">
      <rect x="44" y="50" width="12" height="42" fill="#3a2a15" />
      <ellipse cx="50" cy="34" rx="34" ry="30" fill={color} />
      <circle cx="50" cy="34" r="12" fill="#fff8e0" />
    </g>,
  );

// ─── ステ軸 → 色 ──────────────────────
const STAT_COLORS = {
  atk: 'var(--color-atk)',
  def: 'var(--color-def)',
  agi: 'var(--color-agi)',
  int: 'var(--color-int)',
  luk: 'var(--color-luk)',
} as const;

function dominantStat(arc: Archetype): keyof typeof STAT_COLORS {
  const job = JOBS_BY_ID[arc];
  const [atk, def, agi, int, luk] = job.stats;
  const entries: Array<[keyof typeof STAT_COLORS, number]> = [
    ['atk', atk!],
    ['def', def!],
    ['agi', agi!],
    ['int', int!],
    ['luk', luk!],
  ];
  entries.sort((a, b) => b[1] - a[1]);
  return entries[0]![0];
}

export function getJobEquipment(archetype: Archetype): JobEquipment {
  const ds = dominantStat(archetype);
  const accent = STAT_COLORS[ds];

  // 装備のメインカラー。彩度高め + 白っぽいハイライトが乗るように明るめを採用。
  const jobColor: Record<Archetype, string> = {
    sage: '#9d8aff',
    mage: '#d0b0ff',
    shogun: '#ff553d',
    bard: '#5ae0a4',
    seer: '#6aaaff',
    poet: '#ff9ad4',
    paladin: '#ffd84a',
    explorer: '#ffa545',
    warrior: '#d48a55',
    guardian: '#6aa8ff',
    fighter: '#ff6a45',
    dancer: '#ff7aa8',
    captain: '#ffc830',
    miko: '#ff5a92',
    gladiator: '#ff4a28',
    performer: '#ffb85a',
  };
  const c = jobColor[archetype];

  const map: Record<Archetype, JobEquipment> = {
    sage:      { primary: book(c),        secondary: feather('#d0d8e0'), accentColor: accent },
    mage:      { primary: staff(c),       accentColor: accent },
    shogun:    { primary: uchiwa(c),      accentColor: accent },
    bard:      { primary: musicNote(c),   secondary: feather('#e0b0ff'), accentColor: accent },
    seer:      { primary: crystalBall(c), accentColor: accent },
    poet:      { primary: feather(c),     accentColor: accent },
    paladin:   { primary: sword(c),       secondary: shield('#e8c34b'),  accentColor: accent },
    explorer:  { primary: compass(c),     accentColor: accent },
    warrior:   { primary: sword(c),       accentColor: accent },
    guardian:  { primary: shield(c),      accentColor: accent },
    fighter:   { primary: fist(c),        accentColor: accent },
    dancer:    { primary: fan(c),         accentColor: accent },
    captain:   { primary: starEpaulet(c), accentColor: accent },
    miko:      { primary: bell(c),        accentColor: accent },
    gladiator: { primary: twinSwords(c),  accentColor: accent },
    performer: { primary: windFeather(c), secondary: bell('#e8c34b'),    accentColor: accent },
  };
  return map[archetype];
}
