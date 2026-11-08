// @vitest-environment jsdom
/**
 * めいれい と さくせん の画面 (D-PARTY-004 A3)。
 * - めいれい の仲間がいると、主人公 → 仲間 (並び順) と入れてから 1 回で送る。見出しは「ミオ は どうする？（2/3）」
 * - 仲間の窓は その仲間のとくぎ。にげる の代わりに「もどる」(前の人へ) と「おまかせ」(この人から後ろは自動で送る)
 * - めいれい の仲間がいなければ 今までどおり 1 手で送る
 * - つよさの「さくせん」: ♥2 で 4 つ、♥3 で めいれいさせろ も。♥1 では出さない
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { playerCombatant, skillsForJob, startBattle, xpForAllyLevel, type AllyMode, type BattleState, type Combatant, type PartyRecruit } from '@aozoraquest/core';
import { WorldBattleControls } from './world-battle-controls';
import { PartyModal } from './party-modal';
import { useAllyOrders } from '@/lib/battle-ally-orders';

const mate = (archetype: Parameters<typeof playerCombatant>[0], level: number, name: string): Combatant => ({ ...playerCombatant(archetype, level, 1, name), job: { archetype, level } });
function battle(modes: Array<AllyMode | undefined>): BattleState {
  const base = startBattle('warrior', 5, 5, 'ゆうしゃ', 1, 3, 1);
  const allies = [base.player, mate('miko', 5, 'ミオ'), mate('mage', 5, 'ソラ')];
  return { ...base, allies, enemies: [base.monster], turn: 1, allyModes: modes, partyIds: ['g:m', 'g:s'] };
}

/** world.tsx と同じつなぎ方。 */
function Harness({ state, send }: { state: BattleState; send: (h: unknown, allies: unknown) => void }) {
  const o = useAllyOrders(state, 'b:1:input', send);
  return <WorldBattleControls state={o.view ?? state} phase="input" busy={false} showEnemyVitals={false} resultLines={[]} onAdvance={() => {}} onCommand={o.onCommand}
    allyOrder={o.heading ? { heading: o.heading, allyTurn: o.allyTurn, onBack: o.back, onAuto: o.auto } : undefined} />;
}

afterEach(cleanup);

describe('めいれい の入力', () => {
  it('主人公 → ミオ → ソラ と入れてから 1 回で送る。仲間の窓はその仲間のとくぎ', () => {
    const send = vi.fn();
    render(<Harness state={battle([undefined, 'manual', 'manual'])} send={send} />);
    expect(screen.getByText('ゆうしゃ は どうする？（1/3）')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'たたかう' }));
    expect(screen.getByText('ミオ は どうする？（2/3）')).toBeTruthy();
    expect(screen.getByRole('button', { name: skillsForJob('miko', 5)[1]!.name })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'にげる' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'ぼうぎょ' }));
    expect(screen.getByText('ソラ は どうする？（3/3）')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'ぼうぎょ' }));
    expect(send).toHaveBeenCalledOnce();
    expect(send.mock.calls[0]).toEqual([{ command: 'attack' }, [{ id: 'g:m', command: 'guard' }, { id: 'g:s', command: 'guard' }]]);
  });

  it('「もどる」で前の人へ、「おまかせ」でこの人から後ろは自動で送る', () => {
    const send = vi.fn();
    render(<Harness state={battle([undefined, 'manual', 'manual'])} send={send} />);
    fireEvent.click(screen.getByRole('button', { name: 'たたかう' }));
    fireEvent.click(screen.getByRole('button', { name: 'もどる' }));
    expect(screen.getByText('ゆうしゃ は どうする？（1/3）')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'ぼうぎょ' }));
    fireEvent.click(screen.getByRole('button', { name: 'ぼうぎょ' }));
    fireEvent.click(screen.getByRole('button', { name: 'おまかせ' }));
    expect(send.mock.calls[0]).toEqual([{ command: 'guard' }, [{ id: 'g:m', command: 'guard' }]]);
  });

  it('めいれい の仲間がいなければ 1 手で送り、見出しも出ない。にげる は主人公の 1 手で送る', () => {
    const send = vi.fn();
    render(<Harness state={battle([undefined, 'inochi', undefined])} send={send} />);
    expect(screen.queryByText(/どうする？/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'たたかう' }));
    expect(send).toHaveBeenCalledWith({ command: 'attack' }, []);
    const { result } = renderHook(() => useAllyOrders(battle([undefined, 'manual', undefined]), 'k', send));
    act(() => result.current.onCommand('flee'));
    expect(send).toHaveBeenLastCalledWith({ command: 'flee' }, []);
  });
});

describe('さくせん の切りかえ (つよさ)', () => {
  const MIO: PartyRecruit = { id: 'g:m', name: 'ミオ', archetype: 'miko', star: 2, minLevel: 1, line: 'よろしく。', xp: xpForAllyLevel('miko', 5) };
  async function open(bond: number) {
    const onMode = vi.fn(async () => {});
    render(<PartyModal jobLevel={5} load={async () => ({ party: { ids: [MIO.id], members: [MIO], bond: { [MIO.id]: bond } }, flags: [] })} onClose={() => {}} onMode={onMode} />);
    await act(async () => {});
    fireEvent.click(screen.getByRole('button', { name: 'ミオの つよさ' }));
    return onMode;
  }
  const labels = () => screen.queryAllByRole('radio').map((b) => b.textContent);

  it('♥1 では出さない。♥2 で 4 つ、♥3 で めいれいさせろ も', async () => {
    await open(59);
    expect(labels()).toEqual([]);
    cleanup();
    await open(60);
    expect(labels()).toEqual(['▸ おまかせ', 'ガンガンいこうぜ', 'いのちだいじに', 'じゅもんせつやく']);
    cleanup();
    await open(150);
    expect(labels()).toContain('めいれいさせろ');
  });

  it('選ぶとサーバーへ送り、選んだものに ▸。おまかせ は null', async () => {
    const onMode = await open(150);
    await act(async () => { fireEvent.click(screen.getByRole('radio', { name: 'いのちだいじに' })); });
    expect(onMode).toHaveBeenCalledWith('g:m', 'inochi');
    expect(screen.getByRole('radio', { checked: true }).textContent).toBe('▸ いのちだいじに');
    await act(async () => { fireEvent.click(screen.getByRole('radio', { name: 'おまかせ' })); });
    expect(onMode).toHaveBeenLastCalledWith('g:m', null);
  });
});
