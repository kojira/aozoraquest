import { monsterArtDataUri, monsterArtFor, tileArtColorAt, type MonsterSpecies } from '@aozoraquest/core';

const SHADOW = { display: 'block', filter: 'drop-shadow(0 4px 6px rgba(0,0,0,0.35))' } as const;

/**
 * モンスターの絵。**ドット絵 (tileArt `monster:<id>`) → monsterArt レコードの絵 → 「?」** の順に選ぶ
 * (#591 / D-MONSTER-001)。レコードの絵は `<svg><image href="data:…">` で出す: 画像として読む SVG は
 * script も外部の読み込みも動かない。外側を `<svg>` にするのは、`world-map-layer` が `<svg>` の中に置くため。
 * `dot={false}` はドット絵を飛ばす (ドット絵エディタの下敷き)。
 */
export function MonsterSvg({ species, size = 160, tint, monsterId, dot = true }: { species: MonsterSpecies; size?: number; tint?: string | undefined; monsterId?: string; dot?: boolean }) {
  const art = dot && monsterId ? monsterArtFor(monsterId) : undefined;
  if (art) {
    // ドット絵はアンチエイリアスを切って画素のまま出す (タイルと同じ作法)
    const px = 100 / art.size;
    const rects: React.ReactElement[] = [];
    for (let y = 0; y < art.size; y++) {
      let runStart = 0;
      let runColor = tileArtColorAt(art, 0, y);
      for (let x = 1; x <= art.size; x++) {
        const c = x < art.size ? tileArtColorAt(art, x, y) : '\u0000';
        if (c === runColor) continue;
        if (runColor !== '') {
          rects.push(<rect key={`${runStart}-${y}`} x={runStart * px} y={y * px} width={(x - runStart) * px} height={px} fill={runColor} />);
        }
        runStart = x;
        runColor = c;
      }
    }
    return (
      <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden style={SHADOW}>
        <g shapeRendering="crispEdges">{rects}</g>
      </svg>
    );
  }
  const uri = monsterArtDataUri(species, tint);
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden style={SHADOW}>
      {uri ? <image href={uri} width="100" height="100" /> : UNKNOWN}
    </svg>
  );
}

/** 絵のレコードが無い (読み込み前・未登録の species) ときの中立の「?」シルエット。 */
const UNKNOWN = (
  <g data-monster-unknown="">
    <circle cx="50" cy="54" r="32" fill="#8a94a0" stroke="#1b2530" strokeWidth="4" />
    <path d="M40 44 C40 34 60 34 60 44 C60 52 50 52 50 60" fill="none" stroke="#f0f4ff" strokeWidth="6" strokeLinecap="round" />
    <circle cx="50" cy="71" r="4" fill="#f0f4ff" />
  </g>
);
