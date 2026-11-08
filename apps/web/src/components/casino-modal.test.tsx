// @vitest-environment jsdom
/**
 * カジノの窓 (D-CASINO-001 PR3)。★のマスごとの窓・最初の両替の注意・サーバーの結果を見せる・断られたらことばを出す。
 * なまえのふだ (パーティの画面)。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { Agent } from '@atproto/api';

const serverStateMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/world-server', async (orig) => ({ ...(await orig<typeof import('@/lib/world-server')>()), serverState: serverStateMock }));

import { CasinoModal, type CasinoActions } from './casino-modal';
import { PartyModal } from './party-modal';
import { useCasino } from '@/lib/use-casino';
import { WorldServerError, type ServerParty } from '@/lib/world-server';

const actions = (over: Partial<CasinoActions> = {}): CasinoActions => ({
  exchange: vi.fn(async (p: number) => ({ coins: p * 10, power: 0 })),
  bonus: vi.fn(async () => ({ coins: 50 })),
  prize: vi.fn(async () => ({ coins: 0 })),
  play: vi.fn(async () => ({ coins: 0 })),
  raceLineup: vi.fn(async () => [0, 1, 2, 3, 4].map((i) => ({ id: `m${i}`, name: `モン${i}`, species: 'slime' }))),
  ...over,
});
afterEach(() => { cleanup(); localStorage.clear(); });

describe('CasinoModal', () => {
  it('両替: 最初の 1 回だけ「パワーに戻せません」を出し、わかった のあとで両替できる', async () => {
    const a = actions();
    render(<CasinoModal spot={{ kind: 'exchange' }} coins={0} power={20} actions={a} onClose={() => {}} />);
    expect(screen.getByRole('note').textContent).toContain('コインはパワーに戻せません');
    expect(screen.queryByRole('button', { name: /パワー 10/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'わかった' }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /パワー 10/ })); });
    expect(a.exchange).toHaveBeenCalledWith(10);
    expect(screen.getByRole('status').textContent).toContain('コイン 100 枚');
    cleanup();
    render(<CasinoModal spot={{ kind: 'exchange' }} coins={0} power={20} actions={a} onClose={() => {}} />);
    expect(screen.queryByRole('note')).toBeNull();
  });

  it('上限に当たったら サーバーのことばを そのまま出す', async () => {
    const a = actions({ play: vi.fn(async () => { throw new WorldServerError('すこし休んでいきませんか。また少ししたら遊べます。', 429, 'rate_minute'); }) });
    render(<CasinoModal spot={{ kind: 'game', game: 'slots' }} coins={100} power={0} actions={a} onClose={() => {}} />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'まわす' })); });
    expect(screen.getByRole('alert').textContent).toBe('すこし休んでいきませんか。また少ししたら遊べます。');
  });

  it('スロット: サーバーの絵柄を出し、あおぞら 3 つは大当たりのことば', async () => {
    const a = actions({ play: vi.fn(async () => ({ coins: 5000, outcomes: [{ game: 'slots' as const, reels: ['aozora', 'aozora', 'aozora'], respun: null, payout: 5000 }] })) });
    render(<CasinoModal spot={{ kind: 'game', game: 'slots' }} coins={100} power={0} actions={a} onClose={() => {}} />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'まわす' })); });
    expect(screen.getAllByTestId('reel').map((r) => r.textContent)).toEqual(['あおぞら', 'あおぞら', 'あおぞら']);
    expect(screen.getByRole('status').textContent).toContain('あおぞらが みっつ そろった');
  });

  it('ハイロー: 配ったら 上・下 を出し、勝てる数の無いほうは押せない', async () => {
    const a = actions({ play: vi.fn(async () => ({ coins: 90, highlow: { first: 13, stake: 10, step: 0, canContinue: true } })) });
    render(<CasinoModal spot={{ kind: 'game', game: 'highlow' }} coins={100} power={0} actions={a} onClose={() => {}} />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'くばる' })); });
    expect(screen.getByRole('button', { name: /^上/ })).toHaveProperty('disabled', true);
    expect(screen.getByRole('button', { name: /^下/ })).toHaveProperty('disabled', false);
  });

  it('ハイロー: 窓を開き直すと、サーバーに残っている手 (casinoHL) を続きから出す。コイン 0 でも 選ぶ・やめる を押せる', async () => {
    serverStateMock.mockResolvedValue({ state: { casinoCoins: 0, casinoHL: { first: 7, stake: 40, step: 2 } }, initialized: true });
    function World() {
      const c = useCasino({ agent: {} as Agent, tokenRef: { current: undefined }, setServerPower: () => {}, applyServerMaterials: () => {}, onPieces: () => {} });
      return (
        <>
          <button type="button" onClick={() => c.openCasino({ kind: 'game', game: 'highlow' })}>ハイローの台</button>
          {c.casinoSpot && <CasinoModal spot={c.casinoSpot} coins={c.casinoCoins} power={0} actions={c.casinoActions} pendingHighLow={c.casinoPendingHighLow} onClose={c.closeCasino} />}
        </>
      );
    }
    render(<World />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'ハイローの台' })); });
    expect(screen.getByTestId('casino-coins').textContent).toContain('0');
    expect(screen.getByLabelText('1 枚目 7').textContent).toBe('7');
    expect(screen.getByText(/いま 40 枚 \(続けたのは 2 回\)/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /^上/ })).toHaveProperty('disabled', false);
    expect(screen.getByRole('button', { name: /^下/ })).toHaveProperty('disabled', false);
    expect(screen.getByRole('button', { name: 'やめて 40 枚 受けとる' })).toHaveProperty('disabled', false);
    expect(screen.queryByRole('button', { name: 'くばる' })).toBeNull();
    serverStateMock.mockReset();
  });

  it('景品: コインが足りない品は押せない', async () => {
    render(<CasinoModal spot={{ kind: 'prize' }} coins={1500} power={0} actions={actions()} onClose={() => {}} />);
    expect(screen.getByRole('button', { name: 'なまえのふだを 1000 枚で こうかん' })).toHaveProperty('disabled', false);
    expect(screen.getByRole('button', { name: 'ほしのつるぎを 20000 枚で こうかん' })).toHaveProperty('disabled', true);
  });
});

describe('なまえのふだ (パーティの画面)', () => {
  const party: ServerParty = { ids: ['g:1'], members: [{ id: 'g:1', name: 'ミオ', archetype: 'miko', star: 2, minLevel: 1, line: 'よろしく。', xp: 0 }] };
  it('ふだが無ければ出さない。あれば 名前を変え、長すぎる名前は きめる を押せない', async () => {
    const { rerender } = render(<PartyModal jobLevel={1} load={async () => ({ party, flags: [] })} onClose={() => {}} rename={{ tags: 0, save: vi.fn() }} />);
    await act(async () => {});
    expect(screen.queryByRole('button', { name: 'ミオの なまえを かえる' })).toBeNull();
    const save = vi.fn(async () => {});
    rerender(<PartyModal jobLevel={1} load={async () => ({ party, flags: [] })} onClose={() => {}} rename={{ tags: 1, save }} />);
    await act(async () => {});
    fireEvent.click(screen.getByRole('button', { name: 'ミオの なまえを かえる' }));
    fireEvent.change(screen.getByLabelText('あたらしい なまえ'), { target: { value: 'あいうえおかきくけこさ' } });
    expect(screen.getByRole('button', { name: 'きめる' })).toHaveProperty('disabled', true);
    fireEvent.change(screen.getByLabelText('あたらしい なまえ'), { target: { value: 'ソラ' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'きめる' })); });
    expect(save).toHaveBeenCalledWith('g:1', 'ソラ');
    expect(screen.getByRole('button', { name: 'ソラの つよさ' })).toBeTruthy();
  });
});
