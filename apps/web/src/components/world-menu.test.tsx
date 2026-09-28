// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, cleanup } from '@testing-library/react';
import { WorldMenu } from './world-menu';

describe('WorldMenu: all active quests', () => {
  const commands = [{ key: 'items', label: 'どうぐ', onSelect: vi.fn() }];
  it('shows every quest and shared inventory explanation with reachable exit', () => {
    const close = vi.fn();
    render(<WorldMenu commands={commands} questLines={['討伐 (2/3)', '納品 所持 2 / 必要 2']} onClose={close} />);
    expect(screen.getByText('受注中の依頼 2件')).toBeTruthy();
    expect(screen.getByText('討伐 (2/3)')).toBeTruthy();
    expect(screen.getByText('納品 所持 2 / 必要 2')).toBeTruthy();
    expect(screen.getByText(/所持品は ほかの依頼/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '閉じる' }));
    expect(close).toHaveBeenCalledOnce();
    cleanup();
  });
  it('explicitly shows no active quests', () => {
    render(<WorldMenu commands={commands} questLines={[]} onClose={vi.fn()} />);
    expect(screen.getByText('受注中の依頼は ありません')).toBeTruthy();
    cleanup();
  });
});
