import { describe, it, expect } from 'vitest';
import { startBattle, resolveTurn, resolveTurnMulti, mpTraitChanceOf, BATTLE_TUNING, JOB_MP_TRAITS, mpGainsFor, JOBS, type Command } from '../index.js';

/**
 * **パラディンの MP 回復は確率発動** (#564)。回復とくぎ (聖光の癒し) と
 * 確実な MP 回復が噛み合うと資源が尽きず、低 tier を無限に周回できてしまう。
 *
 * `chance` を持たないジョブは**乱数を 1 つも引かない**こと。引くと乱数ストリームが
 * ずれて他ジョブの戦闘結果まで変わる。下の「乱数を引かない」テストがそれを固定する。
 */
describe('MP 特性の確率発動 (#564)', () => {
  it('パラディンだけが chance を持つ (他ジョブは従来どおり毎ターン確実)', () => {
    const withChance = Object.entries(JOB_MP_TRAITS)
      .filter(([, t]) => t?.chance !== undefined)
      .map(([id]) => id);
    expect(withChance).toEqual(['paladin']);
    expect(mpGainsFor('paladin').chance).toBe(0.5);
    expect(mpGainsFor('paladin').attackGain).toBe(1);
    expect(mpGainsFor('paladin').guardGain).toBe(1);
    // 特性を持つ他ジョブは chance なし = 乱数を引かない
    for (const job of JOBS) {
      if (job.id === 'paladin') continue;
      expect(mpGainsFor(job.id).chance, `${job.id}`).toBeUndefined();
    }
  });

  it('ぼうぎょの MP 回復が毎回は起きない (だいたい設定した確率で起きる)', () => {
    let fired = 0;
    const N = 400;
    for (let seed = 0; seed < N; seed++) {
      // MP を減らしてから測る (満タンだと増えたか分からない)
      const s = startBattle('paladin', 10, 1, 'x', 1, seed, 0, { hp: 40, mp: 1 });
      const after = resolveTurn(s, 'guard', seed * 31 + 7);
      if (after.player.mp > s.player.mp) fired++;
    }
    const rate = fired / N;
    // **state が持つ実効確率と突き合わせる。** 固定値と比べると、うんの係数を変えたときに
    // どちらが正しいのか分からなくなる。0 でも 1 でもないことも同時に見る。
    const expected = startBattle('paladin', 10, 1, 'x', 1, 0, 0).mpTraitChance!;
    expect(expected, '実効確率').toBeGreaterThan(0);
    expect(expected, '実効確率').toBeLessThan(1);
    expect(Math.abs(rate - expected), `発動率 ${rate} / 期待 ${expected}`).toBeLessThan(0.08);
  });

  it('chance の無いジョブは毎ターン必ず回復する (退行検知)', () => {
    // bard の 歌の余韻 は従来どおり確実。ここが確率になったら気づけるようにする。
    for (let seed = 0; seed < 60; seed++) {
      const s = startBattle('bard', 10, 1, 'x', 1, seed, 0, { hp: 40, mp: 1 });
      const after = resolveTurn(s, 'guard', seed * 31 + 7);
      expect(after.player.mp, `bard seed=${seed}`).toBeGreaterThan(s.player.mp);
    }
  });

  it('確率判定で乱数を余計に引いていない (他ジョブの戦闘結果が 1 ビットも変わらない)', () => {
    // **これが崩れると全職の戦闘結果が変わる。** `mpTraitFires` が chance 無しでも
    // rng() を引く実装に変わると、乱数ストリームが 1 つずれて以降の命中・会心・行動順が
    // 全部変わる。既存のテストはこれを検出できない (world-data は地形生成なので
    // 戦闘 rng を通らず、全職の通しテストも存在しない) ので、ここで固定する。
    //
    // 期待値は「chance を持つ paladin 以外は、この PR の前後で完全一致」。
    // ハッシュではなく**具体的な系列**を固定して、落ちたときに何が変わったか読めるようにする。
    const trace = (job: Parameters<typeof startBattle>[0]) => {
      let s = startBattle(job, 10, 1, 'x', 2, 4242, 2);
      const out: string[] = [];
      const cmds: Command[] = ['attack', 'guard', 'skill', 'attack'];
      for (let i = 0; i < 12 && s.outcome === 'ongoing'; i++) {
        s = resolveTurn(s, cmds[i % cmds.length]!, i * 97 + 3);
        out.push(`${s.player.hp}/${s.player.mp}/${s.monster.hp}`);
      }
      return out.join(' ');
    };
    // chance を持たない代表 4 職 (特性あり 2 + 特性なし 2)。値はこの変更を入れる**前**の
    // 実装から採ったもので、入れた後と一致することを確認済み。
    expect(trace('bard'), 'bard').toBe('29/22/22 21/22/22 16/18/22 16/21/14 10/22/5 5/22/5 5/18/5 5/21/0');
    expect(trace('miko'), 'miko').toBe('35/16/23 27/16/23 27/12/23 22/14/18 17/16/12 13/16/12 21/12/12 12/14/6 12/16/0');
    expect(trace('warrior'), 'warrior').toBe('56/16/14 48/16/14 40/12/0');
    expect(trace('ninja'), 'ninja').toBe('40/24/16 32/24/16 32/20/0');
  });

  it('4 つの付与箇所すべてで確率が効く (ソロ/マルチ × たたかう/ぼうぎょ)', () => {
    // ゲートは battle.ts に 4 箇所ある。1 箇所でも外れると、そこだけ確実回復に戻り、
    // #564 の「たたかう を選び続けて MP が尽きない」ループが復活する。
    //
    // **マルチは resolveTurnMulti を直接呼ぶこと。** startBattle に extraEnemies を渡しても
    // resolveTurn はソロ経路を通るので、マルチ側のゲートを外した変異を検出できない (実測)。
    const rate = (cmd: 'attack' | 'guard', multi: boolean) => {
      let fired = 0;
      const N = 300;
      for (let seed = 0; seed < N; seed++) {
        const s = startBattle('paladin', 10, 1, 'x', 1, seed, 0, { hp: 40, mp: 1 },
          multi ? { extraEnemies: 2 } : undefined);
        const after = multi
          ? resolveTurnMulti(s, cmd, seed * 31 + 7)
          : resolveTurn(s, cmd, seed * 31 + 7);
        const before = multi ? (s.allies?.[0] ?? s.player) : s.player;
        const now = multi ? (after.allies?.[0] ?? after.player) : after.player;
        if (now.mp > before.mp) fired++;
      }
      return fired / N;
    };
    const expected = startBattle('paladin', 10, 1, 'x', 1, 0, 0).mpTraitChance!;
    for (const [label, r] of [
      ['ソロ ぼうぎょ', rate('guard', false)],
      ['ソロ たたかう', rate('attack', false)],
      ['マルチ ぼうぎょ', rate('guard', true)],
      ['マルチ たたかう', rate('attack', true)],
    ] as Array<[string, number]>) {
      expect(Math.abs(r - expected), `${label} の発動率 ${r} (期待 ${expected}) — 1.0 ならゲートが外れている`)
        .toBeLessThan(0.09);
    }
  });

  it('うん が高いほど出やすく、上限で頭打ちになる', () => {
    const t = BATTLE_TUNING;
    // 基準値 + うん × 係数。うん 0 なら基準値そのもの。
    expect(mpTraitChanceOf(0.5, 0)).toBe(0.5);
    expect(mpTraitChanceOf(0.5, 50)).toBeCloseTo(0.5 + 50 * t.mpTraitLukScale, 10);
    // 上限を超えない (Lv50 のパラディンは装備込みで うん 112 まで伸びる)
    expect(mpTraitChanceOf(0.5, 1000)).toBe(t.mpTraitChanceMax);
    // 特性なし (chance 未指定) は undefined のまま = 毎ターン確実
    expect(mpTraitChanceOf(undefined, 50)).toBeUndefined();

    // 実戦の state にも効いている: レベルが上がる = うんが上がる = 確率が上がる
    const at = (lv: number) => startBattle('paladin', lv, 1, 'x', 1, 1).mpTraitChance!;
    expect(at(1)).toBeLessThan(at(20));
    expect(at(20)).toBeLessThan(at(30));
    expect(at(50)).toBe(t.mpTraitChanceMax);

    // **装備のうんも乗る** (パラディンの専用武器は luk 型なので、盛ると祈りが通りやすくなる)
    const bare = startBattle('paladin', 20, 1, 'x', 1, 1).mpTraitChance!;
    const geared = startBattle('paladin', 20, 1, 'x', 1, 1, 0, undefined,
      { gear: { weapon: { id: 'wp-paladin-high', level: 3 } } }).mpTraitChance!;
    expect(geared).toBeGreaterThan(bare);
  });
});
