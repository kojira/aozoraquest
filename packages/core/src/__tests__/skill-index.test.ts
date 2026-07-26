import { describe, expect, it } from 'vitest';
import { startBattle, resolveTurn, JOBS, skillsForJob } from '../index.js';

/**
 * **とくぎの表示と実行がずれない**ことを固定する。
 *
 * 実際にずれていた (オーナー報告 2026-07-27): 賢者 Lv3 で、戦闘のボタンは署名スキル
 * `playerSkill` (天啓の一手) を表示していたのに、押すと `playerSkills[0]` (火炎) が出ていた。
 * とくぎが 1 個のときだけ通る分岐だったので気づきにくかった。
 *
 * UI は `state.playerSkills` を並べて index で撃つので、**その配列と `skillIndex` の
 * 対応が唯一の正**。ここが崩れると「選んだ技と違う技が出る」になる。
 */
describe('とくぎの index が一覧と一致する', () => {
  it('playerSkills[i] を選ぶと、その技が実際に出る (全職・全とくぎ)', () => {
    for (const job of JOBS) {
      // とくぎが増える帯を広めに見る
      for (const lv of [1, 3, 5, 10, 20, 30]) {
        const s = startBattle(job.id, lv, 1, 'x', 1, 5, 0);
        const list = s.playerSkills ?? [];
        expect(list.length, `${job.id} Lv${lv} のとくぎ一覧`).toBeGreaterThan(0);
        list.forEach((sk, i) => {
          const after = resolveTurn(s, 'skill', 1, i);
          const text = after.lastEvents.map((e) => e.text).join(' ');
          // 技名がログに出る = その技が撃たれた。出ない技 (MP 不足等) はここでは起きない
          // (startBattle 直後は MP 満タン)。
          expect(text, `${job.id} Lv${lv} index=${i} で ${sk.name} が出ない`).toContain(sk.name);
        });
      }
    }
  });

  it('playerSkills は skillsForJob と同じ並び (UI と core の一覧がずれない)', () => {
    for (const job of JOBS) {
      for (const lv of [1, 5, 12, 30]) {
        const s = startBattle(job.id, lv, 1, 'x', 1, 5, 0);
        expect((s.playerSkills ?? []).map((k) => k.name), `${job.id} Lv${lv}`)
          .toEqual(skillsForJob(job.id, lv).map((k) => k.name));
      }
    }
  });
});
