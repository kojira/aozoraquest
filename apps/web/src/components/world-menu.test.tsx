// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, cleanup } from '@testing-library/react';
import { WorldMenu } from './world-menu';

describe('WorldMenu', () => {
  it('shows commands only (quest list lives in the クエスト window) and closes on select', () => {
    const close = vi.fn();
    const openQuests = vi.fn();
    render(<WorldMenu commands={[{ key: 'items', label: 'どうぐ', onSelect: vi.fn() }, { key: 'quests', label: 'クエスト', onSelect: openQuests }]} onClose={close} />);
    expect(screen.queryByText(/受注中の依頼/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'クエスト' }));
    expect(openQuests).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
    cleanup();
  });
});
