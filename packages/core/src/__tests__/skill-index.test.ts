import { describe, expect, it } from 'vitest';
import { startBattle, resolveTurn, JOBS, skillsForJob, SKILLS, skillMpCostOf } from '../index.js';

/**
 * **とくぎの表示と実行がずれない**ことを固定する。
 *
 * 実際にずれていた: 賢者 Lv3 で、戦闘のボタンは署名スキル
 * `playerSkill` (天啓の一手) を表示していたのに、押すと `playerSkills[0]` (火炎) が出ていた。
 * とくぎが 1 個のときだけ通る分岐だったので気づきにくかった。
 *
 * UI は `state.playerSkills` を並べて index で撃つので、**その配列と `skillIndex` の
 * 対応が唯一の正**。ここが崩れると「選んだ技と違う技が出る」になる。
 */
describe('とくぎの index が一覧と一致する', () => {
  it('playerSkills[i] を選ぶと、その技の**効果**が実際に出る (全職・全とくぎ)', () => {
    // **技名がログに出ることを見ても意味がない。** ログの技名は実行された SkillDef ではなく
    // 呼び出し側が渡した label (= selectedSkill.name) から出るので、中身が別の技にすり替わって
    // いてもログは正しい名前を出す (レビュー実測: 火炎の effects を heal に差し替えても
    // 「xの火炎! HP が 5 回復。」と出て素通りした)。**効果の種類**で確かめる。
    for (const job of JOBS) {
      for (const lv of [1, 3, 5, 10, 20, 30]) {
        const s = startBattle(job.id, lv, 1, 'x', 1, 5, 0);
        const list = s.playerSkills ?? [];
        expect(list.length, `${job.id} Lv${lv} のとくぎ一覧`).toBeGreaterThan(0);
        list.forEach((sk, i) => {
          const def = SKILLS[sk.kind];
          if (!def) throw new Error(`${job.id} Lv${lv} index=${i} ${sk.name} に SkillDef が無い`);
          const after = resolveTurn(s, 'skill', 1, i);
          const damaging = def.effects.some((e) => e.kind === 'damage' || e.kind === 'fixedDamage');
          const healing = def.effects.some((e) => e.kind === 'heal');
          const where = `${job.id} Lv${lv} index=${i} (${sk.name})`;
          if (damaging) {
            // 攻撃技なら敵の HP が減っているか、回避/耐性のログが出ている
            const hit = after.monster.hp < s.monster.hp
              || after.lastEvents.some((e) => e.actor === 'player' && (e.damage ?? 0) >= 0 && e.text.includes('ダメージ'));
            expect(hit, `${where}: 攻撃技なのに敵に何も起きていない`).toBe(true);
          }
          if (healing && s.player.hp < s.player.maxHp) {
            expect(after.lastEvents.some((e) => e.text.includes('回復')), `${where}: 回復技なのに回復ログが無い`).toBe(true);
          }
          // とくぎの MP コストは全技共通の単一値 (skillMpCostOf)。必ず消費している
          // = 「とくぎを撃った」こと自体の確認 (index がずれて何も起きていない、を弾く)。
          // ただし MP を戻す技 (探索者 サバイバル 等) は差し引きで増減しないので除く。
          const cost = skillMpCostOf(s.player);
          const restoresMp = def.effects.some((e) => e.kind === 'restoreMp');
          if (cost > 0 && !restoresMp) {
            expect(after.player.mp, `${where}: MP が減っていない`).toBeLessThan(s.player.mp);
          }
        });
      }
    }
  });

  it('署名スキル (playerSkill) はキット技を覚えても一覧に残る — 表示は playerSkills を使う', () => {
    // 実際にずれていた組み合わせ (賢者 Lv3) を名指しで固定する。一覧の [1] が火炎、
    // [0] が署名。表示ラベルは playerSkill ではなく押す index と同じ playerSkills から取ること。
    const s = startBattle('sage', 3, 1, 'x', 1, 5, 0);
    expect(s.playerSkills?.map((k) => k.name)).toEqual(['天啓の一手', '火炎']);
    expect(s.playerSkill.name).toBe('天啓の一手');
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
