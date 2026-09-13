// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { act, render, screen, fireEvent } from '@testing-library/react';
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

/**
 * **選択肢 (はい / いいえ)** (#659)。最後の行を読み終えたら選択肢を出し、選ぶまで閉じない。
 * 依頼を聞き終えただけで受注してしまわないための入口なので、「送り面のタップで
 * 勝手に閉じて onDone が走る」ことも「いいえ で はい が呼ばれる」こともあってはならない。
 */
describe('DialogueWindow: 選択肢', () => {
  const LINES = [{ speaker: 'そんちょう', text: 'たのむ' }, { speaker: 'そんちょう', text: 'うけますか？' }];

  function renderWithChoices() {
    const onYes = vi.fn();
    const onNo = vi.fn();
    const onDone = vi.fn();
    render(<DialogueWindow lines={LINES} onDone={onDone} choices={[{ label: 'はい', onSelect: onYes }, { label: 'いいえ', onSelect: onNo }]} />);
    const surface = screen.getAllByRole('dialog')[0]!;
    // 1 行目: 全文 → 次へ。2 行目: 全文 (ここで選択肢が出る)
    fireEvent.click(surface);
    fireEvent.click(surface);
    fireEvent.click(surface);
    return { onYes, onNo, onDone, surface };
  }

  it('最後の行を読み終えると選択肢が出て、送り面のタップでは閉じない', () => {
    const { onDone, surface } = renderWithChoices();
    expect(screen.getByRole('button', { name: 'はい' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'いいえ' })).toBeTruthy();
    fireEvent.click(surface);
    fireEvent.keyDown(surface, { key: 'Enter' });
    expect(onDone).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'はい' })).toBeTruthy();
  });

  it('途中の行では選択肢を出さない', () => {
    render(<DialogueWindow lines={LINES} onDone={vi.fn()} choices={[{ label: 'はい', onSelect: vi.fn() }, { label: 'いいえ', onSelect: vi.fn() }]} />);
    fireEvent.click(screen.getAllByRole('dialog')[0]!); // 1 行目を全文表示
    expect(screen.queryByRole('button', { name: 'はい' })).toBeNull();
  });

  it('はい → その onSelect だけが呼ばれ、続けて onDone', () => {
    const { onYes, onNo, onDone } = renderWithChoices();
    fireEvent.click(screen.getByRole('button', { name: 'はい' }));
    expect(onYes).toHaveBeenCalledTimes(1);
    expect(onNo).not.toHaveBeenCalled();
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('いいえ → その onSelect だけが呼ばれ、続けて onDone', () => {
    const { onYes, onNo, onDone } = renderWithChoices();
    fireEvent.click(screen.getByRole('button', { name: 'いいえ' }));
    expect(onNo).toHaveBeenCalledTimes(1);
    expect(onYes).not.toHaveBeenCalled();
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('選択肢が無ければ従来どおり最後の行のタップで閉じる', () => {
    const onDone = vi.fn();
    render(<DialogueWindow lines={LINES} onDone={onDone} />);
    const surface = screen.getAllByRole('dialog')[0]!;
    for (let i = 0; i < 4; i++) fireEvent.click(surface);
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});


describe('DialogueWindow: 送信中と失敗', () => {
  it('選択の二重送信を防ぎ、失敗時は閉じずに再試行できる', async () => {
    let reject!: (error: Error) => void;
    const onYes = vi.fn().mockImplementationOnce(() => new Promise<void>((_, no) => { reject = no; })).mockResolvedValue(undefined);
    const onDone = vi.fn();
    render(<DialogueWindow lines={[{ text: 'うけますか？' }]} onDone={onDone} choices={[{ label: 'はい', onSelect: onYes }]} />);
    fireEvent.click(screen.getAllByRole('dialog')[0]!);
    const yes = screen.getByRole('button', { name: 'はい' });
    fireEvent.click(yes); fireEvent.click(yes);
    expect(onYes).toHaveBeenCalledTimes(1);
    expect(onDone).not.toHaveBeenCalled();
    await act(async () => reject(new Error('offline')));
    expect(onDone).not.toHaveBeenCalled();
    await act(async () => fireEvent.click(yes));
    expect(onYes).toHaveBeenCalledTimes(2);
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});
