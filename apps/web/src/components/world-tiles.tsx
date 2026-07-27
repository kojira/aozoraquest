import type { ReactElement } from 'react';
import { TERRAIN_COLORS, UNKNOWN_TERRAIN_COLOR, tileArtColorAt, tileArtFor, type Terrain } from '@aozoraquest/core';

/**
 * あおぞらワールドのタイル SVG (docs/19-overworld.md /
 * docs/overworld-drafts/tiles.html v2 の React 化)。
 * 各タイルは 32x32 viewBox の SVG 断片。マップは <g transform> で並べる。
 */

const PLAINS = (
  <>
    <rect width="32" height="32" fill="#9dd07f" />
    <path d="M6 22 l2 -4 l2 4 M20 12 l2 -4 l2 4" stroke="#7db95f" strokeWidth="1.6" fill="none" strokeLinecap="round" />
    <circle cx="26" cy="24" r="1.2" fill="#b8e29a" />
    <circle cx="12" cy="8" r="1.2" fill="#b8e29a" />
  </>
);

/** 平地の見た目バリエーション (tileDetailAt(x,y) で選ぶ)。地形は同じ・絵だけ変える。
 *  「平原だけが続くマップは無し」への対応: 花・岩・草むらで画面ごとに表情を変える。 */
export const PLAINS_VARIANTS: readonly ReactElement[] = [
  PLAINS,
  // 花ばたけ (黄 + 白)
  (
    <>
      <rect width="32" height="32" fill="#9dd07f" />
      <circle cx="9" cy="11" r="2" fill="#f5d442" />
      <circle cx="9" cy="11" r="0.9" fill="#c98d1e" />
      <circle cx="22" cy="20" r="2" fill="#ffffff" />
      <circle cx="22" cy="20" r="0.9" fill="#f5d442" />
      <circle cx="15" cy="26" r="1.7" fill="#f5a3c0" />
      <path d="M26 8 l1.6 -3 l1.6 3" stroke="#7db95f" strokeWidth="1.4" fill="none" strokeLinecap="round" />
    </>
  ),
  // 岩と草
  (
    <>
      <rect width="32" height="32" fill="#9dd07f" />
      <path d="M18 22 l3.5 -4 l4.5 1 l1.5 3.5 l-2 2 l-6 0 Z" fill="#a8a294" stroke="#7d786c" strokeWidth="1.2" />
      <path d="M6 12 l2 -4 l2 4 M9 26 l2 -4 l2 4" stroke="#7db95f" strokeWidth="1.6" fill="none" strokeLinecap="round" />
    </>
  ),
  // 濃い草むら
  (
    <>
      <rect width="32" height="32" fill="#98cc79" />
      <path d="M5 14 l2 -4 l2 4 M13 8 l2 -4 l2 4 M22 16 l2 -4 l2 4 M10 26 l2 -4 l2 4 M24 27 l2 -4 l2 4"
        stroke="#6fae52" strokeWidth="1.7" fill="none" strokeLinecap="round" />
    </>
  ),
];

export const TERRAIN_TILES: Record<Terrain, ReactElement> = {
  plains: PLAINS,
  grove: (
    <>
      <rect width="32" height="32" fill="#8cc46f" />
      <ellipse cx="10" cy="14" rx="6" ry="7" fill="#4f9e4a" />
      <rect x="9" y="19" width="2.4" height="5" fill="#7a5a3a" />
      <ellipse cx="23" cy="21" rx="5" ry="6" fill="#5cab54" />
      <rect x="22" y="25" width="2.2" height="4" fill="#7a5a3a" />
    </>
  ),
  forest: (
    <>
      <rect width="32" height="32" fill="#4f8f4a" />
      <path d="M8 20 L13 8 L18 20 Z" fill="#2f6e35" />
      <path d="M17 24 L22 12 L27 24 Z" fill="#255d2c" />
      <path d="M3 27 L8 16 L13 27 Z" fill="#2a6631" />
      <rect x="12" y="20" width="2" height="5" fill="#5d4630" />
      <rect x="21" y="24" width="2" height="4" fill="#5d4630" />
    </>
  ),
  pond: (
    <>
      <rect width="32" height="32" fill="#9dd07f" />
      <ellipse cx="16" cy="17" rx="11" ry="8.5" fill="#57b7ee" />
      <ellipse cx="16" cy="17" rx="11" ry="8.5" fill="none" stroke="#3e94c9" strokeWidth="1.6" />
      <path d="M10 16 q3 -2 6 0 M14 20 q3 -2 6 0" stroke="#bfe6ff" strokeWidth="1.4" fill="none" strokeLinecap="round" />
    </>
  ),
  water: (
    <>
      <rect width="32" height="32" fill="#57b7ee" />
      <path
        d="M2 10 q4 -3 8 0 t8 0 t8 0 t8 0 M-2 20 q4 -3 8 0 t8 0 t8 0 t8 0 M2 30 q4 -3 8 0 t8 0 t8 0"
        stroke="#bfe6ff"
        strokeWidth="1.6"
        fill="none"
        strokeLinecap="round"
      />
    </>
  ),
  bridge: (
    <>
      <rect width="32" height="32" fill="#57b7ee" />
      <path d="M2 10 q4 -3 8 0 t8 0 t8 0 t8 0 M2 30 q4 -3 8 0 t8 0 t8 0" stroke="#bfe6ff" strokeWidth="1.4" fill="none" strokeLinecap="round" />
      <rect x="0" y="12" width="32" height="9" fill="#b08a5c" />
      <path d="M0 12 h32 M0 21 h32" stroke="#8a6a42" strokeWidth="1.6" />
      <path d="M4 12 v9 M10 12 v9 M16 12 v9 M22 12 v9 M28 12 v9" stroke="#8a6a42" strokeWidth="1.2" />
      <path d="M0 11 h32 M0 22 h32" stroke="#6e5334" strokeWidth="1" />
    </>
  ),
  mountain: (
    <>
      <rect width="32" height="32" fill="#8cc46f" />
      <path d="M2 28 L12 8 L20 28 Z" fill="#8a7f74" />
      <path d="M12 8 L15.5 15 L12.5 15 L16 22 L20 28 L12 28 Z" fill="#6e655c" opacity=".55" />
      <path d="M9.5 13 L12 8 L14.5 13 L12.8 12 L12 13.6 L11 12 Z" fill="#f2f5f7" />
      <path d="M14 28 L23 12 L31 28 Z" fill="#9b8f83" />
      <path d="M20.8 16 L23 12 L25.2 16 L23.7 15 L23 16.4 L22 15 Z" fill="#f2f5f7" />
    </>
  ),
  town: (
    <>
      {PLAINS}
      <rect x="5" y="15" width="9" height="9" fill="#f0e6d2" />
      <path d="M3.5 15.5 L9.5 8.5 L15.5 15.5 Z" fill="#c9564a" />
      <rect x="8" y="19" width="3" height="5" fill="#7a5a3a" />
      <rect x="18" y="17" width="9" height="8" fill="#f0e6d2" />
      <path d="M16.5 17.5 L22.5 11.5 L28.5 17.5 Z" fill="#4a7fc9" />
      <rect x="20" y="19.5" width="2.4" height="2.4" fill="#57b7ee" />
      <rect x="24" y="19.5" width="2.4" height="2.4" fill="#57b7ee" />
    </>
  ),
};

/**
 * **ドット絵のタイルを SVG 断片として描く** (#421)。
 *
 * 地形は 256 種まで増える前提で、増やすたびに SVG を手で書くのは続かない。
 * エディタで描いたドット絵 (画素データ) があればそれを使い、**無ければ従来の SVG**、
 * SVG も無ければ**代表色のべた塗り**に倒す。この 3 段があるので、
 * 「絵がまだ無い地形」でも編集と描画が止まらない。
 *
 * 画素は `<rect>` の並びで出す。1 タイル 16×16 = 最大 256 個だが、
 * **同じ色が続く区間は 1 本の rect にまとめる**ので実際はずっと少ない。
 */
export function pixelTile(terrain: string): ReactElement | null {
  const art = tileArtFor(terrain);
  if (!art) return null;
  const px = 32 / art.size; // 32×32 viewBox に合わせる
  const rects: ReactElement[] = [];
  for (let y = 0; y < art.size; y++) {
    let runStart = 0;
    let runColor = tileArtColorAt(art, 0, y);
    for (let x = 1; x <= art.size; x++) {
      const c = x < art.size ? tileArtColorAt(art, x, y) : '\u0000'; // 端で必ず切る
      if (c === runColor) continue;
      if (runColor !== '') {
        rects.push(
          <rect
            key={`${runStart}-${y}`}
            x={runStart * px}
            y={y * px}
            width={(x - runStart) * px}
            height={px}
            fill={runColor}
          />,
        );
      }
      runStart = x;
      runColor = c;
    }
  }
  // **アンチエイリアスを切る (ドット絵の作法)。**
  // 既定の描画では矩形の境界が補間され、隣り合う画素の間に中間色の**スジ**が入る。
  // さらに縮小時 (16px 表示など) は 1 画素が 1 デバイス画素を割り、補間で**潰れて**
  // 別の色になる。`crispEdges` で最近傍に倒すと、拡大しても縮小しても画素のまま出る。
  return <g shapeRendering="crispEdges">{rects}</g>;
}

/** 絵も SVG も無い地形の代替 (代表色のべた塗り)。 */
export function fallbackTile(terrain: string): ReactElement {
  const color = (TERRAIN_COLORS as Record<string, string>)[terrain] ?? UNKNOWN_TERRAIN_COLOR;
  return <rect width="32" height="32" fill={color} />;
}
