// @vitest-environment jsdom
/** 本番 (WORLD_PREVIEW_ENABLED=false) で /world を直打ちしても、プレースホルダだけを出し
 *  ワールドの hooks (初期ロードの書き込み・そうびの POST) を走らせない。 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { Agent } from '@atproto/api';
import { SessionContext } from '@/lib/session';
import { useWorldLoad } from '@/lib/use-world-load';
import { World } from './world';

vi.mock('@/lib/world-preview', () => ({ WORLD_PREVIEW_ENABLED: false }));
vi.mock('@/lib/use-world-load', () => ({ useWorldLoad: vi.fn() }));

afterEach(() => { vi.unstubAllGlobals(); });

describe('World のプレビューゲート', () => {
  it('ゲート off ではプレースホルダだけを出し、useWorldLoad も fetch も呼ばない', () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const agent = { assertDid: 'did:plc:test' } as unknown as Agent;
    render(
      <MemoryRouter>
        <SessionContext.Provider value={{ status: 'signed-in', did: 'did:plc:test', agent }}>
          <World />
        </SessionContext.Provider>
      </MemoryRouter>,
    );
    expect(screen.getByText('じゅんびちゅう… もうすこし待っててね。')).toBeTruthy();
    expect(useWorldLoad).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
