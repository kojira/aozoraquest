// @vitest-environment jsdom
/** せかいちずの次の目的地 (D-EARLY-002): 点滅する輪 + 街の名前。霧の中・目的地なしでは出さない。 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { WorldMapModal } from './world-map-modal';

const HOMURA = { x: 320, y: 448, region: 26, name: 'ほむらの街' };

afterEach(cleanup);

describe('WorldMapModal の次の目的地', () => {
  it('解禁済みなら、点滅する輪と名前を出す', () => {
    render(<WorldMapModal x={211} y={341} regions={[17, 26]} storyTown={HOMURA} onClose={vi.fn()} />);
    const ring = screen.getByTestId('map-story-goal');
    expect(ring.className).toBe('aq-map-goal');
    expect(ring.style.left).toBe(`${(320 / 1024) * 100}%`);
    expect(screen.getAllByText('ほむらの街').length).toBe(1);
    expect(screen.getByText(/つぎは ほむらの街/)).toBeTruthy();
    // 点滅は CSS。reduced-motion では止める
    const css = document.querySelector('style')!.textContent!;
    expect(css).toMatch(/\.aq-map-goal \{ animation: aq-map-goal-blink/);
    expect(css).toMatch(/prefers-reduced-motion: reduce\) \{ \.aq-map-here, \.aq-map-goal \{ animation: none; \}/);
  });
  it('霧の中・目的地なしなら出さない', () => {
    render(<WorldMapModal x={211} y={341} regions={[17]} storyTown={HOMURA} onClose={vi.fn()} />);
    expect(screen.queryByTestId('map-story-goal')).toBeNull();
    cleanup();
    render(<WorldMapModal x={211} y={341} regions={[17, 26]} storyTown={null} onClose={vi.fn()} />);
    expect(screen.queryByTestId('map-story-goal')).toBeNull();
    expect(screen.queryByText(/つぎは/)).toBeNull();
  });
});
