/** モンスターエディタの模擬戦は、終わったら模擬戦の前の値へ戻す (D-MONSTER-001。null で同梱へ戻さない)。 */
import { afterEach, describe, expect, it } from 'vitest';
import { activeMonsters, clearMonsters, setMonsterOverrides, type MonsterDef } from '@aozoraquest/core';
import { TEST_MONSTERS } from '@aozoraquest/core/src/__tests__/helpers/monster-fixture';
import { simulateMonsterWinRate } from './monster-simulation';

const SAVED: MonsterDef[] = [...TEST_MONSTERS, { ...TEST_MONSTERS[0]!, id: 'golden-lantern', name: 'こがねランタン', storyOnly: true }];

describe('simulateMonsterWinRate', () => {
  afterEach(() => setMonsterOverrides(TEST_MONSTERS));

  it('編集中の値で回し、終わったら模擬戦の前の値 (21 体) に戻る', () => {
    setMonsterOverrides(SAVED);
    const draft = TEST_MONSTERS.map((m) => (m.id === 'sky-slime' ? { ...m, name: 'へんしゅう中' } : m));
    const note = simulateMonsterWinRate(draft, draft.find((m) => m.id === 'sky-slime')!);
    expect(note).toMatch(/^へんしゅう中: 想定 Lv での勝率 \d+%/);
    expect(activeMonsters().map((m) => [m.id, m.name])).toEqual(SAVED.map((m) => [m.id, m.name]));
  });

  it('模擬戦の前が 0 体なら 0 体に戻る', () => {
    clearMonsters();
    simulateMonsterWinRate(TEST_MONSTERS, TEST_MONSTERS[0]!);
    expect(activeMonsters()).toHaveLength(0);
  });
});
