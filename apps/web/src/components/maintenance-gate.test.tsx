// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { DEFAULT_RUNTIME_CONFIG, type RuntimeConfig } from '@aozoraquest/types';
import { SessionContext, type SessionState } from '@/lib/session';
import { ConfigContext } from '@/components/config-provider';
import { MaintenanceGate, maintenanceExemptPath } from './maintenance-gate';

/**
 * **メンテナンス中は全ルートがメンテ画面に差し替わる** (#561)。
 * 誰を通すか (管理者 / allowedDids) は isUnderMaintenance が決め、ここは
 * 「画面が差し替わる / /admin だけは入れる」を固定する。
 */

const MAINT: RuntimeConfig = {
  ...DEFAULT_RUNTIME_CONFIG,
  maintenance: { enabled: true, message: 'いま直しています', until: '2026-09-02T10:00:00+09:00', updatedAt: 'x' },
};

function renderAt(path: string, session: SessionState, config: RuntimeConfig = MAINT) {
  return render(
    <ConfigContext.Provider value={{ config, loaded: true }}>
      <SessionContext.Provider value={session}>
        <MemoryRouter initialEntries={[path]}>
          <MaintenanceGate>
            <div data-testid="content">本体</div>
          </MaintenanceGate>
        </MemoryRouter>
      </SessionContext.Provider>
    </ConfigContext.Provider>,
  );
}

const user: SessionState = { status: 'signed-in', did: 'did:plc:user' };

describe('MaintenanceGate', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('メンテ中の一般ユーザーはメンテ画面 (message と until が出て、本体は描かない)', () => {
    renderAt('/', user);
    expect(screen.queryByTestId('content')).toBeNull();
    expect(screen.getByRole('status').textContent).toContain('いま直しています');
    expect(screen.getByText(/終了予定/)).toBeTruthy();
  });

  it('未ログインもメンテ画面', () => {
    renderAt('/', { status: 'signed-out' });
    expect(screen.queryByTestId('content')).toBeNull();
    expect(screen.getByRole('status')).toBeTruthy();
  });

  it('管理者 (VITE_ADMIN_DIDS) は通る', () => {
    vi.stubEnv('VITE_ADMIN_DIDS', 'did:plc:admin');
    renderAt('/', { status: 'signed-in', did: 'did:plc:admin' });
    expect(screen.getByTestId('content')).toBeTruthy();
  });

  it('allowedDids の DID は通る', () => {
    const cfg: RuntimeConfig = { ...MAINT, maintenance: { ...MAINT.maintenance, allowedDids: ['did:plc:vip'] } };
    renderAt('/', { status: 'signed-in', did: 'did:plc:vip' }, cfg);
    expect(screen.getByTestId('content')).toBeTruthy();
  });

  it('/admin 配下はメンテ中でも到達できる (解除の導線)', () => {
    renderAt('/admin', user);
    expect(screen.getByTestId('content')).toBeTruthy();
  });

  it('ログイン経路 (/onboarding) は未ログインでも到達できる (管理者がログインして解除するため)', () => {
    renderAt('/onboarding', { status: 'signed-out' });
    expect(screen.getByTestId('content')).toBeTruthy();
  });

  it('メンテ中でなければ本体をそのまま描く', () => {
    renderAt('/', user, DEFAULT_RUNTIME_CONFIG);
    expect(screen.getByTestId('content')).toBeTruthy();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('message が空なら既定文を出す', () => {
    renderAt('/', user, { ...MAINT, maintenance: { enabled: true, updatedAt: 'x' } });
    expect(screen.getByRole('status').textContent).toContain('メンテナンス中です');
  });
});

describe('maintenanceExemptPath', () => {
  it('/admin と配下、ログイン経路だけ', () => {
    expect(maintenanceExemptPath('/admin')).toBe(true);
    expect(maintenanceExemptPath('/admin/map')).toBe(true);
    expect(maintenanceExemptPath('/onboarding')).toBe(true);
    expect(maintenanceExemptPath('/oauth/callback')).toBe(true);
    expect(maintenanceExemptPath('/')).toBe(false);
    expect(maintenanceExemptPath('/world')).toBe(false);
    expect(maintenanceExemptPath('/administrator')).toBe(false);
  });
});
