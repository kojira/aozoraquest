/** フィールドの上枠ラベル。モンスター 0 体 (未読込) でも落ちず、敵名の部分だけ出さない (D-MONSTER-001)。 */
import { afterEach, describe, expect, it } from 'vitest';
import { clearMonsters, favoredMonsterFor, setMonsterOverrides, setStory } from '@aozoraquest/core';
import { TEST_MONSTERS } from '@aozoraquest/core/src/__tests__/helpers/monster-fixture';
import { fieldLocationLabel, seesFieldDanger } from './world-view';

describe('fieldLocationLabel', () => {
  afterEach(() => setMonsterOverrides(TEST_MONSTERS));

  it('モンスターがいれば よく出る敵の名前を出す', () => {
    const name = favoredMonsterFor(1, 0)?.name;
    expect(fieldLocationLabel(1, true, name, true)).toBe(`おだやか・深い森 / ${name}`);
  });

  it('0 体なら world.tsx と同じ呼び方で例外を出さず、危険度だけになる', () => {
    clearMonsters();
    expect(fieldLocationLabel(2, false, favoredMonsterFor(2, 5)?.name, true)).toBe('すこし危険');
    expect(fieldLocationLabel(1, true, favoredMonsterFor(1, 0)?.name, true)).toBe('おだやか・深い森');
  });
});

/** 危険度と よく出る敵は 賢者・予言者・忍者・遊び人 にだけ見える。仲間にいれば パーティで見える (docs/25 §ジョブ特性)。 */
describe('seesFieldDanger + fieldLocationLabel', () => {
  afterEach(() => setStory(null));
  const name = () => favoredMonsterFor(3, 0)?.name;
  const label = (hero: string, ids: string[] = []) => fieldLocationLabel(3, true, name(), seesFieldDanger(hero, { ids }));

  it('戦士だけだと 危険度も敵の名前も出さず、地形だけ', () => {
    expect(name()).toBeTruthy();
    expect(label('warrior')).toBe('深い森');
    expect(fieldLocationLabel(3, false, name(), seesFieldDanger('warrior', { ids: [] }))).toBe('フィールド');
  });

  it('賢者なら 危険度と敵の名前を出す', () => {
    expect(label('sage')).toBe(`危険・深い森 / ${name()}`);
  });

  it('戦士でも 忍者の仲間がいれば見える。巫女の仲間では見えない', () => {
    setStory({ recruits: [
      { id: 'n', name: 'カゲ', archetype: 'ninja', guild: 'g', line: 'よろしく。' },
      { id: 'm', name: 'ミオ', archetype: 'miko', guild: 'g', line: 'よろしく。' },
    ] });
    expect(label('warrior', ['n'])).toBe(`危険・深い森 / ${name()}`);
    expect(label('warrior', ['m'])).toBe('深い森');
    expect(label('warrior', ['gone'])).toBe('深い森');
  });
});
