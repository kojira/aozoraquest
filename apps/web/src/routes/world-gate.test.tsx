// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { DEFAULT_RUNTIME_CONFIG, type RuntimeConfig } from '@aozoraquest/types';
import { SessionContext, type SessionState } from '@/lib/session';
import { ConfigContext } from '@/components/config-provider';

// ゲーム本体は重い (権威 API を mount 時に叩く) ので、描かれたかどうかだけ分かる印に差し替える。
vi.mock('./world', () => ({ World: () => <div data-testid="game">ゲーム</div> }));

import { WorldGate } from './world-gate';

/** **BAN 済み DID で /world を開いてもゲーム UI を描画しない** (#561)。 */

function renderGate(session: SessionState, config: RuntimeConfig, loaded = true) {
  return render(
    <ConfigContext.Provider value={{ config, loaded }}>
      <SessionContext.Provider value={session}>
        <MemoryRouter initialEntries={['/world']}>
          <WorldGate />
        </MemoryRouter>
      </SessionContext.Provider>
    </ConfigContext.Provider>,
  );
}

const BANNED: RuntimeConfig = { ...DEFAULT_RUNTIME_CONFIG, bans: ['did:plc:bad'] };

describe('WorldGate', () => {
  it('BAN 済み DID には「利用できません」を出し、ゲームを描かない', () => {
    renderGate({ status: 'signed-in', did: 'did:plc:bad' }, BANNED);
    expect(screen.queryByTestId('game')).toBeNull();
    expect(screen.getByRole('status').textContent).toContain('利用できません');
  });

  it('BAN されていない DID はゲームに入る', () => {
    renderGate({ status: 'signed-in', did: 'did:plc:good' }, BANNED);
    expect(screen.getByTestId('game')).toBeTruthy();
  });

  it('BAN リストが空なら誰でも入る', () => {
    renderGate({ status: 'signed-in', did: 'did:plc:bad' }, DEFAULT_RUNTIME_CONFIG);
    expect(screen.getByTestId('game')).toBeTruthy();
  });

  it('設定を読み終えるまではゲームを mount しない (既定値 = BAN 無しで先に描かない)', () => {
    renderGate({ status: 'signed-in', did: 'did:plc:bad' }, DEFAULT_RUNTIME_CONFIG, false);
    expect(screen.queryByTestId('game')).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('未ログインは BAN 判定せずゲーム側 (ログイン導線) に任せる', () => {
    renderGate({ status: 'signed-out' }, BANNED);
    expect(screen.getByTestId('game')).toBeTruthy();
  });
});
