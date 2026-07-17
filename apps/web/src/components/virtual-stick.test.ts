import { describe, expect, it } from 'vitest';
import { stickDirFor } from './virtual-stick';

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
