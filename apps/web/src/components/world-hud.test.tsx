// @vitest-environment jsdom
/** 右上の現在地。見えない職のふつうのフィールドでは枠ごと出さない (意味のない「フィールド」を出さない)。 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { favoredMonsterFor } from '@aozoraquest/core';
import { fieldLocationLabel, seesFieldDanger } from '@/lib/world-view';
import { WorldHud } from './world-hud';

afterEach(cleanup);

const hudAt = (hero: string, forest: boolean) => {
  const label = fieldLocationLabel(3, forest, favoredMonsterFor(3, 0)?.name, seesFieldDanger(hero, { ids: [] }));
  render(<WorldHud hp={10} maxHp={10} mp={5} maxMp={5} locationLabel={label} />);
  return document.querySelector('[data-hud-location]');
};

describe('WorldHud 右上の現在地', () => {
  it('戦士が森以外のフィールドにいると 右上の枠を出さない', () => {
    expect(hudAt('warrior', false)).toBeNull();
    expect(document.body.textContent).not.toContain('フィールド');
  });

  it('戦士でも 森なら「深い森」を出す', () => {
    expect(hudAt('warrior', true)?.textContent).toBe('深い森');
  });

  it('賢者なら 危険度と よく出る敵を出す', () => {
    const name = favoredMonsterFor(3, 0)?.name;
    expect(name).toBeTruthy();
    expect(hudAt('sage', false)?.textContent).toBe(`危険 / ${name}`);
  });
});
