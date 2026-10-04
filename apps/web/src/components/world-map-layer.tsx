import { SHORE_NEIGHBORS, shoreGroundKey, shoreMaskAt, usesStandardShore } from '@/lib/shore-autotile';
import { NpcSprite } from '@/components/npc-sprite';
import { WORLD_MAP_ID, interiorById, interiorPartAt, interiorTerrainAt, mappedPartAt, npcsOn, terrainAt, tileDetailAt, wrap } from '@aozoraquest/core';
import { PLAINS_VARIANTS, TERRAIN_TILES, fallbackTile, pixelPart, pixelTile, shoreTile } from '@/components/world-tiles';
import { isFutabaGuild } from '@/lib/futaba-guild';
import { HALF, TILE, VIEW } from '@/lib/world-view';

/**
 * ワールドマップのタイルと NPC (スクロール層の中身)。プレイヤー中央固定のビューポートに、
 * 歩行スクロール用の余白 scrollPadding マスを足して描く。
 */
export function WorldMapLayer({ at, scrollPadding }: { at: { x: number; y: number; mapId?: string }; scrollPadding: number }) {
  // ビューポートのタイル列 (プレイヤー中央固定)。平地は見た目バリアントを散らす。
  // **同じパーツは <defs> に 1 回だけ定義して <use> で参照する** (#605)。全地形が
  // ドット絵 (タイルあたり最大 ~150 rect) になったので、マスごとにインライン展開すると
  // ビューポートだけで数千〜万 rect の DOM になり、歩くたびの再描画がモバイルで重くなる。
  // 今いるマップ (#424)。内部なら地形もパーツもそのマップから引く。
  const inside = at.mapId ? interiorById(at.mapId) ?? null : null;
  const tileDefs = new Map<string, React.ReactElement>();
  const tiles = [];
  for (let vy = -scrollPadding; vy < VIEW + scrollPadding; vy++) {
    for (let vx = -scrollPadding; vx < VIEW + scrollPadding; vx++) {
      // 内部マップ (#424) は端で折り返さない (範囲外は壁として描く)。
      const x = inside ? at.x - HALF + vx : wrap(at.x - HALF + vx);
      const y = inside ? at.y - HALF + vy : wrap(at.y - HALF + vy);
      const t = inside ? interiorTerrainAt(inside, x, y) : terrainAt(x, y);
      // ドット絵 (エディタ or 同梱 #605) → 従来の SVG → 代表色のべた塗り、の順に倒す。
      // **パーツ (index) ごとの絵を最優先。** 「縦の橋」のように、通行判定は同じで
      // 絵だけ違うパーツを足せるようにするため、地形 id ではなく index で引く。
      const pi = inside ? interiorPartAt(inside, x, y) : mappedPartAt(x, y);
      // **独自のパーツ表を持つ内部マップは index で引かない** (#626)。`part:<index>` は
      // フィールドと番号空間を共有するので、村の 4 番が「以前フィールドの 4 番に
      // 描いた水の絵」になってしまう。地形名だけで引く。
      const ownParts = !!inside?.parts;
      const artOf = (terrain: string) => (ownParts ? pixelTile(terrain) : pixelPart(pi, terrain));
      // 平地でドット絵が無いときだけ SVG バリアント (見た目散らし) が効くので、id に含める。
      const detail = t === 'plains' && !artOf(t) ? tileDetailAt(x, y) : 0;
      const mask = usesStandardShore(t, ownParts ? undefined : pi) ? shoreMaskAt(x, y, (nx, ny) => {
        if (!inside) return terrainAt(wrap(nx), wrap(ny));
        return nx < 0 || ny < 0 || nx >= inside.size || ny >= inside.size ? undefined : interiorTerrainAt(inside, nx, ny);
      }) : null;
      const groundAt = (neighbor: number) => {
        const [dx, dy] = SHORE_NEIGHBORS[neighbor]!;
        const nx = inside ? x + dx : wrap(x + dx), ny = inside ? y + dy : wrap(y + dy);
        const terrain = inside ? interiorTerrainAt(inside, nx, ny) : terrainAt(nx, ny);
        const index = inside ? interiorPartAt(inside, nx, ny) : mappedPartAt(nx, ny);
        return (ownParts ? pixelTile(terrain) : pixelPart(index, terrain)) ?? TERRAIN_TILES[terrain] ?? fallbackTile(terrain);
      };
      const groundKey = mask === null ? '' : shoreGroundKey(mask, x, y, (nx, ny) => {
        const terrain = inside ? interiorTerrainAt(inside, nx, ny) : terrainAt(wrap(nx), wrap(ny));
        const index = inside ? interiorPartAt(inside, nx, ny) : mappedPartAt(wrap(nx), wrap(ny));
        return `${ownParts ? 'own' : (index ?? 'x')}-${terrain}`;
      });
      const defId = `wt-${ownParts ? `i:${inside!.id}` : (pi ?? 'x')}-${t}-${detail}-${mask ?? 'plain'}-${groundKey}`;
      if (!tileDefs.has(defId)) {
        tileDefs.set(
          defId,
          <g id={defId} key={defId}>
            {(mask === null ? artOf(t) : shoreTile(mask, defId, groundAt))
              ?? (t === 'plains' ? PLAINS_VARIANTS[detail] : TERRAIN_TILES[t])
              ?? fallbackTile(t)}
          </g>,
        );
      }
      tiles.push(<use key={`${vx}-${vy}`} href={`#${defId}`} x={vx * TILE} y={vy * TILE} />);
    }
  }
  tiles.unshift(<defs key="tile-defs">{[...tileDefs.values()]}</defs>);

  // ビューポート内の NPC (#425)。ドット絵 (npc:<id>) → 代替の見た目 (人form) に倒す。
  const npcSprites = [];
  // 今いるマップの NPC だけ描く (#613)。内部マップは端で折り返さないので wrap しない。
  for (const n of npcsOn(inside?.id ?? WORLD_MAP_ID)) {
    const relative = (value: number) => wrap(value + scrollPadding) - scrollPadding;
    const vx = inside ? n.x - (at.x - HALF) : relative(n.x - (at.x - HALF));
    const vy = inside ? n.y - (at.y - HALF) : relative(n.y - (at.y - HALF));
    if (vx < -scrollPadding || vy < -scrollPadding || vx >= VIEW + scrollPadding || vy >= VIEW + scrollPadding) continue;
    npcSprites.push(
      <g key={`npc-${n.id}`} transform={`translate(${vx * TILE},${vy * TILE})`}>
        {isFutabaGuild(n)
          ? <text x={TILE / 2} y={-TILE / 3} textAnchor="middle" fontSize={TILE * 0.42} fill="white" stroke="#202030" strokeWidth={2} paintOrder="stroke">ギルド</text>
          : <NpcSprite npc={n} />}
      </g>,
    );
  }

  return <>{tiles}{npcSprites}</>;
}
