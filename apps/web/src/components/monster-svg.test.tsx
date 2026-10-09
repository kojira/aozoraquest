// @vitest-environment jsdom
/**
 * MonsterSvg の絵の選び方 (D-MONSTER-001 PR2): ドット絵 (tileArt `monster:<id>`) → monsterArt レコードの絵 → 「?」。
 * レコードの絵は `<svg><image href="data:…">` で出す (script が動かない画像として読む)。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { clearMonsterArts, emptyTileArt, monsterArtDataUri, monsterArtKey, setMonsterArts, setTileArt } from '@aozoraquest/core';
import { MonsterSvg } from './monster-svg';
import { TEST_MONSTERS } from '@aozoraquest/core/src/__tests__/helpers/monster-fixture';
import art from '../../e2e/fixtures/monster-art.json';

const ART = [{ id: 'slime', svg: '<g fill="{{tint|#57b7ee}}"/>' }];

describe('MonsterSvg', () => {
  afterEach(() => { clearMonsterArts(); setTileArt(monsterArtKey('sky-slime'), null); });

  it('レコードの絵を <svg><image href=data URI> で出す (tint を差し込む)', () => {
    setMonsterArts(ART);
    const { container } = render(<MonsterSvg species="slime" tint="#e0574a" size={48} monsterId="red-slime" />);
    const svg = container.querySelector('svg')!;
    expect(svg.getAttribute('width')).toBe('48');
    const image = svg.querySelector('image')!;
    expect(image.getAttribute('href')).toBe(monsterArtDataUri('slime', '#e0574a'));
    expect(image.getAttribute('width')).toBe('100');
    expect(container.innerHTML).not.toContain('<script');
  });

  it('ドット絵があればレコードの絵より優先する', () => {
    setMonsterArts(ART);
    const dot = emptyTileArt(16);
    setTileArt(monsterArtKey('sky-slime'), { ...dot, palette: ['#ff0000'], pixels: dot.pixels.map(() => 0) });
    const { container } = render(<MonsterSvg species="slime" size={48} monsterId="sky-slime" />);
    expect(container.querySelector('image')).toBeNull();
    expect(container.querySelectorAll('rect').length).toBeGreaterThan(0);
  });

  it('絵のレコードが無い species は「?」を出す', () => {
    const { container } = render(<MonsterSvg species="dragon" size={48} />);
    expect(container.querySelector('image')).toBeNull();
    expect(container.querySelector('[data-monster-unknown]')).not.toBeNull();
  });

  it('dot=false (エディタの下敷き) はドット絵を飛ばしてレコードの絵を出す', () => {
    setMonsterArts(ART);
    const dot = emptyTileArt(16);
    setTileArt(monsterArtKey('sky-slime'), { ...dot, palette: ['#ff0000'], pixels: dot.pixels.map(() => 0) });
    const { container } = render(<MonsterSvg species="slime" size={48} monsterId="sky-slime" dot={false} />);
    expect(container.querySelector('image')).not.toBeNull();
  });
});

describe('monsterArt 初期データ (apps/web/e2e/fixtures/monster-art.json)', () => {
  afterEach(() => clearMonsterArts());

  it('検証を通り、tint を持つ敵の species には tint の差し込み口がある (無いと色違いが同じ絵になる。#536)', () => {
    expect(() => setMonsterArts(art.arts)).not.toThrow();
    for (const m of TEST_MONSTERS) {
      if (!m.tint) continue;
      expect(art.arts.find((a) => a.id === m.species)?.svg, `${m.name} (${m.species}) の tint`).toContain('{{tint|');
    }
  });
});
