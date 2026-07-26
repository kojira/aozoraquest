import { describe, it, expect } from 'vitest';
import { xpOfJob } from '../use-job-xp';

/**
 * #534 の中心的な契約: **「まだ分からない」と「本当に 0」を混ぜない**。
 *
 * このリリースは全員が本当に Lv1 になるので、通信できないことを 0 に丸めると
 * 障害と本物のリセットがプレイヤーから見分けられなくなる。実際、最初の実装は
 * `xpOfJob` が 0 を返しており、呼び出し側 4 画面すべてが LV1 を表示していた。
 */
describe('xpOfJob (権威 XP の読み出し)', () => {
  it('取得できていない (null) ときは null を返す — 0 に丸めない', () => {
    expect(xpOfJob(null, 'warrior')).toBeNull();
  });

  it('職が未確定のときも null', () => {
    expect(xpOfJob({ warrior: 100 }, null)).toBeNull();
    expect(xpOfJob({ warrior: 100 }, undefined)).toBeNull();
    expect(xpOfJob({ warrior: 100 }, '')).toBeNull();
  });

  it('その職でまだ稼いでいなければ 0 (これは本物の Lv1)', () => {
    expect(xpOfJob({}, 'warrior')).toBe(0);
    expect(xpOfJob({ mage: 500 }, 'warrior')).toBe(0);
  });

  it('職ごとに別々に読む (転職しても前職のぶんが残る)', () => {
    const map = { warrior: 100, mage: 500 };
    expect(xpOfJob(map, 'warrior')).toBe(100);
    expect(xpOfJob(map, 'mage')).toBe(500);
  });

  it('壊れた値 (NaN / 負 / 文字列) は 0 に倒す', () => {
    expect(xpOfJob({ warrior: Number.NaN }, 'warrior')).toBe(0);
    expect(xpOfJob({ warrior: -5 }, 'warrior')).toBe(0);
    expect(xpOfJob({ warrior: 'x' } as unknown as Record<string, number>, 'warrior')).toBe(0);
  });
});
