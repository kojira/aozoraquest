// @vitest-environment jsdom
/** /admin/characters (D-CHAR-001 §2-7): id・名前・参照数の一覧。名前を変えて保存できる。id は作ったあと変えられない。 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { Agent } from '@atproto/api';
import { setCharacters, setNpcs } from '@aozoraquest/core';
import { SessionContext } from '@/lib/session';
import { loadCharactersRecord, saveCharacters } from '@/lib/world-authoring';
import { AdminCharacters } from '../admin-characters';

vi.mock('@/lib/world-authoring', () => ({
  loadAuthoredWorld: vi.fn().mockResolvedValue(undefined),
  loadCharactersRecord: vi.fn(),
  saveCharacters: vi.fn().mockResolvedValue(undefined),
}));
const DID = 'did:plc:charadmin';
const agent = { assertDid: DID } as unknown as Agent;
const CHARS = [{ id: 'twitter', name: 'Twitter' }, { id: 'bluesky', name: 'Bluesky' }];
const mount = () => render(<MemoryRouter><SessionContext.Provider value={{ status: 'signed-in', did: DID, agent }}><AdminCharacters /></SessionContext.Provider></MemoryRouter>);

beforeEach(() => {
  vi.stubEnv('VITE_ADMIN_DIDS', DID);
  vi.mocked(loadCharactersRecord).mockImplementation(async () => { setCharacters(CHARS); return CHARS; });
  setNpcs([
    { id: 'a', name: '{c:bluesky}ちゃん', x: 1, y: 1, lines: ['{c:twitter}を知ってる？'] },
    { id: 'b', name: '{c:bluesky}', x: 2, y: 2, lines: ['やあ'] },
  ]);
});
afterEach(() => { vi.unstubAllEnvs(); setNpcs(null); setCharacters(null); vi.mocked(saveCharacters).mockClear(); });

describe('AdminCharacters', () => {
  it('人物ごとの参照数を出し、名前を変えて保存できる。id は入力欄にしない', async () => {
    mount();
    const row = await screen.findByRole('row', { name: /bluesky/ });
    expect(row.textContent).toContain('2か所');
    expect(screen.getByRole('row', { name: /twitter/ }).textContent).toContain('1か所');
    expect(screen.queryByDisplayValue('twitter')).toBeNull();
    fireEvent.change(screen.getByLabelText('twitter の名前'), { target: { value: 'あおいとり' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(saveCharacters).toHaveBeenCalledWith(agent, [{ id: 'twitter', name: 'あおいとり' }, { id: 'bluesky', name: 'Bluesky' }]));
  });

  it('人物を足せる。使われている人物は消せない', async () => {
    mount();
    await screen.findByRole('row', { name: /bluesky/ });
    fireEvent.change(screen.getByLabelText('新しい id'), { target: { value: 'homura-town' } });
    fireEvent.change(screen.getByLabelText('新しい名前'), { target: { value: 'ほむら' } });
    fireEvent.click(screen.getByRole('button', { name: '＋人物' }));
    expect(screen.getByRole('row', { name: /homura-town/ })).toBeTruthy();
    expect((screen.getByRole('button', { name: 'bluesky を消す' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'homura-town を消す' }) as HTMLButtonElement).disabled).toBe(false);
  });
});
