import { describe, it, expect } from 'vitest';
import { skillForJob, skillsForJob, JOB_SKILL_NAMES, startBattle, resolveTurn } from '../battle.js';
import { JOBS } from '../jobs.js';

describe('skillForJob', () => {
  it('全ジョブに特技があり、支配ステータスと kind が一致する', () => {
    const kinds = ['smash', 'parry', 'flurry', 'spell', 'gamble'] as const;
    for (const job of JOBS) {
      const skill = skillForJob(job.id);
      expect(skill.name).toBe(JOB_SKILL_NAMES[job.id]);
      let maxI = 0;
      for (let i = 1; i < job.stats.length; i++) if (job.stats[i]! >= job.stats[maxI]!) maxI = i;
      expect(skill.kind).toBe(kinds[maxI]);
    }
  });
  it('代表例: shogun=smash (atk型) / guardian=parry (def型) / ninja=flurry (agi型) / sage=spell (int型) / miko=gamble (luk型)', () => {
    expect(skillForJob('shogun').kind).toBe('smash');
    expect(skillForJob('guardian').kind).toBe('parry');
    expect(skillForJob('ninja').kind).toBe('flurry');
    expect(skillForJob('sage').kind).toBe('spell');
    expect(skillForJob('miko').kind).toBe('gamble');
  });
});

describe('skillsForJob (複数とくぎ #436)', () => {
  it('[0] は常に署名スキル (skillForJob と一致 = 後方互換)', () => {
    for (const job of JOBS) {
      const sig = skillForJob(job.id);
      const list1 = skillsForJob(job.id, 1);
      expect(list1[0]).toEqual(sig);
    }
  });
  it('キット職はレベルで習得、未習得帯は署名にフォールバック (#456)', () => {
    // miko は確定キット職。Lv1-2 は未習得帯で署名にフォールバック、Lv3 で癒しの鈴を習得。
    expect(skillsForJob('miko', 1)).toHaveLength(1); // 署名のみ
    expect(skillsForJob('miko', 2)).toHaveLength(1);
    expect(skillsForJob('miko', 3).map((s) => s.name)).toContain('癒しの鈴');
    // 全16職キット化済み。fighter (匠) も Lv3 でキット技を習得する (Lv1-2 は署名のみ)。
    expect(skillsForJob('fighter', 1)).toHaveLength(1);
    expect(skillsForJob('fighter', 3).map((s) => s.name)).toContain('からくり仕掛け');
  });
  it('回復とくぎは MP を払って maxHp の割合ぶん回復する (キットの heal)', () => {
    // paladin は聖光の癒し (heal) を Lv5 で覚える。HP を削ってから回復を選ぶ。
    // tier は想定プレイヤーレベル (#518)。tier3 の想定は Lv8 なので、そこに
    // 少し余裕を持たせた jobLv12 + 布の服を当てる (格下すぎると 3 ターンで倒して
    // しまい、格上すぎると回復ターンに落とされて、どちらでも検証が回らない)。
    let s = startBattle('paladin', 12, 8, '聖', 3, 3, 0, undefined, { equipIds: ['ar-cloth'] });
    const healIdx = s.playerSkills.findIndex((x) => x.name === '聖光の癒し');
    expect(healIdx).toBeGreaterThanOrEqual(0);
    for (let i = 0; i < 3 && s.outcome === 'ongoing'; i++) s = resolveTurn(s, 'attack', i * 7 + 1);
    expect(s.outcome).toBe('ongoing'); // 想定レベル帯なら 3 ターンで決着しない
    expect(s.player.hp).toBeLessThan(s.player.maxHp); // 削られている = 回復の検証が意味を持つ
    {
      const before = s.player.hp;
      const mpBefore = s.player.mp;
      s = resolveTurn(s, 'skill', 999, healIdx);
      expect(s.player.hp).toBeGreaterThan(before); // 回復した
      expect(s.player.hp).toBeLessThanOrEqual(s.player.maxHp); // maxHp を超えない
      expect(s.player.mp).toBeLessThan(mpBefore); // MP を消費した
    }
  });
  it('範囲外の skillIndex は署名スキルに安全側フォールバック (例外にしない)', () => {
    const s = startBattle('warrior', 5, 8, '戦士', 1, 5, 0);
    const next = resolveTurn(s, 'skill', 1, 99); // 存在しない index → [0] にフォールバック
    expect(next.turn).toBe(1); // 例外を投げず 1 ターン進む
  });
});
