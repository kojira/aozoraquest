import type { ReactNode } from 'react';
import type { Archetype } from '@aozoraquest/core';
import { JOBS_BY_ID } from '@aozoraquest/core';

/**
 * ジョブごとに合う装備アイコンを返す。
 * - crown: 頭上 (正面中央・上) に被せる兜 / 帽子の類
 * - body: 顔の下に重ねる衣装 (巫女装束など)。Avatar の face より後ろに描画
 * - primary: 右下コーナーの装備
 * - secondary: 左上コーナーの副装備
 * - leftSide: アイコン左 (キャラの右手) — 剣など攻撃側
 * - rightSide: アイコン右 (キャラの左手) — 盾など防御側
 * - accentColor: Avatar のリング色
 */
export interface JobEquipment {
  crown?: ReactNode;
  body?: ReactNode;
  primary?: ReactNode;
  secondary?: ReactNode;
  leftSide?: ReactNode;
  rightSide?: ReactNode;
  accentColor: string;
}

function svg(children: ReactNode): ReactNode {
  return (
    <svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      {children}
    </svg>
  );
}

/** 横長 viewBox (body レイヤー向け) */
function svgWide(children: ReactNode): ReactNode {
  return (
    <svg viewBox="0 0 100 50" xmlns="http://www.w3.org/2000/svg">
      {children}
    </svg>
  );
}

const OUTLINE = '#0a1528';
const OUTLINE_W = 4.5;
const HIGHLIGHT = '#ffffff';

/** 長剣: -25 度に傾けて viewBox を目一杯使う */
const sword = (color: string) =>
  svg(
    <g stroke={OUTLINE} strokeWidth={OUTLINE_W} strokeLinejoin="round" transform="rotate(-25 50 50)">
      {/* 柄 */}
      <rect x="38" y="70" width="24" height="20" rx="3" fill="#6a3a10" />
      {/* 鍔 */}
      <rect x="26" y="62" width="48" height="10" fill="#b87a1e" />
      {/* 柄頭 */}
      <rect x="40" y="88" width="20" height="8" rx="2" fill="#a06b32" />
      {/* 刃 (幅広めに) */}
      <polygon points="40,62 60,62 57,8 50,0 43,8" fill={color} />
      {/* 刃のハイライト */}
      <polygon points="47,60 50,10 53,60" fill={HIGHLIGHT} stroke="none" opacity="0.75" />
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

/** 拳: 画面手前に突き出した肌色のグー (knuckles toward viewer) */
const fist = () =>
  svg(
    <g stroke={OUTLINE} strokeWidth={OUTLINE_W} strokeLinejoin="round">
      {/* 手首の袖 */}
      <rect x="22" y="80" width="56" height="16" rx="3" fill="#6a3a10" />
      {/* 手のひら (メインの握り) */}
      <path d="M 18 40 Q 18 26 30 22 L 72 22 Q 84 26 84 40 L 84 72 Q 84 84 72 86 L 30 86 Q 18 84 18 72 Z" fill="#f4caa3" />
      {/* 親指 (左側から巻き込む) */}
      <path d="M 18 50 Q 2 48 6 66 Q 12 78 24 74 Z" fill="#f4caa3" />
      {/* 4 本の指の溝 */}
      <line x1="34" y1="28" x2="34" y2="72" strokeWidth="3" />
      <line x1="50" y1="28" x2="50" y2="72" strokeWidth="3" />
      <line x1="66" y1="28" x2="66" y2="72" strokeWidth="3" />
      {/* ナックル (4 つのふくらみ) */}
      <circle cx="26" cy="30" r="5" fill="#f8d6b0" stroke="none" />
      <circle cx="42" cy="30" r="5" fill="#f8d6b0" stroke="none" />
      <circle cx="58" cy="30" r="5" fill="#f8d6b0" stroke="none" />
      <circle cx="74" cy="30" r="5" fill="#f8d6b0" stroke="none" />
    </g>,
  );

/** 絵筆: 柄 + 金輪 + 穂先 (斜めに構えて動きを出す) */
const brush = (color: string) =>
  svg(
    <g stroke={OUTLINE} strokeWidth={OUTLINE_W} strokeLinejoin="round" transform="rotate(25 50 50)">
      {/* 柄 */}
      <rect x="44" y="40" width="12" height="54" rx="3" fill="#8a5a20" />
      {/* 金輪 */}
      <rect x="40" y="26" width="20" height="14" rx="2" fill="#c0a060" />
      {/* 穂先 */}
      <path d="M 42 26 Q 50 -2 58 26 Z" fill={color} />
      {/* 墨の滴 */}
      <circle cx="56" cy="4" r="5" fill={color} />
    </g>,
  );

/** パレット: 穴あきの楕円に絵の具のだま */
const palette = () =>
  svg(
    <g stroke={OUTLINE} strokeWidth={OUTLINE_W} strokeLinejoin="round">
      {/* 本体 */}
      <path d="M 14 46 Q 14 16 48 14 Q 82 16 86 40 Q 88 60 68 62 Q 76 72 70 82 Q 62 90 50 86 Q 34 82 22 72 Q 8 56 14 46 Z" fill="#f0ddb4" />
      {/* 親指穴 */}
      <ellipse cx="36" cy="52" rx="8" ry="6" fill="#3a2a15" stroke="none" />
      {/* 絵の具のだま */}
      <circle cx="58" cy="28" r="7" fill="#e04030" />
      <circle cx="76" cy="44" r="7" fill="#3070d0" />
      <circle cx="66" cy="64" r="7" fill="#60c040" />
      <circle cx="46" cy="76" r="7" fill="#ffd84a" />
    </g>,
  );

/** サイコロ (遊び人の象徴): 3 面見える等角投影 + ピップ */
const dice = (color: string) =>
  svg(
    <g stroke={OUTLINE} strokeWidth={OUTLINE_W} strokeLinejoin="round">
      {/* 天面 */}
      <path d="M 22 32 L 50 16 L 78 32 L 50 48 Z" fill="#ffffff" />
      {/* 右面 */}
      <path d="M 78 32 L 78 66 L 50 82 L 50 48 Z" fill={color} />
      {/* 左面 */}
      <path d="M 22 32 L 22 66 L 50 82 L 50 48 Z" fill="#d8d4c8" />
      {/* 天面ピップ (5) */}
      <circle cx="32" cy="30" r="2.8" fill={OUTLINE} stroke="none" />
      <circle cx="50" cy="20" r="2.8" fill={OUTLINE} stroke="none" />
      <circle cx="68" cy="30" r="2.8" fill={OUTLINE} stroke="none" />
      <circle cx="40" cy="38" r="2.8" fill={OUTLINE} stroke="none" />
      <circle cx="60" cy="38" r="2.8" fill={OUTLINE} stroke="none" />
      {/* 右面ピップ (3) */}
      <circle cx="62" cy="46" r="2.8" fill={OUTLINE} stroke="none" />
      <circle cx="64" cy="60" r="2.8" fill={OUTLINE} stroke="none" />
      <circle cx="66" cy="74" r="2.8" fill={OUTLINE} stroke="none" />
      {/* 左面ピップ (2) */}
      <circle cx="30" cy="48" r="2.8" fill={OUTLINE} stroke="none" />
      <circle cx="38" cy="70" r="2.8" fill={OUTLINE} stroke="none" />
    </g>,
  );

const starEpaulet = (color: string) =>
  svg(
    <g stroke={OUTLINE} strokeWidth={OUTLINE_W} strokeLinejoin="round">
      <rect x="16" y="42" width="68" height="26" rx="6" fill="#6a3a10" />
      <path d="M 50 18 l 6 14 l 15 0 l -12 9 l 5 15 l -14 -9 l -14 9 l 5 -15 l -12 -9 l 15 0 z" fill={color} />
    </g>,
  );

/** 巫女装束 (白衣 + 緋袴): 顔の下に重ねる衣装レイヤー (横長 viewBox) */
const mikoOutfit = () =>
  svgWide(
    <g stroke={OUTLINE} strokeWidth="3" strokeLinejoin="round">
      {/* 白衣 (肩〜胴) — 顔の下に白が見えるよう広めに取る */}
      <path d="M 2 28 Q 2 6 24 2 L 76 2 Q 98 6 98 28 L 98 32 L 2 32 Z" fill="#f8f4ec" />
      {/* 襟 V */}
      <path d="M 40 2 L 50 24 L 60 2 Z" fill="#f8f4ec" />
      <line x1="40" y1="2" x2="50" y2="22" strokeWidth="2" />
      <line x1="60" y1="2" x2="50" y2="22" strokeWidth="2" />
      {/* 帯 (white sash) */}
      <rect x="0" y="30" width="100" height="4" fill="#ffffff" />
      {/* 緋袴 (red hakama) */}
      <path d="M 0 34 L 100 34 L 100 50 L 0 50 Z" fill="#c8162b" />
      {/* 袴の襞 */}
      <line x1="25" y1="34" x2="22" y2="50" strokeWidth="1.8" />
      <line x1="50" y1="34" x2="50" y2="50" strokeWidth="1.8" />
      <line x1="75" y1="34" x2="78" y2="50" strokeWidth="1.8" />
    </g>,
  );

/** 神楽鈴: 巫女の祭具 (3 つ鈴 + 紅白紐) */
const kaguraSuzu = (color: string) =>
  svg(
    <g stroke={OUTLINE} strokeWidth={OUTLINE_W} strokeLinejoin="round">
      {/* 柄 */}
      <rect x="47" y="62" width="6" height="34" fill="#7a3a10" />
      {/* 柄頭の装飾 */}
      <rect x="40" y="54" width="20" height="10" rx="2" fill="#b87a1e" />
      {/* 鈴 3 つ (三角配置) */}
      <circle cx="50" cy="22" r="14" fill={color} />
      <circle cx="24" cy="44" r="12" fill={color} />
      <circle cx="76" cy="44" r="12" fill={color} />
      {/* 鈴のスロット */}
      <line x1="42" y1="24" x2="58" y2="24" strokeWidth="3" />
      <line x1="16" y1="46" x2="32" y2="46" strokeWidth="3" />
      <line x1="68" y1="46" x2="84" y2="46" strokeWidth="3" />
      {/* 紐 (紅白) */}
      <path d="M 44 66 Q 38 80 32 96" stroke="#e02030" strokeWidth="3.5" fill="none" />
      <path d="M 56 66 Q 62 80 68 96" stroke="#ffffff" strokeWidth="3.5" fill="none" />
    </g>,
  );

const twinSwords = (color: string) =>
  svg(
    <g stroke={OUTLINE} strokeWidth={OUTLINE_W} strokeLinejoin="round">
      <g transform="rotate(-22 50 50)">
        <rect x="40" y="76" width="20" height="16" rx="2" fill="#6a3a10" />
        <rect x="30" y="68" width="40" height="10" fill="#b87a1e" />
        <polygon points="42,68 58,68 55,10 50,2 45,10" fill={color} />
      </g>
      <g transform="rotate(22 50 50)">
        <rect x="40" y="76" width="20" height="16" rx="2" fill="#6a3a10" />
        <rect x="30" y="68" width="40" height="10" fill="#b87a1e" />
        <polygon points="42,68 58,68 55,10 50,2 45,10" fill={color} />
      </g>
    </g>,
  );

// ─── crown 用 (頭上に被せる) ───

/** 兜 (samurai helmet): 鍬形 + 前立て + 錏 */
const kabuto = (color: string) =>
  svg(
    <g stroke={OUTLINE} strokeWidth={OUTLINE_W} strokeLinejoin="round">
      {/* 錏 (neck guard) */}
      <path d="M 20 62 L 22 88 L 78 88 L 80 62 Z" fill={color} />
      <line x1="24" y1="72" x2="76" y2="72" strokeWidth="2" />
      <line x1="24" y1="80" x2="76" y2="80" strokeWidth="2" />
      {/* 鉢 (dome) */}
      <path d="M 16 66 Q 16 22 50 16 Q 84 22 84 66 Z" fill={color} />
      <line x1="50" y1="18" x2="50" y2="66" strokeWidth="2" />
      <path d="M 32 22 Q 32 46 30 66" strokeWidth="2" fill="none" />
      <path d="M 68 22 Q 68 46 70 66" strokeWidth="2" fill="none" />
      {/* 吹返し (side flares) */}
      <path d="M 6 58 Q 0 80 16 82 L 20 64 Z" fill={color} />
      <path d="M 94 58 Q 100 80 84 82 L 80 64 Z" fill={color} />
      {/* 鍬形 (金の角・左右) */}
      <path d="M 28 28 Q 14 8 2 0 Q 12 18 26 40 Z" fill="#e8c34b" />
      <path d="M 72 28 Q 86 8 98 0 Q 88 18 74 40 Z" fill="#e8c34b" />
      {/* 前立て (forehead crescent) */}
      <path d="M 36 48 Q 50 32 64 48 Q 56 42 50 42 Q 44 42 36 48 Z" fill="#ffd84a" />
    </g>,
  );

/** 賢者の三角帽子 (wizard hat with star) */
const wizardHat = (color: string) =>
  svg(
    <g stroke={OUTLINE} strokeWidth={OUTLINE_W} strokeLinejoin="round">
      {/* つば */}
      <ellipse cx="50" cy="76" rx="44" ry="10" fill={color} />
      {/* 円錐 (先端を少し傾ける) */}
      <path d="M 20 74 Q 40 44 56 6 Q 66 44 80 74 Z" fill={color} />
      {/* 帯 */}
      <path d="M 26 68 Q 50 80 76 68 L 78 62 Q 50 74 24 62 Z" fill="#3a2a15" />
      {/* 星 */}
      <path d="M 56 36 l 3 8 l 9 1 l -7 6 l 2 8 l -7 -5 l -7 5 l 2 -8 l -7 -6 l 9 -1 z" fill="#ffd84a" stroke="none" />
    </g>,
  );

/** 魔法使いの三角帽子 (witch hat with crescent moon) */
const sorcererHat = (color: string) =>
  svg(
    <g stroke={OUTLINE} strokeWidth={OUTLINE_W} strokeLinejoin="round">
      {/* つば */}
      <ellipse cx="50" cy="76" rx="44" ry="10" fill={color} />
      {/* 円錐 (sage とは逆方向に傾ける) */}
      <path d="M 20 74 Q 32 42 44 6 Q 58 44 80 74 Z" fill={color} />
      {/* 帯 */}
      <path d="M 26 68 Q 50 80 76 68 L 78 62 Q 50 74 24 62 Z" fill="#3a2a15" />
      {/* 三日月 (yellow disk + same-color overlay で crescent) */}
      <circle cx="42" cy="40" r="10" fill="#ffd84a" />
      <circle cx="48" cy="37" r="8.5" fill={color} stroke="none" />
    </g>,
  );

/** 吟遊詩人の羽根付き帽子 (feathered cap) */
const featheredCap = (color: string) =>
  svg(
    <g stroke={OUTLINE} strokeWidth={OUTLINE_W} strokeLinejoin="round">
      {/* 本体 (ベレー風) */}
      <path d="M 12 70 Q 10 38 50 28 Q 90 38 88 70 L 82 78 L 18 78 Z" fill={color} />
      <ellipse cx="50" cy="78" rx="38" ry="8" fill={color} />
      {/* 帯 */}
      <rect x="14" y="66" width="72" height="8" fill="#3a2a15" />
      {/* 羽根 (斜め上に伸ばす) */}
      <path d="M 66 32 Q 88 8 98 0 Q 88 20 82 44 Z" fill="#ffd84a" />
      <line x1="68" y1="30" x2="92" y2="4" strokeWidth="2" />
    </g>,
  );

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
    sage:      { crown: wizardHat('#3a2a5a'),      primary: book(c),           accentColor: accent },
    mage:      { crown: sorcererHat('#1a2f5a'),    primary: staff(c),          accentColor: accent },
    shogun:    { crown: kabuto('#2a2f3a'),         accentColor: accent },
    bard:      { crown: featheredCap('#3a2a5a'),   primary: musicNote(c),      accentColor: accent },
    seer:      { primary: crystalBall(c),          accentColor: accent },
    poet:      { primary: feather(c),              accentColor: accent },
    paladin:   { leftSide: sword(c),               rightSide: shield('#e8c34b'), accentColor: accent },
    explorer:  { primary: compass(c),              accentColor: accent },
    warrior:   { leftSide: sword(c),               accentColor: accent },
    guardian:  { rightSide: shield(c),             accentColor: accent },
    fighter:   { primary: fist(),                  accentColor: accent },
    dancer:    { primary: brush(c),                secondary: palette(),        accentColor: accent },
    captain:   { primary: starEpaulet(c),          accentColor: accent },
    miko:      { body: mikoOutfit(), primary: kaguraSuzu('#ffd84a'),    accentColor: accent },
    gladiator: { primary: twinSwords(c),           accentColor: accent },
    performer: { primary: dice(c),                 accentColor: accent },
  };
  return map[archetype];
}
