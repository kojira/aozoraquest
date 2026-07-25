import { describe, it, expect } from 'vitest';
import { startBattle, resolveTurn, runAutoBattle, autoBattleAction, autoBattleCommand, JOBS } from '../index.js';

/**
 * 自動戦闘の**とくぎ選択** (#521)。
 *
 * 以前は `Command` だけを返しており `resolveTurn` の skillIndex が既定 0 のままだったので、
 * **常に最初のとくぎしか撃たなかった**。とくぎを 5 種持つ職では「[0] がたまたま弱いと
 * 壊滅的に見える」ため、「キャスターは tier2 以降で成立しない」という誤った結論を導いた
 * (実際には技を選べば全職が成立していた)。バランス判断がこのツールに依存しているので、
 * ここが壊れるとまた同じ誤診をする。
 */
describe('autoBattleAction (#521)', () => {
  it('先読みの試行が引数の state を破壊しない', () => {
    // 内部で resolveTurn を候補数ぶん試すので、prev が壊れると本番の進行まで狂う。
    let checked = 0;
    for (const j of JOBS) {
      for (const tier of [1, 2, 3] as const) {
        let s = startBattle(j.id, 20, 1, 'x', tier, 7, 3);
        for (let t = 0; t < 5 && s.outcome === 'ongoing'; t++) {
          const snapshot = JSON.stringify(s);
          const a = autoBattleAction(s);
          expect(JSON.stringify(s), `${j.id} tier${tier} turn${t}`).toBe(snapshot);
          checked++;
          s = resolveTurn(s, a.command, undefined, a.skillIndex);
        }
      }
    }
    expect(checked).toBeGreaterThan(50); // 決着が早いと 1 戦あたりのターン数が減るので緩め
  });

  it('とくぎより通常攻撃が良いときは通常攻撃を選ぶ', () => {
    // 遊び人は Lv10 で `サボる` しか持たない。これを撃ち続けると tier2 で勝率 0% になるが、
    // 通常攻撃だけなら勝てる。「MP があればとくぎ」と決め打つとこの職を「詰み」と誤判定する。
    let win = 0;
    for (let seed = 0; seed < 60; seed++) {
      const s = startBattle('performer', 10, 1, 'x', 2, seed, 3, undefined, { equipIds: ['ar-travel-cloak'] });
      if (runAutoBattle(s).outcome === 'win') win++;
    }
    expect(win / 60).toBeGreaterThan(0.5);
  });

  it('複数とくぎを持つ職で [0] 固定より強い手を選ぶ', () => {
    // 賢者は Lv20 で 5 種のとくぎを持つ。[0] 固定と先読みで勝率が変わることを固定する。
    const run = (useLookahead: boolean) => {
      let win = 0;
      for (let seed = 0; seed < 60; seed++) {
        let s = startBattle('sage', 20, 1, 'x', 3, seed, 3, undefined, { equipIds: ['ar-travel-cloak'] });
        for (let i = 0; i < 80 && s.outcome === 'ongoing'; i++) {
          if (useLookahead) {
            const a = autoBattleAction(s);
            s = resolveTurn(s, a.command, undefined, a.skillIndex);
          } else {
            s = resolveTurn(s, autoBattleCommand(s)); // skillIndex 既定 0 = 旧挙動
          }
        }
        if (s.outcome === 'win') win++;
      }
      return win;
    };
    expect(run(true)).toBeGreaterThan(run(false));
  });

  it('全16職が想定レベル帯で成立する (tier1=Lv1 / tier2=Lv10 / tier3=Lv20)', () => {
    // 「キャスターが成立しない」という誤診を再発させないための土台。ツールが壊れると
    // ここが落ちる。閾値は現状 (最低 73%) から余裕を見て 60% に置く。
    for (const [tier, lv] of [[1, 1], [2, 10], [3, 20]] as const) {
      for (const j of JOBS) {
        let win = 0;
        for (let seed = 0; seed < 60; seed++) {
          const s = startBattle(j.id, lv, 1, 'x', tier, seed, 3, undefined, {
            equipIds: tier === 1 ? ['ar-cloth'] : ['ar-travel-cloak'],
          });
          if (runAutoBattle(s).outcome === 'win') win++;
        }
        expect(win / 60, `${j.id} tier${tier} Lv${lv}`).toBeGreaterThan(0.6);
      }
    }
  });
});
