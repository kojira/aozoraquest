import { useLayoutEffect, useRef } from 'react';
import { WorldScroll } from './world-scroll';

type Position = { x: number; y: number; mapId?: string | undefined };
export type WorldScrollStep = Position & { dx: number; dy: number };

/** Synchronize new tile content and its offset before paint; rAF changes only the SVG layer. */
export function useWorldScroll(position: Position | null, step: WorldScrollStep | null) {
  const layerRef = useRef<SVGGElement>(null);
  const scroll = useRef(new WorldScroll());
  const frame = useRef<number | null>(null);
  const applied = useRef<WorldScrollStep | null>(null);
  const x = position?.x, y = position?.y, mapId = position?.mapId;
  const matches = !!step && x === step.x && y === step.y && mapId === step.mapId;
  // Extra tiles cover all outstanding steps, including rapid keyboard repeats/turns.
  // The SVG viewport clips them; this does not change exploration or interaction.
  const padding = matches ? Math.max(1, Math.ceil(scroll.current.distance / 32) + (step !== applied.current ? 1 : 0)) : 1;

  useLayoutEffect(() => {
    const layer = layerRef.current;
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const paint = () => {
      const at = scroll.current.offset;
      layer?.setAttribute('transform', `translate(${Math.round(at.x)} ${Math.round(at.y)})`);
    };
    const cancel = () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      frame.current = null;
      scroll.current.clear(); paint();
    };
    const tick = (now: number) => {
      scroll.current.advance(now); paint();
      frame.current = scroll.current.moving ? requestAnimationFrame(tick) : null;
    };
    if (!matches || motion.matches) cancel();
    else if (step !== applied.current) {
      scroll.current.add(step.dx, step.dy, performance.now());
      paint();
    }
    applied.current = step;
    if (scroll.current.moving && frame.current === null) frame.current = requestAnimationFrame(tick);
    const onMotion = () => { if (motion.matches) cancel(); };
    motion.addEventListener('change', onMotion);
    return () => {
      motion.removeEventListener('change', onMotion);
    };
  }, [x, y, mapId, step, matches]);

  useLayoutEffect(() => () => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    scroll.current.clear();
  }, []);

  return { layerRef, padding };
}
