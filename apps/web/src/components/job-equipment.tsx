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

const sword = (color: string) =>
  svg(
    <g>
      {/* 柄 */}
      <rect x="44" y="68" width="12" height="10" rx="2" fill="#3a2a15" />
      <rect x="38" y="66" width="24" height="5" fill="#3a2a15" />
      <rect x="44" y="78" width="12" height="6" fill="#a06b32" />
      {/* 刃 (斜め) */}
      <polygon points="46,64 54,64 52,18 50,12 48,18" fill={color} stroke="#e8f1ff" strokeWidth="1.5" />
    </g>,
  );

const shield = (color: string) =>
  svg(
    <g>
      <path d="M 50 10 L 85 22 L 82 58 Q 78 80 50 92 Q 22 80 18 58 L 15 22 Z" fill={color} stroke="#1c2b44" strokeWidth="3" />
      <path d="M 50 24 L 70 30 L 68 55 Q 66 68 50 76 Q 34 68 32 55 L 30 30 Z" fill="rgba(255,255,255,0.2)" stroke="rgba(255,255,255,0.5)" strokeWidth="1.5" />
    </g>,
  );

const staff = (color: string) =>
  svg(
    <g>
      <rect x="46" y="30" width="8" height="62" rx="2" fill="#5a3a1a" />
      <circle cx="50" cy="22" r="14" fill={color} stroke="#e8f1ff" strokeWidth="2" />
      <path d="M 50 14 l 2 6 l 6 0 l -5 4 l 2 6 l -5 -4 l -5 4 l 2 -6 l -5 -4 l 6 0 z" fill="#fffbe0" />
    </g>,
  );

const book = (color: string) =>
  svg(
    <g>
      <rect x="14" y="22" width="72" height="58" rx="4" fill={color} stroke="#1c2b44" strokeWidth="3" />
      <rect x="20" y="30" width="60" height="42" fill="#f7efd5" />
      <line x1="50" y1="28" x2="50" y2="76" stroke="#b39050" strokeWidth="2" />
      <line x1="28" y1="42" x2="46" y2="42" stroke="#7a5a25" strokeWidth="1.5" />
      <line x1="28" y1="50" x2="44" y2="50" stroke="#7a5a25" strokeWidth="1.5" />
      <line x1="54" y1="42" x2="72" y2="42" stroke="#7a5a25" strokeWidth="1.5" />
      <line x1="54" y1="50" x2="70" y2="50" stroke="#7a5a25" strokeWidth="1.5" />
    </g>,
  );

const feather = (color: string) =>
  svg(
    <g>
      <path
        d="M 20 88 Q 36 60 58 36 Q 76 20 86 14 Q 80 32 70 48 Q 58 68 40 82 Z"
        fill={color}
        stroke="#1c2b44"
        strokeWidth="2"
      />
      <line x1="22" y1="86" x2="60" y2="48" stroke="rgba(28,43,68,0.6)" strokeWidth="1.5" />
    </g>,
  );

const musicNote = (color: string) =>
  svg(
    <g>
      <ellipse cx="34" cy="80" rx="14" ry="10" fill={color} stroke="#1c2b44" strokeWidth="3" />
      <rect x="46" y="16" width="8" height="66" fill={color} stroke="#1c2b44" strokeWidth="2" />
      <path d="M 54 16 Q 78 20 78 36 L 78 32 Q 62 30 54 40 Z" fill={color} stroke="#1c2b44" strokeWidth="2" />
    </g>,
  );

const crystalBall = (color: string) =>
  svg(
    <g>
      <circle cx="50" cy="50" r="34" fill={color} stroke="#1c2b44" strokeWidth="3" opacity="0.8" />
      <ellipse cx="40" cy="38" rx="10" ry="6" fill="rgba(255,255,255,0.6)" />
      <path d="M 18 86 Q 50 74 82 86 Q 70 92 50 92 Q 30 92 18 86" fill="#5a3a1a" />
    </g>,
  );

const compass = (color: string) =>
  svg(
    <g>
      <circle cx="50" cy="50" r="36" fill="#efe4c8" stroke="#3a2a15" strokeWidth="4" />
      <circle cx="50" cy="50" r="4" fill="#1c2b44" />
      <polygon points="50,18 56,50 50,52 44,50" fill={color} />
      <polygon points="50,82 56,50 50,48 44,50" fill="#c9d4e0" />
      <text x="50" y="15" fontSize="10" textAnchor="middle" fill="#1c2b44" fontWeight="700">N</text>
    </g>,
  );

const fist = (color: string) =>
  svg(
    <g>
      <rect x="22" y="28" width="56" height="50" rx="12" fill={color} stroke="#1c2b44" strokeWidth="3" />
      <line x1="30" y1="44" x2="70" y2="44" stroke="#1c2b44" strokeWidth="2" />
      <line x1="30" y1="58" x2="70" y2="58" stroke="#1c2b44" strokeWidth="2" />
      <rect x="22" y="20" width="56" height="10" rx="4" fill="#7a5a25" />
    </g>,
  );

const fan = (color: string) =>
  svg(
    <g>
      <path d="M 50 90 L 10 30 Q 50 10 90 30 Z" fill={color} stroke="#1c2b44" strokeWidth="3" />
      <line x1="50" y1="90" x2="26" y2="36" stroke="rgba(28,43,68,0.4)" strokeWidth="1.5" />
      <line x1="50" y1="90" x2="38" y2="26" stroke="rgba(28,43,68,0.4)" strokeWidth="1.5" />
      <line x1="50" y1="90" x2="62" y2="26" stroke="rgba(28,43,68,0.4)" strokeWidth="1.5" />
      <line x1="50" y1="90" x2="74" y2="36" stroke="rgba(28,43,68,0.4)" strokeWidth="1.5" />
    </g>,
  );

const starEpaulet = (color: string) =>
  svg(
    <g>
      <rect x="20" y="40" width="60" height="24" rx="6" fill="#6a4820" stroke="#1c2b44" strokeWidth="3" />
      <path d="M 50 32 l 4 10 l 11 0 l -9 7 l 3 11 l -9 -7 l -9 7 l 3 -11 l -9 -7 l 11 0 z" fill={color} stroke="#1c2b44" strokeWidth="2" />
    </g>,
  );

const bell = (color: string) =>
  svg(
    <g>
      <path d="M 30 30 Q 30 16 50 16 Q 70 16 70 30 L 74 70 L 26 70 Z" fill={color} stroke="#1c2b44" strokeWidth="3" />
      <rect x="22" y="70" width="56" height="8" rx="3" fill="#3a2a15" />
      <circle cx="50" cy="82" r="6" fill="#1c2b44" />
    </g>,
  );

const twinSwords = (color: string) =>
  svg(
    <g>
      <g transform="rotate(-20 50 50)">
        <rect x="44" y="74" width="12" height="10" rx="2" fill="#3a2a15" />
        <rect x="40" y="74" width="20" height="4" fill="#3a2a15" />
        <polygon points="46,70 54,70 52,14 50,8 48,14" fill={color} stroke="#e8f1ff" strokeWidth="1.5" />
      </g>
      <g transform="rotate(20 50 50)">
        <rect x="44" y="74" width="12" height="10" rx="2" fill="#3a2a15" />
        <rect x="40" y="74" width="20" height="4" fill="#3a2a15" />
        <polygon points="46,70 54,70 52,14 50,8 48,14" fill={color} stroke="#e8f1ff" strokeWidth="1.5" />
      </g>
    </g>,
  );

const windFeather = (color: string) =>
  svg(
    <g>
      <path
        d="M 50 92 Q 30 72 26 40 Q 24 20 38 10 Q 50 28 56 52 Q 62 78 50 92 Z"
        fill={color}
        stroke="#1c2b44"
        strokeWidth="2.5"
      />
      <line x1="50" y1="92" x2="42" y2="32" stroke="rgba(28,43,68,0.5)" strokeWidth="1.5" />
    </g>,
  );

// 軍配 (うちわ形)
const uchiwa = (color: string) =>
  svg(
    <g>
      <rect x="46" y="48" width="8" height="40" fill="#3a2a15" />
      <ellipse cx="50" cy="34" rx="30" ry="26" fill={color} stroke="#1c2b44" strokeWidth="3" />
      <text x="50" y="42" fontSize="22" textAnchor="middle" fill="#1c2b44" fontWeight="900">◯</text>
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

  // 装備色: accent を貫くか、ジョブ雰囲気に合う色を選ぶ
  const jobColor: Record<Archetype, string> = {
    sage: '#6e5ae8',
    mage: '#b08cff',
    shogun: '#c84631',
    bard: '#62c5a0',
    seer: '#7aa0e8',
    poet: '#d88cd6',
    paladin: '#e8c34b',
    explorer: '#e8a452',
    warrior: '#a86a3a',
    guardian: '#4c7cc4',
    fighter: '#c45a3a',
    dancer: '#f07aa0',
    captain: '#d4a017',
    miko: '#d85a7a',
    gladiator: '#b53a1f',
    performer: '#ff9a3a',
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
