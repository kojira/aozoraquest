// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DialogueWindow } from './dialogue-window';

/**
 * **セリフ窓のタップは祖先に伝わってはいけない** (#638)。
 *
 * セリフ窓は「どこをタップしても進む」ために画面全体を覆う透明な送り面を持つ。
 * なんでも屋の店窓 (`ShopModal`) は「背景タップで閉じる」オーバーレイの**中**に
 * セリフ窓を描くので、送り面の click がそのまま親に届くと
 *
 *   - あいさつをタップした瞬間に店ごと閉じる
 *   - 送り面に吸われて「つくってもらう」も押せない (= アイテムが作れない)
 *
 * になる (実際に村のなんでも屋が使えなくなっていた)。
 * 送り面を持つ側 (このコンポーネント) で止めるのが正しいので、ここで固定する。
 */
describe('DialogueWindow: 祖先へ click を伝えない', () => {
  const LINES = [{ speaker: '店主', text: 'いらっしゃい' }, { text: 'なにか つくるかい' }];

  function renderInClosingOverlay() {
    const onClose = vi.fn();
    const onDone = vi.fn();
    render(
      // ShopModal と同じ構造: 背景タップで閉じるオーバーレイの中にセリフ窓を置く
      <div data-testid="overlay" onClick={onClose}>
        <button type="button">つくってもらう</button>
        <DialogueWindow lines={LINES} onDone={onDone} />
      </div>,
    );
    return { onClose, onDone };
  }

  it('送り面をタップしても親の onClose が呼ばれない', () => {
    const { onClose } = renderInClosingOverlay();
    // 送り面 = 全画面の当たり判定 (role=dialog)。窓本体も同じ扱い。
    const surfaces = screen.getAllByRole('dialog');
    expect(surfaces.length).toBeGreaterThan(0);
    for (const el of surfaces) fireEvent.click(el);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('タップでセリフは進む (止めているのは伝播だけ)', () => {
    renderInClosingOverlay();
    const surface = screen.getAllByRole('dialog')[0]!;
    // 表示テキストはスクリーンリーダー用の複製もあるので getAllByText で見る
    // 1 タップ目でタイプ中の行が全文表示になる
    fireEvent.click(surface);
    expect(screen.getAllByText(/いらっしゃい/).length).toBeGreaterThan(0);
    // 2 タップ目で次の行へ
    fireEvent.click(surface);
    expect(screen.getAllByText(/なにか つくるかい/).length).toBeGreaterThan(0);
  });
});
