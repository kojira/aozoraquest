// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { WorldMenu } from './world-menu';

/**
 * 受注中クエストの 1 行 (#659)。受注中でなければ**行ごと出さない** —
 * 「クエスト: なし」のような空の行は情報量を増やすだけで、DQ 風の窓に要らない。
 */
describe('WorldMenu: 受注中クエストの 1 行', () => {
  const COMMANDS = [{ key: 'items', label: 'どうぐ', onSelect: vi.fn() }];

  it('questLine があれば「クエスト: …」を 1 行出す', () => {
    render(<WorldMenu commands={COMMANDS} questLine="そらいろスライムを 3 たい (2/3)" onClose={vi.fn()} />);
    expect(screen.getByText('クエスト: そらいろスライムを 3 たい (2/3)')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'どうぐ' })).toBeTruthy();
  });

  it('questLine が無ければ行を出さない', () => {
    render(<WorldMenu commands={COMMANDS} onClose={vi.fn()} />);
    expect(screen.queryByText(/クエスト/)).toBeNull();
  });
});
