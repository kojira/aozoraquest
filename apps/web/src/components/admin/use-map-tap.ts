import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react';

/** Commit only on a stationary pointer-up; native scrolling and pinch-zoom remain available. */
export function useMapTap(key: string, cells: number, commit: (x: number, y: number) => void) {
  const start = useRef<{ id: number; x: number; y: number; cellX: number; cellY: number; key: string } | null>(null);
  useEffect(() => {
    const cancel = () => { start.current = null; };
    const secondary = (e: PointerEvent) => { if (!e.isPrimary) cancel(); };
    window.addEventListener('scroll', cancel, true);
    window.addEventListener('pointerdown', secondary, true);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('pointerup', cancel);
    window.addEventListener('blur', cancel);
    return () => {
      window.removeEventListener('scroll', cancel, true);
      window.removeEventListener('pointerdown', secondary, true);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('pointerup', cancel);
      window.removeEventListener('blur', cancel);
    };
  }, []);
  function cell(e: ReactPointerEvent<Element>) {
    const r = e.currentTarget.getBoundingClientRect();
    if (!r.width || e.clientX < r.left || e.clientY < r.top || e.clientX >= r.right || e.clientY >= r.bottom) return null;
    return { x: Math.floor((e.clientX - r.left) / r.width * cells), y: Math.floor((e.clientY - r.top) / r.height * cells) };
  }
  return {
    onPointerDown(e: ReactPointerEvent<Element>) {
      const c = cell(e);
      if (!e.isPrimary || e.button !== 0 || !c) { start.current = null; return; }
      start.current = { id: e.pointerId, x: e.clientX, y: e.clientY, cellX: c.x, cellY: c.y, key };
    },
    onPointerMove(e: ReactPointerEvent<Element>) {
      const s = start.current;
      if (s && Math.hypot(e.clientX - s.x, e.clientY - s.y) > 8) start.current = null;
    },
    onPointerCancel() { start.current = null; },
    onPointerLeave() { start.current = null; },
    onPointerUp(e: ReactPointerEvent<Element>) {
      const s = start.current;
      start.current = null;
      const c = cell(e);
      if (s && c && e.isPrimary && e.pointerId === s.id && s.key === key && s.cellX === c.x && s.cellY === c.y && Math.hypot(e.clientX - s.x, e.clientY - s.y) <= 8) commit(c.x, c.y);
    },
  };
}
