import { describe, it, expect } from 'vitest';
import { effectiveJobXp, jobLevelFromXp, JOB_XP_CURVE, battleXpFor, XP_REWARDS, MONSTERS } from '../index.js';

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

  it('レベルアップ判定は合算値・保存は出所ごと (二重計上の防止)', () => {
    // 投稿でレベルが上がったかは **合算値** で判定しないと、戦闘で稼いだ人に
    // 「レベルアップ! Lv3 → Lv4」と出るのにステータス画面は Lv12、という食い違いになる。
    // 一方 analysis に**保存する**のは投稿由来のみ — 合算値を保存すると
    // GameState.jobXp と二重計上になる。
    const battleXp = 5000;
    const before = 100;
    const after = 100 + 30; // 投稿で 30 稼いだ
    // 判定は合算値で
    expect(jobLevelFromXp(effectiveJobXp({ analysisXp: after, battleXp })))
      .toBeGreaterThanOrEqual(jobLevelFromXp(effectiveJobXp({ analysisXp: before, battleXp })));
    // 合算値は投稿由来より必ず大きい (= 判定が投稿だけのときとズレる)
    expect(jobLevelFromXp(effectiveJobXp({ analysisXp: after, battleXp })))
      .toBeGreaterThan(jobLevelFromXp(after));
  });

  it('戦闘 XP のスケールが投稿 XP と噛み合っている (オーナー確認 2026-07-25)', () => {
    // 「戦闘を楽しむために投稿する」= 1 投稿 = 1 パワー = 1 戦闘 で、戦闘の方が実入りが大きい、
    // という設計。tier1 は投稿と同程度、上位 tier ほど濃い、という関係を固定する。
    // ここが崩れると「どこで XP を稼ぐのが正解か」の設計が黙って変わる。
    const avgOf = (tier: 1 | 2 | 3) => {
      const ms = MONSTERS.filter((m) => m.tier === tier && m.id !== 'stray-slime');
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
