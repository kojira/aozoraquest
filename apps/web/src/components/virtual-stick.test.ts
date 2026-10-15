import { describe, expect, it } from 'vitest';
import { isSelfTap, stickDirFor } from './virtual-stick';

describe('stickDirFor (デッドゾーン + 支配軸 + ヒステリシス)', () => {
  it('デッドゾーン未満は null (タップ誤爆防止)', () => {
    expect(stickDirFor(0, 0, null)).toBeNull();
    expect(stickDirFor(9, 9, null)).toBeNull(); // hypot ≈ 12.7 < 14
    expect(stickDirFor(13, 0, 'right')).toBeNull(); // 現方向があっても戻せば止まる
  });

  it('支配軸で 4 方向に量子化される', () => {
    expect(stickDirFor(30, 5, null)).toBe('right');
    expect(stickDirFor(-30, 5, null)).toBe('left');
    expect(stickDirFor(5, 30, null)).toBe('down');
    expect(stickDirFor(5, -30, null)).toBe('up');
  });

  it('ヒステリシス: 斜め 45° 付近のジッタで軸が反転しない', () => {
    // right で歩行中、|dy| が |dx| をわずかに超えても right を維持
    expect(stickDirFor(30, 32, 'right')).toBe('right');
    expect(stickDirFor(30, 36, 'right')).toBe('right'); // 36 < 30*1.25
    // マージン (1.25 倍) を超えたら切り替わる
    expect(stickDirFor(30, 40, 'right')).toBe('down');
    // 縦横逆も同様
    expect(stickDirFor(32, 30, 'down')).toBe('down');
    expect(stickDirFor(40, 30, 'down')).toBe('right');
  });

  it('同軸内の反転 (right → left) はヒステリシスなしで即時', () => {
    expect(stickDirFor(-30, 5, 'right')).toBe('left');
    expect(stickDirFor(5, -30, 'down')).toBe('up');
  });
});

describe('isSelfTap (自分タップでコマンドメニュー)', () => {
  const base = { elapsedMs: 100, movedPx: 3, fromCenterPx: 10, minSide: 360 }; // 中央半径 = 79.2px
  it('短時間・小移動・中央付近ならタップ', () => {
    expect(isSelfTap(base)).toBe(true);
  });
  it('長押し (400ms 超) はタップにしない', () => {
    expect(isSelfTap({ ...base, elapsedMs: 500 })).toBe(false);
  });
  it('大きく動いた (12px 超) はタップにしない (= ドラッグ移動)', () => {
    expect(isSelfTap({ ...base, movedPx: 20 })).toBe(false);
  });
  it('中央から遠い (半径外) タップは無視 (端はスクロール/移動用)', () => {
    expect(isSelfTap({ ...base, fromCenterPx: 100 })).toBe(false); // > 79.2
  });
});
