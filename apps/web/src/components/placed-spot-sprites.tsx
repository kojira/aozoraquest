import type { ReactElement } from 'react';
import { placedItemOpen, placedItems, placedKind, tileArtFor, wrap } from '@aozoraquest/core';
import { renderArt } from '@/components/world-tiles';
import { HALF, TILE, VIEW } from '@/lib/world-view';
import './placed-spot-sprites.css';

const reducedMotion = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * 宝箱とキラキラの重ね描き (D-CHEST-001 §5)。見た目だけで、取れるかは edge が決める。
 * - 宝箱: 条件のフラグがそろっていれば、未開封は閉じた絵・開封済みは開いた絵。そろわなければ描かない
 *   (まだ物語に出てこない場所を見せない)
 * - キラキラ: 取れる間だけ 2 コマで光る。reduced-motion では 1 コマ目で止める。取ったら消す
 * - spot: 描かない
 * 絵は tileArt のキー (`chest-closed` / `chest-open` / `sparkle-1` / `sparkle-2`) なので、/admin の絵の編集で上書きできる。
 */
export function placedSpotSprites({ mapId, inside, at, scrollPadding, flags, opened }: {
  mapId: string; inside: boolean; at: { x: number; y: number }; scrollPadding: number; flags: readonly string[]; opened: readonly string[];
}): ReactElement[] {
  const out: ReactElement[] = [];
  const relative = (value: number) => wrap(value + scrollPadding) - scrollPadding;
  for (const p of placedItems()) {
    const kind = placedKind(p);
    if (p.mapId !== mapId || kind === 'spot') continue;
    const vx = inside ? p.x - (at.x - HALF) : relative(p.x - (at.x - HALF));
    const vy = inside ? p.y - (at.y - HALF) : relative(p.y - (at.y - HALF));
    if (vx < -scrollPadding || vy < -scrollPadding || vx >= VIEW + scrollPadding || vy >= VIEW + scrollPadding) continue;
    const ready = (p.requireFlags ?? []).every((f) => flags.includes(f));
    const open = placedItemOpen(p, flags, opened);
    if (!ready || (kind === 'sparkle' && !open)) continue;
    const art = kind === 'chest' ? (open ? 'chest-closed' : 'chest-open') : 'sparkle';
    const body = kind === 'chest'
      ? renderArt(tileArtFor(art))
      : reducedMotion()
        ? renderArt(tileArtFor('sparkle-1'))
        : <>{[0, 1].map((f) => <g key={f} className="placed-sparkle-frame" data-frame={f}>{renderArt(tileArtFor(`sparkle-${f + 1}`))}</g>)}</>;
    out.push(
      <svg key={`placed-${p.id}`} data-placed={p.id} data-art={art} x={vx * TILE} y={vy * TILE} width={TILE} height={TILE} viewBox="0 0 32 32">{body}</svg>,
    );
  }
  return out;
}
