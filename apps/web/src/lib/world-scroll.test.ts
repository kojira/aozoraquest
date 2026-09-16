import { describe, expect, it } from 'vitest';
import { WorldScroll } from './world-scroll';

describe('WorldScroll', () => {
  it('keeps 170ms held steps at constant speed without per-tile pauses or accumulating lag', () => {
    const scroll = new WorldScroll();
    let nextStep = 0, target = 0, previous = 0;
    const travelled: number[] = [];
    for (let now = 0; now <= 5000; now += 5) {
      if (now >= nextStep) { scroll.add(1, 0, now); target += 32; nextStep += 170; }
      const offset = scroll.advance(now);
      const displayed = target - offset.x;
      if (now > 25) travelled.push(displayed - previous);
      previous = displayed;
      expect(offset.x).toBeLessThanOrEqual(36);
    }
    for (const distance of travelled) expect(distance).toBeCloseTo(32 * 5 / 170, 5);
    expect(scroll.advance(5500)).toEqual({ x: 0, y: 0 });
    expect(scroll.moving).toBe(false);
  });
  it.each([120, 125, 169])('bounds lag during five seconds of %ims repeats and aligns promptly on release', (interval) => {
    const scroll = new WorldScroll();
    let lastStep = 0;
    for (let now = 0; now <= 5000; now++) {
      if (now % interval === 0) { scroll.add(1, 0, now); lastStep = now; }
      scroll.advance(now);
      expect(scroll.distance).toBeLessThan(64);
    }
    expect(scroll.advance(lastStep + 186)).toEqual({ x: 0, y: 0 });
    expect(scroll.moving).toBe(false);
  });
  it('finishes the previous axis before turning, then aligns exactly; clear drops stale maps', () => {
    const scroll = new WorldScroll(); scroll.add(1, 0, 0); scroll.advance(85);
    scroll.add(0, 1, 85);
    const during = scroll.advance(100);
    expect(during.x).toBeGreaterThan(0); expect(during.y).toBe(32);
    expect(scroll.advance(500)).toEqual({ x: 0, y: 0 });
    scroll.add(-1, 0, 2000); expect(scroll.advance(2008).x).toBe(-32);
    expect(scroll.advance(2101).x).toBeCloseTo(-16);
    scroll.clear(); expect(scroll.advance(2200)).toEqual({ x: 0, y: 0 });
  });
  it('bounds repeat speed and follows a rapid keyboard path without inventing steps', () => {
    const scroll = new WorldScroll();
    for (let now = 0; now <= 300; now += 30) { scroll.add(1, 0, now); expect(scroll.offset.x).toBeLessThan(65); }
    expect(scroll.advance(1000)).toEqual({ x: 0, y: 0 });
    // A pause starts a normal single step, not a 700ms slow pan.
    scroll.add(0, -1, 2000); expect(scroll.advance(2101).y).toBeCloseTo(-16);
  });
});
