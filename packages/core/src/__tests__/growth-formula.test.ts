import { describe, it, expect } from 'vitest';
import { playerCombatant, playerStatsAt, JOBS, BATTLE_TUNING, type StatArray } from '../index.js';

/**
 * `growthOf` に一本化した後 (#520) も、`playerCombatant` と `playerStatsAt` が
 * **丸め以外は同一**であることを固定する。
 *
 * リファクタ時に `playerStatsAt.maxMp` の丸め基準だけ変えてしまい、レベルアップ演出の
 * MP 表示が 95% のケースで変わる (720 ケースでは MP 行が消える) 事故を起こした。
 * 既存の同期テストは `Math.round(raw) === combatant` しか見ないため**原理的に検出できない**
 * ので、生値そのものの不変条件をここで押さえる。
 */
describe('成長式の一貫性 (#520)', () => {
  const PROFILES: (StatArray | undefined)[] = [
    undefined,
    [20, 20, 20, 20, 20],
    [60, 10, 10, 10, 10],
    [10, 10, 10, 60, 10],
    [23, 17, 31, 13, 16], // 端数が出るプロフィール (丸めの境界を踏ませる)
    [7, 41, 3, 29, 20],
  ];

  it('playerStatsAt の生値を丸めると playerCombatant に一致する (全16職 × Lv1〜50 × 6 プロフィール)', () => {
    for (const j of JOBS) {
      for (let lv = 1; lv <= 50; lv++) {
        for (const p of PROFILES) {
          const c = playerCombatant(j.id, lv, 1, 'x', p);
          const raw = playerStatsAt(j.id, lv, 1, p);
          const at = `${j.id} Lv${lv}`;
          expect(Math.round(raw.atk), `${at} atk`).toBe(c.atk);
          expect(Math.round(raw.def), `${at} def`).toBe(c.def);
          expect(Math.round(raw.agi), `${at} agi`).toBe(c.agi);
          expect(Math.round(raw.int), `${at} int`).toBe(c.int);
          expect(Math.round(raw.luk), `${at} luk`).toBe(c.luk);
          expect(Math.round(raw.maxHp), `${at} maxHp`).toBe(c.maxHp);
          expect(Math.round(raw.maxMp), `${at} maxMp`).toBe(c.maxMp);
        }
      }
    }
  });

  it('playerStatsAt.maxMp は **生値** を返す = 上昇量が整数に量子化されない', () => {
    // この関数の存在理由が「上昇量を小数 1 桁で見せる」ことなので、MP だけ丸めた整数を
    // 基準にすると「毎レベル +1.5」が「+2 / +1」とガタつき、0 になった行は表示から消える。
    // 少なくとも 1 つの職・レベルで小数部を持つことを確かめれば、量子化への退行を検出できる。
    const hasFraction = JOBS.some((j) =>
      [1, 5, 10, 20].some((lv) => playerStatsAt(j.id, lv, 1).maxMp % 1 !== 0),
    );
    expect(hasFraction).toBe(true);
  });

  it('MP の式は mpBase + かしこさ × mpIntScale (丸めを挟まない)', () => {
    const t = BATTLE_TUNING;
    for (const j of JOBS) {
      for (const lv of [1, 13, 37]) {
        const raw = playerStatsAt(j.id, lv, 1);
        expect(raw.maxMp, `${j.id} Lv${lv}`).toBeCloseTo(t.mpBase + raw.int * t.mpIntScale, 10);
      }
    }
  });
});
