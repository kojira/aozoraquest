// @vitest-environment jsdom
/** 文の欄の「表示: …」(D-CHAR-001 §2-7)。トークンがあるときだけ、置き換えた結果を 1 行出す。使える id の一覧も出す。 */
import { afterEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { setCharacters } from '@aozoraquest/core';
import { CharacterIdList, CharacterPreview } from './character-preview';

afterEach(() => { setCharacters(null); });

describe('CharacterPreview', () => {
  it('トークンがあれば今の名前に置き換えて「表示: …」を出す', () => {
    setCharacters([{ id: 'bluesky', name: 'Bluesky' }]);
    render(<CharacterPreview text="ほむらの {c:bluesky}ちゃん" />);
    expect(screen.getByText('表示: ほむらの Blueskyちゃん')).toBeTruthy();
  });
  it('トークンが無ければ何も出さない', () => {
    const { container } = render(<CharacterPreview text="ほむらの 宿" />);
    expect(container.textContent).toBe('');
  });
  it('使える id の一覧を出す', () => {
    setCharacters([{ id: 'twitter', name: 'Twitter' }, { id: 'homura-town', name: 'ほむら' }]);
    render(<MemoryRouter><CharacterIdList /></MemoryRouter>);
    expect(screen.getByText(/\{c:twitter\} Twitter/)).toBeTruthy();
    expect(screen.getByText(/\{c:homura-town\} ほむら/)).toBeTruthy();
  });
});
