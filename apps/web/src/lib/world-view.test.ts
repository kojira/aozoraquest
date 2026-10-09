/** フィールドの上枠ラベル。モンスター 0 体 (未読込) でも落ちず、敵名の部分だけ出さない (D-MONSTER-001)。 */
import { afterEach, describe, expect, it } from 'vitest';
import { clearMonsters, favoredMonsterFor, setMonsterOverrides } from '@aozoraquest/core';
import { TEST_MONSTERS } from '@aozoraquest/core/src/__tests__/helpers/monster-fixture';
import { fieldLocationLabel } from './world-view';

describe('fieldLocationLabel', () => {
  afterEach(() => setMonsterOverrides(TEST_MONSTERS));

  it('モンスターがいれば よく出る敵の名前を出す', () => {
    const name = favoredMonsterFor(1, 0)?.name;
    expect(fieldLocationLabel(1, true, name)).toBe(`おだやか・深い森 / ${name}`);
  });

  it('0 体なら world.tsx と同じ呼び方で例外を出さず、危険度だけになる', () => {
    clearMonsters();
    expect(fieldLocationLabel(2, false, favoredMonsterFor(2, 5)?.name)).toBe('すこし危険');
    expect(fieldLocationLabel(1, true, favoredMonsterFor(1, 0)?.name)).toBe('おだやか・深い森');
  });
});
