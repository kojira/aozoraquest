import { describe, it, expect } from 'vitest';
import {
  BATTLE_TUNING,
  playerCombatant,
  battleXpFor,
  startBattle,
  resolveTurn,
  runAutoBattle,
  MONSTERS,
  monsterCombatant,
  levelUpGains,
  playerStatsAt,
} from '../battle.js';
import { JOBS } from '../jobs.js';
import type { Archetype, StatArray } from '../types.js';

describe('序盤バランス (「序盤の敵が強すぎる」への調整を固定)', () => {
  /** 現実的な操作: ため予告に防御 (見切り職は構え)、HP45% 未満でやくそう、MP があれば特技 */
  const play = (job: Archetype, jobLv: number, playerLv: number, tier: 1 | 2 | 3, seed: number) => {
    let s = startBattle(job, jobLv, playerLv, 'x', tier, seed);
    const isParry = s.playerSkill.kind === 'parry';
    for (let i = 0; i < 60 && s.outcome === 'ongoing'; i++) {
      const p = s.player;
      const cmd = s.monster.charging
        ? isParry && p.mp >= BATTLE_TUNING.skillMpCost
          ? 'skill'
          : 'guard'
        : !isParry && p.mp >= BATTLE_TUNING.skillMpCost
          ? 'skill'
          : 'attack';
      s = resolveTurn(s, cmd);
    }
    return s.outcome;
  };
  const winRate = (job: Archetype, jobLv: number, playerLv: number, tier: 1 | 2 | 3) => {
    let wins = 0;
    for (let seed = 0; seed < 100; seed++) if (play(job, jobLv, playerLv, tier, seed) === 'win') wins++;
    return wins;
  };

  it('Lv1 tier1: 全ジョブが単戦 80% 以上勝てる (はじまりの街近辺で詰まない)', () => {
    for (const job of JOBS) {
      expect(winRate(job.id, 1, 1, 1), job.id).toBeGreaterThanOrEqual(80);
    }
  });

  it('luk/agi 型の弱ジョブがレベルでちゃんと強くなる (explorer/ninja の tier2 中位レベル)', () => {
    // 旧仕様 (特技 atk 基準 + MP 特性なし) では tier2 は 2 割前後だった。
    // 支配ステータス基準 + MP 特性 + 平坦レベル成長でまともに戦えることを固定。
    // 注: bard は #456 で「歌の支援職」にキット化され skill[0] がバフ = ソロの naive auto-battle
    // (skillIndex0) では攻撃せず弱い (支援職はパーティ前提。マルチ #453 で本領)。ここでは攻撃系の
    // 弱 luk/agi ジョブ (explorer=非キット agi 署名 / ninja=毒手) で「レベルで戦える」ことを固定する。
    // #507 で成長軸がジョブ Lv のみになったため、旧 jobLv5/plLv8 から **jobLv15** に貼り直し
    // (プレイヤー Lv は強さに効かない)。実測 explorer 100% / ninja 78%。
    expect(winRate('explorer', 15, 1, 2)).toBeGreaterThanOrEqual(60);
    expect(winRate('ninja', 15, 1, 2)).toBeGreaterThanOrEqual(60);
  });

  it('MP 特性 (JOB_MP_TRAITS): 弱ジョブは回復量ボーナス + 特性名を持ち、state に載る', () => {
    const bard = startBattle('bard', 1, 1, 'x', 1, 1);
    expect(bard.mpAttackGain).toBe(3);
    expect(bard.mpGuardGain).toBe(4);
    expect(bard.mpTraitName).toBe('歌の余韻');
    const warrior = startBattle('warrior', 1, 1, 'x', 1, 1);
    expect(warrior.mpAttackGain).toBe(BATTLE_TUNING.mpAttackGain);
    expect(warrior.mpGuardGain).toBe(BATTLE_TUNING.mpGuardGain);
    expect(warrior.mpTraitName).toBeUndefined();
    // たたかう で実際に特性分回復する (seed 6 は 2 ターン目まで決着しないことを固定。
    // #518 でステータスが上がり、seed 5 は 1 ターン目で決着するようになった)
    let s = startBattle('bard', 1, 1, 'x', 1, 6);
    s = resolveTurn(s, 'skill'); // MP -4
    expect(s.outcome).toBe('ongoing');
    const before = s.player.mp;
    const next = resolveTurn(s, 'attack');
    expect(['ongoing', 'win']).toContain(next.outcome);
    expect(next.player.mp).toBe(Math.min(next.player.maxMp, before + 3));
  });

  it('個人 rpgStats はジョブ基準値と 50:50 ブレンド (極端ビルドの 0%/100% 割れ防止)', () => {
    // 極端な個人値 (atk 比率 4) でも warrior の基底と混ざって半分までしか落ちない。
    // #518 以降ステータスは「比率 × 伸び率」なので、絶対値ではなく **ジョブ単独との比** で見る
    // (伸び率が変わってもテストが腐らない)。Lv30 で見るのは Lv1 の整数丸めを避けるため。
    const extreme = playerCombatant('warrior', 30, 1, 'x', [4, 7, 40, 7, 42]);
    const jobOnly = playerCombatant('warrior', 30, 1, 'x');
    expect(extreme.atk / jobOnly.atk).toBeGreaterThan(0.45); // 半減より悪くはならない
    expect(extreme.atk).toBeLessThan(jobOnly.atk);
    expect(extreme.agi).toBeGreaterThan(jobOnly.agi); // 高い個人値は反映される
  });

  it('playerStatsAt は playerCombatant と丸めの点まで同期している', () => {
    for (const [job, jobLv, plLv, base] of [
      ['warrior', 1, 1, undefined],
      ['bard', 5, 10, undefined],
      ['sage', 8, 15, [4, 14, 5, 63, 14]],
      ['ninja', 3, 7, [20, 20, 20, 20, 20]],
    ] as Array<[Archetype, number, number, StatArray | undefined]>) {
      const raw = playerStatsAt(job, jobLv, plLv, base);
      const c = playerCombatant(job, jobLv, plLv, 'x', base);
      expect(Math.round(raw.atk), `${job} atk`).toBe(c.atk);
      expect(Math.round(raw.def), `${job} def`).toBe(c.def);
      expect(Math.round(raw.agi), `${job} agi`).toBe(c.agi);
      expect(Math.round(raw.int), `${job} int`).toBe(c.int);
      expect(Math.round(raw.luk), `${job} luk`).toBe(c.luk);
      expect(Math.round(raw.maxHp), `${job} maxHp`).toBe(c.maxHp);
      expect(Math.round(raw.maxMp), `${job} maxMp`).toBe(c.maxMp);
    }
  });

  it('levelUpGains: 上昇量は**整数** (画面の実差) で返し、丸めて変わらないものは出さない', () => {
    // 以前は生値の差を小数 1 桁で返していたが、プレイヤーが見るのは playerCombatant の
    // 丸めた値なので「まもりが 0.4 あがった!」と言われて画面を見ても何も変わっていない、
    // という嘘の行が出ていた (レビュー実測 2026-07-27)。**画面の実差そのもの**を返す。
    // 全職・全レベルでの一致は growth-formula.test.ts で網羅する。
    const gains = levelUpGains('warrior', { jobLevel: 1, playerLevel: 1 }, { jobLevel: 2, playerLevel: 1 });
    expect(gains.length).toBeGreaterThan(0);
    const a = playerCombatant('warrior', 1, 1, 'x');
    const b = playerCombatant('warrior', 2, 1, 'x');
    expect(gains.find((g) => g.key === 'atk')?.delta).toBe(b.atk - a.atk);
    for (const g of gains) {
      expect(g.delta, `${g.label} は 1 以上の整数`).toBeGreaterThanOrEqual(1);
      expect(Number.isInteger(g.delta), `${g.label} は整数`).toBe(true);
      expect(g.label.length).toBeGreaterThan(0);
    }
    // レベル変化なしは空 (全部 0 → フィルタで消える)
    expect(levelUpGains('warrior', { jobLevel: 3, playerLevel: 5 }, { jobLevel: 3, playerLevel: 5 })).toEqual([]);
  });

  it('成長軸はジョブ Lv のみ — プレイヤー Lv は強さに一切影響しない (#507)', () => {
    const lv1 = playerCombatant('bard', 1, 1, 'x');
    // ジョブ Lv では伸びる
    expect(playerCombatant('bard', 20, 1, 'x').atk).toBeGreaterThan(lv1.atk);
    expect(playerCombatant('guardian', 30, 1, 'x').maxHp).toBeGreaterThan(playerCombatant('guardian', 1, 1, 'x').maxHp);
    // プレイヤー Lv をいくら上げても同じ (旧 playerLevelScale / flatLevelGain / hpLevelScale は撤廃)
    for (const pl of [10, 50, 99]) {
      const c = playerCombatant('bard', 1, pl, 'x');
      expect(c.atk, `plLv${pl}`).toBe(lv1.atk);
      expect(c.maxHp, `plLv${pl}`).toBe(lv1.maxHp);
      expect(c.maxMp, `plLv${pl}`).toBe(lv1.maxMp);
    }
  });

  it('HP はジョブの たいりょく に比例する = 硬い職が実際に硬い (#507/#518)', () => {
    // 旧式は全職 HP≈20 横並びだった。**HP の出所は def ではなく vit** (#518) — 守護者は
    // def も vit も高いので def 基準でも通ってしまうが、因果は vit。
    // (vit → HP の関係そのものは「たいりょく (vit) が HP の単一の出所」で全職固定している)
    const tank = playerCombatant('guardian', 30, 1, 'x').maxHp;
    const caster = playerCombatant('sage', 30, 1, 'x').maxHp;
    expect(tank).toBeGreaterThan(caster * 1.5); // vit 45 対 20 の差がそのまま出る
    // MP は かしこさ に比例する (賢者は守護者より MP が多い)
    expect(playerCombatant('sage', 30, 1, 'x').maxMp).toBeGreaterThan(playerCombatant('guardian', 30, 1, 'x').maxMp * 1.5);
  });
});

describe('モンスターの tier = 想定プレイヤーレベル (#518/#509)', () => {
  it('tier が上がるほど強く、想定レベルのプレイヤーと同じ成長式に乗っている', () => {
    const avg = (t: 1 | 2 | 3, k: 'atk' | 'def' | 'maxHp') => {
      const ms = MONSTERS.filter((m) => m.tier === t && m.id !== 'stray-slime');
      return ms.reduce((s, m) => s + monsterCombatant(m, 0, () => 0.5)[k], 0) / ms.length;
    };
    for (const k of ['atk', 'def', 'maxHp'] as const) {
      expect(avg(2, k), `tier2 ${k}`).toBeGreaterThan(avg(1, k));
      expect(avg(3, k), `tier3 ${k}`).toBeGreaterThan(avg(2, k));
    }
    // HP が tier2→3 でほぼ横ばい (旧実装の欠陥) に戻っていないこと
    expect(avg(3, 'maxHp')).toBeGreaterThan(avg(2, 'maxHp') * 1.3);
  });

  it('tier1 は Lv1 の全職が「持てる手を使えば」勝てる (序盤に詰まない #509)', () => {
    // **とくぎ込みで測る。** 通常攻撃だけを基準にすると、魔法使い (atk 比率 7) のような
    // 「殴るべきでない職」を詰み扱いしてしまう (実測 15%)。とくぎを使えば 95% 勝てるので
    // 詰んでいない。#521/#538 で自動戦闘が手を選べるようになったので、それを使って測る。
    for (const j of JOBS) {
      let win = 0;
      for (let seed = 0; seed < 120; seed++) {
        if (runAutoBattle(startBattle(j.id, 1, 1, 'x', 1, seed, 2)).outcome === 'win') win++;
      }
      expect(win / 120, `${j.id} tier1 勝率`).toBeGreaterThan(0.8);
    }
  });
});

describe('ダメージ 0 は正当な結果 (#518)', () => {
  it('守備を上回れなければ 0 — メタルは通常攻撃も魔法も通らない', () => {
    const metal = monsterCombatant(MONSTERS.find((m) => m.id === 'stray-slime')!, 0, () => 0.5);
    expect(metal.def).toBe(255); // DQ2 のメタルスライム/はぐれメタルと同値
    // 全職の最高レベルでも通常攻撃の素の値が 0 に沈む (flatDef は tier 倍率を通さない)
    for (const j of JOBS) {
      const p = playerCombatant(j.id, 50, 1, 'x');
      expect(p.atk * BATTLE_TUNING.atkCoef - metal.def * BATTLE_TUNING.defCoef, `${j.id}`)
        .toBeLessThanOrEqual(0);
    }
  });

  it('全モンスターが hp を明示している (省略時フォールバックを到達不能に保つ)', () => {
    // `MonsterDef.hp` は optional なので省略できてしまう。省略すると monsterMaxHp と
    // baselineXp が MONSTER_DEFAULT_VIT にフォールバックし、意図しない HP/XP になる。
    // 新しい敵を足すときに hp を書き忘れないよう、ここで名指しで固定する。
    for (const m of MONSTERS) {
      expect(m.hp, `${m.id} は hp を明示すること`).toBeGreaterThan(0);
    }
  });

  it('minDamage は 0、defCoef は atkCoef の半分 (DQ の 2:1)', () => {
    expect(BATTLE_TUNING.minDamage).toBe(0);
    expect(BATTLE_TUNING.defCoef).toBeCloseTo(BATTLE_TUNING.atkCoef / 2, 5);
  });
});

describe('敗北 XP (#621)', () => {
  it('どのモンスターでも「勝ちより負けの XP が多い」逆転が起きない', () => {
    // 以前は xpLose 固定 5 に対し tier1 のスライム 3 種が 勝ち 3〜5 で逆転していた。
    // 敵を弱く足すたびに再発する形なので、敗北 XP は配らないことで構造的に断つ。
    for (const m of MONSTERS) {
      expect(BATTLE_TUNING.xpLose, `${m.name}`).toBeLessThan(battleXpFor(m.id));
    }
  });
});
