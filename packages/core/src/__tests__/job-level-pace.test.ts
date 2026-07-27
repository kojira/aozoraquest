import { describe, it, expect } from 'vitest';
import { jobXpCurveFor, jobLevelFromXpFor, jobXpToNextLevelFor, JOB_XP_CURVE, JOB_LEVEL_PACE, JOB_LEVEL_PACE_BASIS, JOBS, MONSTERS, battleXpFor } from '../index.js';

/**
 * 職ごとのレベル曲線 (#536)。**DQ3 を参照して設計した** — DQ3 も職業ごとに必要経験値が違い、
 * Lv99 で勇者 630 万に対し賢者 960 万 (1.5 倍) の開きがある。
 *
 * 方針: **勝率・持久力の高い職ほどレベルが上がりにくい**。
 * 弱い職を数字で底上げしなくても最終的な到達点が揃う。
 */
describe('職ごとのレベル曲線 (#536)', () => {
  const th = (job: string, lv: number) => jobXpCurveFor(job).find((e) => e[0] === lv)?.[1] ?? 0;

  it('全16職に pace が定義されている (定義漏れは静かに基準値になるので明示的に守る)', () => {
    for (const j of JOBS) expect(JOB_LEVEL_PACE[j.id], `${j.id} の pace`).toBeGreaterThan(0);
  });

  it('持久力の高い職ほどレベルが上がりにくい', () => {
    // 連戦数の実測順 (scripts/sim-endurance.mts。tier1 Lv1 装備なし) が
    // 必要 XP の順序に反映されていること。**全 16 職の全順序**を見る — 5 職だけ
    // 抜き出すと、間の職を入れ替えても緑のまま通ってしまう。
    const ORDER = Object.entries(JOB_LEVEL_PACE).sort((a, b) => a[1] - b[1]).map(([id]) => id);
    expect(ORDER.length).toBe(JOBS.length); // 職を足したら pace も足す
    for (const lv of [5, 10, 30]) {
      for (let i = 1; i < ORDER.length; i++) {
        const [prev, cur] = [ORDER[i - 1]!, ORDER[i]!];
        if (JOB_LEVEL_PACE[prev] === JOB_LEVEL_PACE[cur]) continue; // 同値は順不同
        expect(th(prev, lv), `${prev} < ${cur} (Lv${lv})`).toBeLessThan(th(cur, lv));
      }
    }
  });

  it('職差は序盤に大きく、後半に収束する (DQ3 準拠)', () => {
    // DQ3: Lv10 で最大 2.5 倍 → Lv50 で 1.46 倍。定数倍だと後半も開いたままで、
    // 強い職がいつまでも追いつけない。
    const spread = (lv: number) => th('shogun', lv) / th('mage', lv);
    expect(spread(5)).toBeGreaterThan(spread(30));
    expect(spread(30)).toBeGreaterThan(spread(50));
    expect(spread(50)).toBeLessThan(1.3); // 終盤はほぼ揃う
    expect(spread(2)).toBeGreaterThan(1.4); // 序盤は明確に差がある
  });

  it('**どの職も基準曲線よりレベルが下がらない** (既存プレイヤーの巻き戻し防止)', () => {
    // レベルは XP から毎回導出するので、曲線を差し替えるだけで到達点が遡って動く。
    // pace が 1 を超える職があると、同じ XP のまま表示 Lv が下がる = 習得済みのとくぎと
    // Lv30 パッシブが説明なく消える。pace の正規化を最大値にしてある理由がこれ。
    for (const j of JOBS) {
      expect(JOB_LEVEL_PACE[j.id], `${j.id} の pace は 1.0 以下`).toBeLessThanOrEqual(1);
      for (const [lv, base] of JOB_XP_CURVE) {
        expect(th(j.id, lv), `${j.id} Lv${lv} の必要 XP が基準を超えた`).toBeLessThanOrEqual(base);
      }
    }
  });

  it('未知の職は基準曲線をそのまま使う (将来の職追加で落ちない)', () => {
    expect(jobXpCurveFor('unknown-job')).toEqual(JOB_XP_CURVE);
  });

  it('jobLevelFromXpFor / jobXpToNextLevelFor が曲線と整合する', () => {
    for (const j of JOBS) {
      for (const lv of [2, 10, 30]) {
        const need = th(j.id, lv);
        expect(jobLevelFromXpFor(j.id, need), `${j.id} Lv${lv} ちょうど`).toBe(lv);
        expect(jobLevelFromXpFor(j.id, need - 1), `${j.id} Lv${lv} 手前`).toBe(lv - 1);
        const p = jobXpToNextLevelFor(j.id, need);
        expect(p.level).toBe(lv);
        expect(p.current).toBe(0); // しきい値ちょうどなら進捗 0
      }
      expect(jobXpToNextLevelFor(j.id, th(j.id, 50)).next).toBe(0); // 打ち止め
    }
  });

  it('1 レベル上げるのに必要な戦闘数が現実的な範囲に収まる', () => {
    // DQ3 は中盤以降 1 レベルに数十戦かかる。極端に速い/遅いと成長の手触りが壊れるので、
    // その帯の敵で 2〜60 戦に収まることを固定する。
    // **下限を 3 → 2 に下げた** (#547)。レベルアップ全回復を入れたぶん弱職の pace を
    // 速くしたので、最序盤 (Lv1→2) だけ 2.7 戦になる。ここは「1 戦で上がる」を防げれば十分で、
    // 最初の 1 レベルが速いのはむしろ DQ の手触りに近い。
    const avgXp = (tier: number) => {
      const m = MONSTERS.filter((x) => x.tier === tier && x.species !== 'metal-slime');
      return m.reduce((s, x) => s + battleXpFor(x.id), 0) / m.length;
    };
    for (const j of JOBS) {
      // 想定レベル → tier は TIER_LEVEL {1:1, 2:4, 3:8, 4:13, 5:19, 6:26} に対応 (#536)。
      for (const [lv, tier] of [[2, 1], [5, 2], [10, 3], [20, 5], [30, 6], [50, 6]] as const) {
        const need = th(j.id, lv) - th(j.id, lv - 1);
        const battles = need / avgXp(tier);
        expect(battles, `${j.id} Lv${lv - 1}→${lv} (tier${tier})`).toBeGreaterThan(2);
        expect(battles, `${j.id} Lv${lv - 1}→${lv} (tier${tier})`).toBeLessThan(60);
      }
    }
  });

  it('pace の順序が**実測の耐久順**と一致する (導出元とずれていない)', () => {
    // 従来の順序テストは「pace で並べたら必要 XP も増える」しか見ておらず、
    // **pace が実測とずれていても緑のまま通っていた** (実際 poet/sage・performer/fighter・
    // warrior/explorer・guardian/paladin の 4 組で「粘るのに上がりやすい」逆転が起きていた)。
    // 導出元データ (JOB_LEVEL_PACE_BASIS) と突き合わせて、そこを塞ぐ。
    const byPace = Object.entries(JOB_LEVEL_PACE).sort((a, b) => a[1] - b[1]);
    expect(Object.keys(JOB_LEVEL_PACE_BASIS).sort()).toEqual(Object.keys(JOB_LEVEL_PACE).sort());
    for (let i = 1; i < byPace.length; i++) {
      const [prev, pPrev] = byPace[i - 1]!;
      const [cur, pCur] = byPace[i]!;
      if (pPrev === pCur) continue; // 同値は順不同
      // pace が大きい = 上がりにくい = より長く粘れる職でなければならない
      expect(JOB_LEVEL_PACE_BASIS[cur]!, `${cur} (pace ${pCur}) は ${prev} (pace ${pPrev}) より長く粘るはず`)
        .toBeGreaterThanOrEqual(JOB_LEVEL_PACE_BASIS[prev]!);
    }
  });

  it('導出式を再現できる (pace = 正規化した 連戦数^0.35)', () => {
    // テーブルを手で書き換えたときに、導出式から外れていないかを見る。
    const min = Math.min(...Object.values(JOB_LEVEL_PACE_BASIS));
    const raw = Object.fromEntries(
      Object.entries(JOB_LEVEL_PACE_BASIS).map(([k, v]) => [k, (v / min) ** 0.35]),
    );
    const max = Math.max(...Object.values(raw));
    for (const [k, v] of Object.entries(raw)) {
      const expected = Math.round((v / max) * 100) / 100;
      // 反復導出の残差 (緩和係数 0.5 で止めたぶん + 丸め幅 0.01 + sim のばらつき) を許容。
      // 実際の最大ずれは captain の 0.03。浮動小数の誤差を避けて小数 2 桁で比べる。
      const gap = Math.round(Math.abs(JOB_LEVEL_PACE[k]! - expected) * 100) / 100;
      expect(gap, `${k}: 表 ${JOB_LEVEL_PACE[k]} / 式 ${expected}`).toBeLessThanOrEqual(0.03);
    }
  });
});
