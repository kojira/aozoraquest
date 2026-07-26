import { describe, it, expect } from 'vitest';
import { startBattle, resolveTurn, runAutoBattle, autoBattleAction, skillMpCostOf, SKILLS, JOBS, type BattleState, type Command } from '../index.js';

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

  it('複数とくぎを持つ職で、旧実装 (常に [0] を撃つ) より強い手を選ぶ', () => {
    // 賢者は Lv20 で 5 種のとくぎを持つ。比較対象は **#521 以前の実装をそのまま書き写したもの**。
    // 現行 API 経由で「commandだけ使う」形にすると先読みの影響が混ざり、退行検知にならない
    // (先読みを丸ごと壊しても両方が一緒に劣化して差が保たれてしまう)。
    const legacyCommand = (s: BattleState): Command => {
      const isParry = s.playerSkill.kind === 'parry';
      const p = s.player;
      const cost = skillMpCostOf(p);
      if (s.monster.charging) return isParry && p.mp >= cost ? 'skill' : 'guard';
      if (s.herbs > 0 && p.hp < p.maxHp * 0.45) return 'herb';
      if (!isParry && s.tonics > 0 && p.mp < cost && p.maxMp >= cost * 2) return 'tonic';
      if (!isParry && p.mp >= cost) return 'skill';
      return 'attack';
    };
    const run = (useLookahead: boolean) => {
      let win = 0;
      for (let seed = 0; seed < 60; seed++) {
        let s = startBattle('sage', 20, 1, 'x', 3, seed, 3, undefined, { equipIds: ['ar-travel-cloak'] });
        for (let i = 0; i < 80 && s.outcome === 'ongoing'; i++) {
          if (useLookahead) {
            const a = autoBattleAction(s);
            s = resolveTurn(s, a.command, undefined, a.skillIndex);
          } else {
            s = resolveTurn(s, legacyCommand(s)); // skillIndex 既定 0 = 常に最初のとくぎ
          }
        }
        if (s.outcome === 'win') win++;
      }
      return win;
    };
    expect(run(true)).toBeGreaterThan(run(false));
  });

  it('ため予告には防御で受ける — キットに parry 技があるならそれで (署名スキルで判定しない)', () => {
    // 戦士は「署名が parry」なのにキットに parry 技を持たない。署名で判定していた頃は
    // ため予告に殴りかかって被ダメが 1.5 倍になっていた。
    for (const job of ['warrior', 'guardian'] as const) {
      let charges = 0;
      for (let seed = 0; seed < 40 && charges < 5; seed++) {
        // ため (charger) を持つ敵を名指しで出す。tier 抽選任せだと当たらないことがある。
        let s = startBattle(job, 20, 1, 'x', 3, seed, 3, undefined, { equipIds: ['ar-travel-cloak'], monsterId: 'blue-oni' });
        for (let i = 0; i < 60 && s.outcome === 'ongoing'; i++) {
          if (s.monster.charging) {
            const a = autoBattleAction(s);
            charges++;
            // guard そのもの、または parry 技 (防御 + 反撃) のどちらかであること
            const isParrySkill = a.command === 'skill' && !!SKILLS[s.playerSkills[a.skillIndex]!.kind]?.parry;
            expect(a.command === 'guard' || isParrySkill, `${job} がため予告に ${a.command}`).toBe(true);
          }
          const a = autoBattleAction(s);
          s = resolveTurn(s, a.command, undefined, a.skillIndex);
        }
      }
      expect(charges, `${job} のため予告が観測できていない`).toBeGreaterThan(0);
    }
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
