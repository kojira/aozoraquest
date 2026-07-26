import { describe, it, expect } from 'vitest';
import { effectiveJobXp, applyPostXp, jobLevelFromXp, JOB_XP_CURVE, battleXpFor, XP_REWARDS, MONSTERS } from '../index.js';

/**
 * 現職 XP の合算 (#529)。
 *
 * ジョブ XP は保存場所が 3 つ (投稿=analysis / 戦闘=権威 state / クエスト=派生) に
 * 分かれており、以前は**場所ごとに違う組み合わせ**を使っていた。その結果、戦闘で得た XP は
 * どこにも効かず「けいけんち を N かくとく！」と表示しておいてレベルが上がらなかった。
 */
describe('effectiveJobXp (#529)', () => {
  it('3 つの出所を合算する', () => {
    expect(effectiveJobXp({ analysisXp: 100, battleXp: 50, questXp: 200 })).toBe(350);
  });

  it('省略された出所は 0 として扱う (画面が取得できなくてもクラッシュしない)', () => {
    expect(effectiveJobXp({})).toBe(0);
    expect(effectiveJobXp({ analysisXp: 100 })).toBe(100);
    expect(effectiveJobXp({ battleXp: 40 })).toBe(40);
    expect(effectiveJobXp({ analysisXp: undefined, battleXp: undefined, questXp: 7 })).toBe(7);
  });

  it('負にならない (壊れた state を渡されても LV 計算が壊れない)', () => {
    expect(effectiveJobXp({ analysisXp: -999, battleXp: 10 })).toBe(0);
  });

  it('戦闘 XP が実際にレベルを押し上げる', () => {
    // 投稿だけでは Lv1 のままだが、tier3 の敵を数体倒せば上がる、という関係を固定する。
    const lv2 = JOB_XP_CURVE.find((e) => e[0] === 2)![1];
    const oni = battleXpFor('blue-oni');
    expect(oni).toBeGreaterThan(0);
    const postsOnly = effectiveJobXp({ analysisXp: lv2 - 1 });
    const withBattles = effectiveJobXp({ analysisXp: lv2 - 1, battleXp: oni });
    expect(jobLevelFromXp(postsOnly)).toBe(1);
    expect(jobLevelFromXp(withBattles)).toBeGreaterThan(1);
  });

  describe('applyPostXp — 保存は投稿由来のみ / 判定は合算値', () => {
    // **保存側に battleXp が混ざると不可逆な事故になる**: GameState.jobXp と二重計上になり、
    // しかも次の投稿でさらに合算されて指数的に増える。書き込み先はユーザー PDS なので
    // 巻き戻せない。ここが唯一の防波堤なので厚めに固定する。

    it('保存する XP に battleXp を混ぜない', () => {
      for (const battleXp of [0, 1, 5000, 999999]) {
        expect(applyPostXp(100, 30, battleXp).savedXp, `battleXp=${battleXp}`).toBe(130);
      }
    });

    it('投稿を繰り返しても保存値が発散しない (二重計上が起きていない)', () => {
      // 二重計上があると、保存値が battleXp を取り込んで指数的に増える。
      let xp = 0;
      for (let i = 0; i < 50; i++) xp = applyPostXp(xp, 5, 5000).savedXp;
      expect(xp).toBe(250); // 5 XP × 50 回ぴったり
    });

    it('レベルアップ判定は合算値で行う', () => {
      // 投稿由来だけでは Lv1→1 (上がらない) だが、戦闘 XP と合わせるとしきい値を跨ぐケース。
      const lv2 = JOB_XP_CURVE.find((e) => e[0] === 2)![1];
      const lv3 = JOB_XP_CURVE.find((e) => e[0] === 3)![1];
      const battleXp = lv2;
      const r = applyPostXp(lv3 - lv2 - 1, 2, battleXp); // 合算で lv3 を跨ぐ
      expect(r.leveledUp).toBeDefined();
      expect(r.leveledUp!.to).toBeGreaterThan(r.leveledUp!.from);
      // 同じ投稿でも battleXp が無ければ跨がない = 判定が合算値である証拠
      expect(applyPostXp(lv3 - lv2 - 1, 2, 0).leveledUp).toBeUndefined();
    });

    it('レベルが上がらなければ leveledUp を返さない', () => {
      expect(applyPostXp(0, 1, 0).leveledUp).toBeUndefined();
    });
  });

  it('戦闘 XP のスケールが投稿 XP と噛み合っている (オーナー確認 2026-07-25)', () => {
    // 「戦闘を楽しむために投稿する」= 1 投稿 = 1 パワー = 1 戦闘 で、戦闘の方が実入りが大きい、
    // という設計。tier1 は投稿と同程度、上位 tier ほど濃い、という関係を固定する。
    // ここが崩れると「どこで XP を稼ぐのが正解か」の設計が黙って変わる。
    const avgOf = (tier: 1 | 2 | 3) => {
      const ms = MONSTERS.filter((m) => m.tier === tier && m.species !== 'metal-slime');
      return ms.reduce((s, m) => s + battleXpFor(m.id), 0) / ms.length;
    };
    const post = XP_REWARDS.postMatch;
    expect(avgOf(1)).toBeGreaterThan(post * 0.5); // tier1 は投稿と同程度 (0.5〜2 倍)
    expect(avgOf(1)).toBeLessThan(post * 2);
    expect(avgOf(2)).toBeGreaterThan(avgOf(1) * 3); // 上位ほど明確に濃い
    expect(avgOf(3)).toBeGreaterThan(avgOf(2) * 1.5);
    // 依頼クエスト 1 件は「約 1 日分の活動」= tier3 戦闘 1〜2 回ぶんに収まる
    expect(XP_REWARDS.questComplete).toBeGreaterThan(avgOf(3) * 0.8);
    expect(XP_REWARDS.questComplete).toBeLessThan(avgOf(3) * 2.5);
  });
});
