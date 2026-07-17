import { describe, it, expect } from 'vitest';
import {
  BATTLE_TUNING,
  createRng,
  turnRng,
  skillForJob,
  JOB_SKILL_NAMES,
  playerCombatant,
  summonMonster,
  startBattle,
  resolveTurn,
  rollDrops,
  earnedTitles,
  MONSTERS,
  MONSTERS_BY_ID,
  ITEMS,
  type BattleState,
  type Command,
} from '../battle.js';
import { JOBS } from '../jobs.js';

describe('createRng / turnRng', () => {
  it('同じ seed は同じ列を返す (決定的)', () => {
    const a = createRng(42);
    const b = createRng(42);
    for (let i = 0; i < 10; i++) expect(a()).toBe(b());
  });
  it('異なる seed は異なる列', () => {
    const a = createRng(1)();
    const b = createRng(2)();
    expect(a).not.toBe(b);
  });
  it('値域は [0,1)', () => {
    const rng = createRng(7);
    for (let i = 0; i < 1000; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
  it('turnRng はターン毎に独立だが決定的', () => {
    expect(turnRng(5, 1)()).toBe(turnRng(5, 1)());
    expect(turnRng(5, 1)()).not.toBe(turnRng(5, 2)());
  });
});

describe('skillForJob', () => {
  it('全ジョブに特技があり、支配ステータスと kind が一致する', () => {
    const kinds = ['smash', 'parry', 'flurry', 'spell', 'gamble'] as const;
    for (const job of JOBS) {
      const skill = skillForJob(job.id);
      expect(skill.name).toBe(JOB_SKILL_NAMES[job.id]);
      let maxI = 0;
      for (let i = 1; i < job.stats.length; i++) if (job.stats[i]! > job.stats[maxI]!) maxI = i;
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

describe('playerCombatant', () => {
  it('レベルが上がるとステータスと HP が伸びる', () => {
    const lv1 = playerCombatant('warrior', 1, 1, '戦士');
    const lv10 = playerCombatant('warrior', 10, 20, '戦士');
    expect(lv10.atk).toBeGreaterThan(lv1.atk);
    expect(lv10.maxHp).toBeGreaterThan(lv1.maxHp);
    expect(lv1.hp).toBe(lv1.maxHp);
  });
});

describe('summonMonster', () => {
  it('tier ごとのプールから決定的に選ぶ', () => {
    const a = summonMonster(1, 5, 123);
    const b = summonMonster(1, 5, 123);
    expect(a.def.id).toBe(b.def.id);
    expect(a.def.tier).toBe(1);
  });
  it('全 tier にモンスターが 3 体ずついる', () => {
    for (const tier of [1, 2, 3] as const) {
      expect(MONSTERS.filter((m) => m.tier === tier)).toHaveLength(3);
    }
  });
  it('モンスターのドロップ素材は全部 ITEMS に定義がある', () => {
    for (const m of MONSTERS) {
      for (const d of m.drops) expect(ITEMS[d.item]).toBeDefined();
    }
  });
});

/** コマンド列でバトルを最後まで進める。 */
function playOut(state: BattleState, command: Command, maxTurns = 100): BattleState {
  let s = state;
  for (let i = 0; i < maxTurns && s.outcome === 'ongoing'; i++) {
    s = resolveTurn(s, command);
  }
  return s;
}

describe('resolveTurn', () => {
  it('同じ seed + コマンド列は同じ結果 (決定的)', () => {
    const s1 = playOut(startBattle('warrior', 5, 10, '戦士', 1, 999), 'attack');
    const s2 = playOut(startBattle('warrior', 5, 10, '戦士', 1, 999), 'attack');
    expect(s1.outcome).toBe(s2.outcome);
    expect(s1.turn).toBe(s2.turn);
    expect(s1.player.hp).toBe(s2.player.hp);
    expect(s1.monster.hp).toBe(s2.monster.hp);
  });

  it('元の state を破壊しない (イミュータブル)', () => {
    const s0 = startBattle('warrior', 5, 10, '戦士', 1, 42);
    const hp0 = s0.monster.hp;
    resolveTurn(s0, 'attack');
    expect(s0.monster.hp).toBe(hp0);
    expect(s0.turn).toBe(0);
  });

  it('決着後の resolveTurn は no-op', () => {
    const done = playOut(startBattle('shogun', 10, 20, '将軍', 1, 7), 'attack');
    expect(done.outcome).not.toBe('ongoing');
    const after = resolveTurn(done, 'attack');
    expect(after).toBe(done);
  });

  it('必ず maxTurns 以内に決着する (attack 連打)', () => {
    for (const seed of [1, 22, 333, 4444, 55555]) {
      const s = playOut(startBattle('poet', 3, 5, '詩人', 2, seed), 'attack');
      expect(s.outcome).not.toBe('ongoing');
      expect(s.turn).toBeLessThanOrEqual(BATTLE_TUNING.maxTurns);
    }
  });

  it('ガード連打でも maxTurns で決着判定される', () => {
    const s = playOut(startBattle('guardian', 5, 10, '守護者', 1, 12), 'guard');
    expect(s.outcome).not.toBe('ongoing');
  });

  it('lastEvents にテキストが積まれる (UI 演出用)', () => {
    const s = resolveTurn(startBattle('ninja', 5, 10, '忍者', 1, 5), 'attack');
    expect(s.lastEvents.length).toBeGreaterThan(0);
    for (const ev of s.lastEvents) {
      expect(typeof ev.text).toBe('string');
      expect(ev.text.length).toBeGreaterThan(0);
    }
  });

  it('高レベルプレイヤーは tier1 に高勝率 (100 seed 中 80 以上)', () => {
    let wins = 0;
    for (let seed = 0; seed < 100; seed++) {
      const s = playOut(startBattle('shogun', 20, 40, '将軍', 1, seed), 'attack');
      if (s.outcome === 'win') wins++;
    }
    expect(wins).toBeGreaterThanOrEqual(80);
  });

  it('低レベルプレイヤーは tier3 に苦戦する (100 seed 中 60 敗以上)', () => {
    let losses = 0;
    for (let seed = 0; seed < 100; seed++) {
      const s = playOut(startBattle('poet', 1, 1, '詩人', 3, seed), 'attack');
      if (s.outcome === 'lose') losses++;
    }
    expect(losses).toBeGreaterThanOrEqual(60);
  });

  it('skill コマンドも決着まで通る (全 5 種の特技)', () => {
    // 各特技の代表ジョブで skill 連打が例外なく完走する
    for (const arch of ['shogun', 'guardian', 'ninja', 'sage', 'miko'] as const) {
      const s = playOut(startBattle(arch, 8, 15, 'テスト', 2, 77), 'skill');
      expect(s.outcome).not.toBe('ongoing');
    }
  });

  it('見切り (parry) は行動順に関係なく被弾半減 + 反撃が発動する', () => {
    // 鈍足 guardian (agi 9) で skill 連打 → 後手でも反撃イベントが出る seed があること
    let counterSeen = 0;
    for (let seed = 0; seed < 30; seed++) {
      let s = startBattle('guardian', 5, 10, '守護者', 1, seed);
      for (let i = 0; i < 20 && s.outcome === 'ongoing'; i++) {
        s = resolveTurn(s, 'skill');
        if (s.lastEvents.some((e) => e.text.includes('はんげき'))) counterSeen++;
      }
    }
    expect(counterSeen).toBeGreaterThan(0);
  });

  it('parry 型 (guardian) は skill 連打が attack 連打より不利にならない (tier1 勝率)', () => {
    let skillWins = 0;
    let attackWins = 0;
    for (let seed = 0; seed < 100; seed++) {
      if (playOut(startBattle('guardian', 5, 10, '守護者', 1, seed), 'skill').outcome === 'win') skillWins++;
      if (playOut(startBattle('guardian', 5, 10, '守護者', 1, seed), 'attack').outcome === 'win') attackWins++;
    }
    // 固有特技を使うほど弱くなる (旧実装は後手 no-op で skill 勝率 2.5%) を防ぐ回帰ガード
    expect(skillWins).toBeGreaterThanOrEqual(attackWins - 10);
  });

  it('spell 型 (sage) Lv1 でも tier3 は skill 連打で突破できない (敗率 ≥60%)', () => {
    // 旧実装 (防御完全無視) は Lv1 sage が tier3 に勝率 79.5% で難易度設計が壊れていた
    let losses = 0;
    for (let seed = 0; seed < 100; seed++) {
      if (playOut(startBattle('sage', 1, 1, '賢者', 3, seed), 'skill').outcome === 'lose') losses++;
    }
    expect(losses).toBeGreaterThanOrEqual(60);
  });

  it('spell は高防御の敵 (golem) に対して通常攻撃より有効 (魔法の存在意義)', () => {
    // moss-golem は def 36 の硬い敵。int 型はここで輝く
    let skillWins = 0;
    let attackWins = 0;
    for (let seed = 0; seed < 100; seed++) {
      const sSkill = playOut(startBattle('sage', 5, 10, '賢者', 2, seed), 'skill');
      const sAttack = playOut(startBattle('sage', 5, 10, '賢者', 2, seed), 'attack');
      if (sSkill.outcome === 'win') skillWins++;
      if (sAttack.outcome === 'win') attackWins++;
    }
    expect(skillWins).toBeGreaterThan(attackWins);
  });

  it('artist の同値タイ (def=luk=26) は先勝ちで parry に固定', () => {
    expect(skillForJob('artist').kind).toBe('parry');
  });
});

describe('rollDrops', () => {
  it('決定的 (同 seed 同結果)', () => {
    expect(rollDrops('sky-slime', 20, 42)).toEqual(rollDrops('sky-slime', 20, 42));
  });
  it('未知のモンスター ID は空配列', () => {
    expect(rollDrops('nope', 10, 1)).toEqual([]);
  });
  it('ドロップは定義済み素材のみ', () => {
    for (let seed = 0; seed < 50; seed++) {
      for (const m of MONSTERS) {
        for (const item of rollDrops(m.id, 30, seed)) {
          expect(ITEMS[item]).toBeDefined();
          expect(MONSTERS_BY_ID[m.id]!.drops.some((d) => d.item === item)).toBe(true);
        }
      }
    }
  });
  it('luk が高いほどドロップ総数が増える (統計的)', () => {
    let low = 0;
    let high = 0;
    for (let seed = 0; seed < 300; seed++) {
      low += rollDrops('sky-dragon', 0, seed).length;
      high += rollDrops('sky-dragon', 60, seed).length;
    }
    expect(high).toBeGreaterThan(low);
  });
});

describe('earnedTitles', () => {
  it('初勝利で最初の称号', () => {
    const titles = earnedTitles({ wins: 1, losses: 0, bestStreak: 1, tier3Wins: 0 });
    expect(titles.map((t) => t.id)).toEqual(['first-win']);
  });
  it('戦績 0 は称号なし', () => {
    expect(earnedTitles({ wins: 0, losses: 5, bestStreak: 0, tier3Wins: 0 })).toEqual([]);
  });
  it('上位条件で複数獲得 (単調)', () => {
    const titles = earnedTitles({ wins: 100, losses: 10, bestStreak: 12, tier3Wins: 15 });
    expect(titles.length).toBe(7);
  });
});
