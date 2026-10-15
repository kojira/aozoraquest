// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { QuestLogModal } from './quest-log-modal';
import type { QuestLogEntry } from '@/lib/game-quest';

const GUILD: QuestLogEntry = { id: 'g', section: 'guild', title: '道具の手入れに', giver: '依頼: Blueskyちゃん（ふたばの村 ギルド）', progress: 'スライムのしずくを 2 こ (2/2)', ready: true, detail: '条件: スライムのしずくを 2 こ。報酬: やくそう ×2。' };
const PERSONAL: QuestLogEntry = { id: 'p', section: 'personal', title: 'スライム たいじ', giver: '依頼: むらおさ（ふたばの村）', progress: 'そらいろスライムを 3 たい (1/3)', ready: false, detail: '条件: そらいろスライムを 3 たい。報酬: なし。' };
const GONE: QuestLogEntry = { id: 'gone', section: 'personal', title: '依頼情報を確認できません（gone）', ready: false };

afterEach(cleanup);

describe('QuestLogModal', () => {
  it('splits guild and personal quests and expands terms on tap', () => {
    render(<QuestLogModal entries={[GUILD, PERSONAL]} onClose={vi.fn()} />);
    const guild = screen.getByRole('region', { name: 'ギルドの依頼' });
    const personal = screen.getByRole('region', { name: '個人の依頼' });
    expect(guild.textContent).toContain('依頼: Blueskyちゃん（ふたばの村 ギルド）');
    expect(guild.textContent).toContain('報告できます');
    expect(personal.textContent).toContain('依頼: むらおさ（ふたばの村）');
    expect(personal.textContent).toContain('(1/3)');
    expect(personal.textContent).not.toContain('報告できます');
    expect(screen.queryByText(PERSONAL.detail!)).toBeNull();
    const item = within(personal).getByRole('button', { expanded: false });
    fireEvent.click(item);
    expect(screen.getByText(PERSONAL.detail!)).toBeTruthy();
    expect(item.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText(/所持品は ほかの依頼/)).toBeTruthy();
  });
  it('shows empty sections and closes', () => {
    const close = vi.fn();
    render(<QuestLogModal entries={[]} onClose={close} />);
    expect(screen.getByRole('dialog', { name: 'クエスト' })).toBeTruthy();
    expect(screen.getAllByText('受注中の依頼は ありません')).toHaveLength(2);
    expect(screen.queryByText(/所持品は ほかの依頼/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'とじる' }));
    expect(close).toHaveBeenCalledOnce();
  });
  it('keeps an unknown quest visible without details', () => {
    render(<QuestLogModal entries={[GONE]} onClose={vi.fn()} />);
    const personal = screen.getByRole('region', { name: '個人の依頼' });
    expect(within(personal).getByRole('button', { name: /依頼情報を確認できません（gone）/ }).hasAttribute('disabled')).toBe(true);
    expect(within(screen.getByRole('region', { name: 'ギルドの依頼' })).getByText('受注中の依頼は ありません')).toBeTruthy();
  });
});
