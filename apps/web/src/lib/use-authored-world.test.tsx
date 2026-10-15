// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useAuthoredWorld } from './use-authored-world';
import { loadAuthoredWorld } from './world-authoring';
import type { Agent } from '@atproto/api';

vi.mock('./world-authoring', () => ({ loadAuthoredWorld: vi.fn() }));

/**
 * **管理エディタは保存済みレコードを読み込むまで保存させない** (#603)。
 *
 * エディタを URL 直打ちで開くと、メモリの定義は空/コード直書きのまま。その状態で
 * 保存すると PDS レコードを丸ごと上書きして既存の編集が消える。読み込みが終わるまで
 * `false` を返し、終わった瞬間に `reset` で一覧を現物から取り直させる。
 */
describe('useAuthoredWorld', () => {
  const load = vi.mocked(loadAuthoredWorld);
  let resolve: () => void;

  beforeEach(() => {
    load.mockReset();
    load.mockImplementation(() => new Promise<void>((r) => { resolve = r; }));
  });

  it('読み込みが終わるまで false、終わると reset を呼んで true', async () => {
    const reset = vi.fn();
    const agent = {} as Agent;
    const { result } = renderHook(() => useAuthoredWorld(agent, reset));
    expect(result.current).toBe(false);
    expect(load).toHaveBeenCalledWith(agent);
    expect(reset).not.toHaveBeenCalled();

    await act(async () => { resolve(); });
    expect(reset).toHaveBeenCalledTimes(1);
    expect(result.current).toBe(true);
  });

  it('読み込みに失敗しても reset を呼んで true (loadAuthoredWorld は失敗を握り潰す前提)', async () => {
    let reject: (e: unknown) => void = () => {};
    load.mockImplementation(() => new Promise<void>((_, rj) => { reject = rj; }));
    const reset = vi.fn();
    const { result } = renderHook(() => useAuthoredWorld(null, reset));
    await act(async () => { reject(new Error('x')); });
    expect(reset).toHaveBeenCalledTimes(1);
    expect(result.current).toBe(true);
  });

  it('agent が変わったら読み直し、その間は false に戻る', async () => {
    const reset = vi.fn();
    const a1 = {} as Agent;
    const a2 = {} as Agent;
    const { result, rerender } = renderHook(({ agent }) => useAuthoredWorld(agent, reset), { initialProps: { agent: a1 } });
    await act(async () => { resolve(); });
    expect(result.current).toBe(true);

    rerender({ agent: a2 });
    expect(result.current).toBe(false);
    expect(load).toHaveBeenLastCalledWith(a2);
    await act(async () => { resolve(); });
    expect(reset).toHaveBeenCalledTimes(2);
    expect(result.current).toBe(true);
  });

  it('アンマウント後に読み込みが終わっても reset を呼ばない', async () => {
    const reset = vi.fn();
    const { unmount } = renderHook(() => useAuthoredWorld(null, reset));
    unmount();
    await act(async () => { resolve(); });
    expect(reset).not.toHaveBeenCalled();
  });
});
