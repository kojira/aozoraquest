import type { ReactElement } from 'react';
import type { MonsterSpecies } from '@aozoraquest/core';

/**
 * モンスターの SVG (あおぞらワールドの野外遭遇で使う)。
 * 画像アセットなしのインライン SVG = 軽量・省メモリ (モバイル方針)。
 * species ごとに 1 枚、viewBox 100x100。ドット RPG 風の太い輪郭とシンプルな形。
 */
export function MonsterSvg({ species, size = 160 }: { species: MonsterSpecies; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      aria-hidden
      style={{ display: 'block', filter: 'drop-shadow(0 4px 6px rgba(0,0,0,0.35))' }}
    >
      {BODIES[species]}
    </svg>
  );
}

const OUT = '#1b2530'; // 輪郭色

const BODIES: Record<MonsterSpecies, ReactElement> = {
  slime: (
    <g>
      <path d="M50 18 C74 18 84 42 84 58 C84 76 68 84 50 84 C32 84 16 76 16 58 C16 42 26 18 50 18Z" fill="#57b7ee" stroke={OUT} strokeWidth="4" />
      <path d="M30 34 C36 26 46 24 50 24" fill="none" stroke="#bfe6ff" strokeWidth="5" strokeLinecap="round" />
      <circle cx="38" cy="54" r="5" fill={OUT} />
      <circle cx="62" cy="54" r="5" fill={OUT} />
      <path d="M42 68 Q50 74 58 68" fill="none" stroke={OUT} strokeWidth="3.5" strokeLinecap="round" />
    </g>
  ),
  // はぐれスライム: 同じ形の金属色 (銀) + きらめきのハイライトでレア感を出す。
  'metal-slime': (
    <g>
      <path d="M50 18 C74 18 84 42 84 58 C84 76 68 84 50 84 C32 84 16 76 16 58 C16 42 26 18 50 18Z" fill="#c2ccd6" stroke={OUT} strokeWidth="4" />
      <path d="M28 60 C30 74 42 80 50 80 C58 80 70 74 74 60 C70 70 60 74 50 74 C40 74 32 70 28 60Z" fill="#93a1b0" />
      <path d="M30 34 C36 26 46 24 50 24" fill="none" stroke="#f4f9ff" strokeWidth="6" strokeLinecap="round" />
      <path d="M64 30 l3 5 l5 2 l-5 2 l-3 5 l-3 -5 l-5 -2 l5 -2Z" fill="#ffffff" />
      <circle cx="38" cy="54" r="5" fill={OUT} />
      <circle cx="62" cy="54" r="5" fill={OUT} />
      <path d="M42 70 Q50 64 58 70" fill="none" stroke={OUT} strokeWidth="3.5" strokeLinecap="round" />
    </g>
  ),
  bat: (
    <g>
      <path d="M8 40 Q20 26 34 34 L38 44 Q28 42 24 48Z" fill="#8f7ad6" stroke={OUT} strokeWidth="3.5" strokeLinejoin="round" />
      <path d="M92 40 Q80 26 66 34 L62 44 Q72 42 76 48Z" fill="#8f7ad6" stroke={OUT} strokeWidth="3.5" strokeLinejoin="round" />
      <ellipse cx="50" cy="54" rx="20" ry="22" fill="#a58ff0" stroke={OUT} strokeWidth="4" />
      <path d="M40 34 L44 24 L48 34Z M52 34 L56 24 L60 34Z" fill="#a58ff0" stroke={OUT} strokeWidth="3" strokeLinejoin="round" />
      <circle cx="43" cy="50" r="4.5" fill={OUT} />
      <circle cx="57" cy="50" r="4.5" fill={OUT} />
      <path d="M44 64 L48 60 L50 64 L52 60 L56 64" fill="none" stroke={OUT} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    </g>
  ),
  mushroom: (
    <g>
      <path d="M18 48 C18 28 34 16 50 16 C66 16 82 28 82 48 C82 54 76 56 68 56 L32 56 C24 56 18 54 18 48Z" fill="#e8734f" stroke={OUT} strokeWidth="4" />
      <circle cx="34" cy="34" r="6" fill="#ffe1b3" />
      <circle cx="58" cy="28" r="7" fill="#ffe1b3" />
      <circle cx="68" cy="42" r="5" fill="#ffe1b3" />
      <path d="M36 56 C36 72 40 82 50 82 C60 82 64 72 64 56Z" fill="#fff3da" stroke={OUT} strokeWidth="4" />
      <circle cx="44" cy="66" r="4" fill={OUT} />
      <circle cx="56" cy="66" r="4" fill={OUT} />
      <path d="M46 75 Q50 78 54 75" fill="none" stroke={OUT} strokeWidth="3" strokeLinecap="round" />
    </g>
  ),
  golem: (
    <g>
      <rect x="26" y="18" width="48" height="38" rx="9" fill="#8fa08a" stroke={OUT} strokeWidth="4" />
      <rect x="18" y="52" width="64" height="30" rx="8" fill="#7b8f78" stroke={OUT} strokeWidth="4" />
      <rect x="6" y="50" width="14" height="24" rx="6" fill="#8fa08a" stroke={OUT} strokeWidth="3.5" />
      <rect x="80" y="50" width="14" height="24" rx="6" fill="#8fa08a" stroke={OUT} strokeWidth="3.5" />
      <rect x="34" y="32" width="10" height="8" rx="2" fill="#f5e663" stroke={OUT} strokeWidth="2.5" />
      <rect x="56" y="32" width="10" height="8" rx="2" fill="#f5e663" stroke={OUT} strokeWidth="2.5" />
      <path d="M40 48 L60 48" stroke={OUT} strokeWidth="3.5" strokeLinecap="round" />
      <path d="M30 62 L38 66 M62 66 L70 62" stroke="#5d6e5a" strokeWidth="4" strokeLinecap="round" />
      <circle cx="50" cy="68" r="5" fill="#4fc3f7" stroke={OUT} strokeWidth="2.5" />
    </g>
  ),
  wisp: (
    // slime (青) と紛れないよう紫寄りの炎色にする
    <g>
      <path d="M50 10 C68 26 80 40 80 58 C80 76 66 88 50 88 C34 88 20 76 20 58 C20 40 32 26 50 10Z" fill="#a06ee8" opacity="0.9" stroke={OUT} strokeWidth="4" />
      <path d="M50 24 C60 34 68 44 68 58 C68 70 60 78 50 78 C40 78 32 70 32 58 C32 44 40 34 50 24Z" fill="#e6d4ff" opacity="0.85" />
      <circle cx="42" cy="56" r="4.5" fill={OUT} />
      <circle cx="58" cy="56" r="4.5" fill={OUT} />
      <path d="M44 68 Q50 64 56 68" fill="none" stroke={OUT} strokeWidth="3" strokeLinecap="round" />
    </g>
  ),
  serpent: (
    // 輪郭 (太い暗ストローク) を先に描き、胴体を上に重ねる (逆だと暗色が体に被って濁る)
    <g>
      <path d="M22 78 C10 70 12 52 26 48 C40 44 56 52 62 42 C68 32 58 24 46 26" fill="none" stroke={OUT} strokeWidth="18" strokeLinecap="round" />
      <path d="M22 78 C10 70 12 52 26 48 C40 44 56 52 62 42 C68 32 58 24 46 26" fill="none" stroke="#4fae6d" strokeWidth="14" strokeLinecap="round" />
      <ellipse cx="42" cy="26" rx="15" ry="12" fill="#5fc37e" stroke={OUT} strokeWidth="4" />
      <circle cx="36" cy="24" r="4" fill={OUT} />
      <path d="M27 30 L18 32 L26 35" fill="none" stroke="#e8566a" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M52 20 L58 14 M54 32 L62 34" stroke={OUT} strokeWidth="3" strokeLinecap="round" />
    </g>
  ),
  raven: (
    <g>
      <path d="M14 46 Q30 30 50 34 L46 46 Q30 44 22 52Z" fill="#3d4666" stroke={OUT} strokeWidth="3.5" strokeLinejoin="round" />
      <ellipse cx="56" cy="52" rx="24" ry="20" fill="#4a5478" stroke={OUT} strokeWidth="4" />
      <circle cx="66" cy="40" r="13" fill="#4a5478" stroke={OUT} strokeWidth="4" />
      <path d="M77 38 L90 42 L77 46Z" fill="#f5c542" stroke={OUT} strokeWidth="3" strokeLinejoin="round" />
      <circle cx="68" cy="38" r="4" fill="#f0f4ff" />
      <circle cx="69" cy="38" r="2.2" fill={OUT} />
      <path d="M40 68 L36 80 M52 70 L52 82 M62 68 L66 80" stroke={OUT} strokeWidth="3.5" strokeLinecap="round" />
      <path d="M34 56 Q44 62 54 58" fill="none" stroke="#323a56" strokeWidth="4" strokeLinecap="round" />
    </g>
  ),
  oni: (
    <g>
      <path d="M34 26 L28 10 L42 20Z M66 26 L72 10 L58 20Z" fill="#ffd76e" stroke={OUT} strokeWidth="3.5" strokeLinejoin="round" />
      <ellipse cx="50" cy="50" rx="28" ry="26" fill="#5f8fd6" stroke={OUT} strokeWidth="4" />
      <path d="M30 40 Q36 36 42 40 M58 40 Q64 36 70 40" fill="none" stroke={OUT} strokeWidth="4" strokeLinecap="round" />
      <circle cx="38" cy="48" r="5" fill="#fff" />
      <circle cx="39" cy="49" r="2.6" fill={OUT} />
      <circle cx="62" cy="48" r="5" fill="#fff" />
      <circle cx="61" cy="49" r="2.6" fill={OUT} />
      <path d="M38 64 Q50 72 62 64" fill="none" stroke={OUT} strokeWidth="3.5" strokeLinecap="round" />
      <path d="M42 66 L42 60 M50 69 L50 63 M58 66 L58 60" stroke="#fff" strokeWidth="3" strokeLinecap="round" />
      <path d="M78 30 L88 78" stroke="#8a6a4a" strokeWidth="7" strokeLinecap="round" />
      <circle cx="88" cy="80" r="8" fill="#6e6e78" stroke={OUT} strokeWidth="3" />
    </g>
  ),
  dragon: (
    <g>
      <path d="M18 60 Q6 54 8 42 Q18 46 24 42" fill="#6fcf97" stroke={OUT} strokeWidth="3.5" strokeLinejoin="round" />
      <ellipse cx="50" cy="58" rx="26" ry="22" fill="#58b97f" stroke={OUT} strokeWidth="4" />
      <circle cx="66" cy="38" r="15" fill="#58b97f" stroke={OUT} strokeWidth="4" />
      <path d="M58 26 L54 14 L64 22Z M72 24 L74 12 L80 24Z" fill="#f5e663" stroke={OUT} strokeWidth="3" strokeLinejoin="round" />
      <path d="M80 40 L92 44 L80 48Z" fill="#3f8f5f" stroke={OUT} strokeWidth="3" strokeLinejoin="round" />
      <circle cx="68" cy="36" r="4.5" fill="#fff" />
      <circle cx="69" cy="37" r="2.4" fill={OUT} />
      <path d="M30 46 Q26 36 34 30 L38 40Z" fill="#3f8f5f" stroke={OUT} strokeWidth="3" strokeLinejoin="round" />
      <path d="M40 74 L36 84 M56 76 L56 86 M68 72 L74 82" stroke={OUT} strokeWidth="4" strokeLinecap="round" />
      <path d="M36 56 Q46 64 58 60" fill="none" stroke="#3f8f5f" strokeWidth="4" strokeLinecap="round" />
    </g>
  ),
};
