import { describe, it, expect } from 'vitest';
import {
  BATTLE_TUNING,
  createRng,
  turnRng,
  skillForJob,
  JOB_SKILL_NAMES,
  playerCombatant,
  summonMonster,
  pickTrialTier,
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

  it('ため予告の次ターンは必ずため攻撃 (または決着済み)', () => {
    for (let seed = 0; seed < 40; seed++) {
      let s = startBattle('warrior', 5, 10, '戦士', 3, seed);
      let telegraphed = false;
      for (let i = 0; i < 40 && s.outcome === 'ongoing'; i++) {
        s = resolveTurn(s, 'attack');
        const chargeNow = s.lastEvents.some((e) => e.text.includes('力をためている'));
        if (telegraphed && s.outcome === 'ongoing' && !s.monster.charging) {
          // 直前ターンに予告があった → このターンのイベントにため攻撃 (モンスター名の技) が出る
          const def = MONSTERS_BY_ID[s.monsterId]!;
          const unleashed = s.lastEvents.some(
            (e) => e.actor === 'monster' && def.skillName !== undefined && e.text.includes(def.skillName),
          );
          // プレイヤー側が先に倒した場合 (monster.hp=0) は解放されないこともある
          if (s.monster.hp > 0) expect(unleashed).toBe(true);
        }
        telegraphed = chargeNow;
      }
    }
  });

  it('MP: 特技で消費し、たたかう +1 / ぼうぎょ +2 で回復する', () => {
    const s0 = startBattle('sage', 5, 10, '賢者', 1, 42);
    expect(s0.player.mp).toBe(s0.player.maxMp);
    const s1 = resolveTurn(s0, 'skill');
    expect(s1.player.mp).toBe(s0.player.mp - BATTLE_TUNING.skillMpCost);
    if (s1.outcome === 'ongoing') {
      const s2 = resolveTurn(s1, 'guard');
      expect(s2.player.mp).toBe(Math.min(s2.player.maxMp, s1.player.mp + BATTLE_TUNING.mpGuardGain));
    }
  });

  it('MP 不足の特技は「たたかう」にフォールバックし MP を消費しない', () => {
    let s = startBattle('warrior', 1, 1, '戦士', 1, 7);
    // MP を撃ち尽くす
    for (let i = 0; i < 20 && s.outcome === 'ongoing' && s.player.mp >= BATTLE_TUNING.skillMpCost; i++) {
      s = resolveTurn(s, 'skill');
    }
    if (s.outcome === 'ongoing' && s.player.mp < BATTLE_TUNING.skillMpCost) {
      const mpBefore = s.player.mp;
      const next = resolveTurn(s, 'skill');
      expect(next.lastEvents.some((e) => e.text.includes('MP が足りない'))).toBe(true);
      // フォールバック攻撃で +mpAttackGain される (消費はされない)
      expect(next.player.mp).toBeGreaterThanOrEqual(mpBefore);
    }
  });

  it('int 型 (sage) は戦士型より maxMp が多い', () => {
    const sage = playerCombatant('sage', 5, 10, '賢者');
    const warrior = playerCombatant('warrior', 5, 10, '戦士');
    expect(sage.maxMp).toBeGreaterThan(warrior.maxMp);
  });

  it('やくそう: HP を回復し、残数と使用数が更新される', () => {
    let s = startBattle('warrior', 5, 10, '戦士', 2, 99, 2);
    expect(s.herbs).toBe(2);
    // 何ターンか戦ってダメージを受ける
    for (let i = 0; i < 6 && s.outcome === 'ongoing'; i++) s = resolveTurn(s, 'attack');
    if (s.outcome === 'ongoing' && s.player.hp < s.player.maxHp) {
      const before = s.player.hp;
      const next = resolveTurn(s, 'herb');
      // 回復後に敵の攻撃を受ける可能性があるので「使った」イベントで検証
      expect(next.lastEvents.some((e) => e.text.includes('やくそうを使った'))).toBe(true);
      expect(next.herbs).toBe(s.herbs - 1);
      expect(next.herbsUsed).toBe(s.herbsUsed + 1);
      void before;
    }
  });

  it('やくそう切れは「たたかう」にフォールバック', () => {
    const s0 = startBattle('warrior', 5, 10, '戦士', 1, 11, 0);
    const s1 = resolveTurn(s0, 'herb');
    expect(s1.lastEvents.some((e) => e.text.includes('やくそうを持っていない'))).toBe(true);
    expect(s1.herbsUsed).toBe(0);
  });

  it('持ち込みやくそうは herbCarryMax でクランプ', () => {
    const s = startBattle('warrior', 1, 1, '戦士', 1, 1, 99);
    expect(s.herbs).toBe(BATTLE_TUNING.herbCarryMax);
  });

  it('そらのしずく: MP を回復し、残数と使用数が更新される。切れたらフォールバック', () => {
    let s = startBattle('sage', 5, 10, '賢者', 1, 42, 0, undefined, { tonics: 2 });
    expect(s.tonics).toBe(2);
    // MP を減らしてから使う
    s = resolveTurn(s, 'skill');
    if (s.outcome === 'ongoing') {
      const mpBefore = s.player.mp;
      const next = resolveTurn(s, 'tonic');
      expect(next.lastEvents.some((e) => e.text.includes('そらのしずく'))).toBe(true);
      expect(next.tonics).toBe(1);
      expect(next.tonicsUsed).toBe(1);
      void mpBefore;
    }
    const none = startBattle('sage', 5, 10, '賢者', 1, 7);
    const fb = resolveTurn(none, 'tonic');
    expect(fb.lastEvents.some((e) => e.text.includes('持っていない'))).toBe(true);
    expect(fb.tonicsUsed).toBe(0);
  });

  it('にげる: 成功すると outcome=fled で敵は行動しない。決定的', () => {
    // agi の高い ninja で成功しやすい seed を探して固定
    let fledSeen = false;
    let failSeen = false;
    for (let seed = 0; seed < 60 && !(fledSeen && failSeen); seed++) {
      const s = resolveTurn(startBattle('ninja', 8, 15, '忍者', 1, seed), 'flee');
      if (s.outcome === 'fled') {
        fledSeen = true;
        expect(s.lastEvents.some((e) => e.text.includes('逃げ切った'))).toBe(true);
        // 敵の攻撃イベントが無い (成功時は即離脱)
        expect(s.lastEvents.some((e) => e.actor === 'monster' && e.damage !== undefined)).toBe(false);
      } else {
        failSeen = true;
        expect(s.outcome === 'ongoing' || s.outcome === 'lose').toBe(true);
        expect(s.lastEvents.some((e) => e.text.includes('にげられない'))).toBe(true);
      }
    }
    expect(fledSeen).toBe(true);
    expect(failSeen).toBe(true);
  });

  it('にげる成功率は agi 差で変わる (鈍足 guardian < 俊足 ninja、統計)', () => {
    const rate = (arch: 'ninja' | 'guardian') => {
      let fled = 0;
      for (let seed = 0; seed < 200; seed++) {
        if (resolveTurn(startBattle(arch, 5, 10, 'x', 2, seed), 'flee').outcome === 'fled') fled++;
      }
      return fled;
    };
    expect(rate('ninja')).toBeGreaterThan(rate('guardian'));
  });

  it('baseStats (プロフィールの個人値) が戦闘値の基底になる', () => {
    const jobBased = playerCombatant('warrior', 5, 10, 'x');
    const custom = playerCombatant('warrior', 5, 10, 'x', [50, 20, 10, 10, 10]);
    expect(custom.atk).toBeGreaterThan(jobBased.atk); // warrior 基準 atk25 → 個人 50
    // レベルボーナスは同率で乗る (Lv を上げると custom も伸びる)
    const customHigher = playerCombatant('warrior', 10, 20, 'x', [50, 20, 10, 10, 10]);
    expect(customHigher.atk).toBeGreaterThan(custom.atk);
    // startBattle 経由でも効く
    const s = startBattle('warrior', 5, 10, 'x', 1, 42, 0, undefined, { baseStats: [50, 20, 10, 10, 10] });
    expect(s.player.atk).toBe(custom.atk);
  });

  it('carry で HP/MP を引き継いで開始できる (フィールド持続用)', () => {
    const full = startBattle('warrior', 5, 10, '戦士', 1, 42);
    const s = startBattle('warrior', 5, 10, '戦士', 1, 42, 0, { hp: 10, mp: 2 });
    expect(s.player.hp).toBe(10);
    expect(s.player.mp).toBe(2);
    expect(s.player.maxHp).toBe(full.player.maxHp); // max は変わらない
    // クランプ: 過大は max、過小は hp≥1 / mp≥0
    const c = startBattle('warrior', 5, 10, '戦士', 1, 42, 0, { hp: 9999, mp: -5 });
    expect(c.player.hp).toBe(c.player.maxHp);
    expect(c.player.mp).toBe(0);
    const d = startBattle('warrior', 5, 10, '戦士', 1, 42, 0, { hp: 0 });
    expect(d.player.hp).toBe(1); // 0 で始まる (即敗北) 事故を防ぐ
  });

  it('ぼうぎょで focus が立ち翌ターンまで持続する (回避ボーナスの根拠)', () => {
    const s0 = startBattle('guardian', 5, 10, '守護者', 1, 3);
    const s1 = resolveTurn(s0, 'guard');
    expect(s1.player.focus).toBe(1); // 2 で立ててターン末に 1 減衰 → 翌ターン有効
    if (s1.outcome === 'ongoing') {
      const s2 = resolveTurn(s1, 'attack');
      expect(s2.player.focus).toBe(0);
    }
  });

  it('予告に防御で応じる戦略は attack 連打より tier3 勝率が上がる (防御の存在意義)', () => {
    const reactive = (seed: number) => {
      let s = startBattle('warrior', 8, 15, '戦士', 3, seed);
      for (let i = 0; i < 60 && s.outcome === 'ongoing'; i++) {
        // 直前のイベントに予告があれば防御、なければ攻撃
        const telegraphed = s.monster.charging;
        s = resolveTurn(s, telegraphed ? 'guard' : 'attack');
      }
      return s.outcome;
    };
    let reactiveWins = 0;
    let spamWins = 0;
    for (let seed = 0; seed < 100; seed++) {
      if (reactive(seed) === 'win') reactiveWins++;
      if (playOut(startBattle('warrior', 8, 15, '戦士', 3, seed), 'attack').outcome === 'win') spamWins++;
    }
    expect(reactiveWins).toBeGreaterThan(spamWins);
  });

  it('やくそう込みでも tier3 は作業化しない (最適戦略の勝率に天井)', () => {
    // ガード + HP45% 未満でやくそう、が現状の最強ムーブ。0.4/3 個では勝率 97% まで
    // 上がって真剣勝負が崩壊した (レビュー実測) ため、0.3/2 個で 90% 未満に抑える。
    const best = (seed: number) => {
      let s = startBattle('warrior', 8, 15, '戦士', 3, seed, BATTLE_TUNING.herbCarryMax);
      for (let i = 0; i < 60 && s.outcome === 'ongoing'; i++) {
        const cmd = s.monster.charging
          ? 'guard'
          : s.herbs > 0 && s.player.hp < s.player.maxHp * 0.45
            ? 'herb'
            : 'attack';
        s = resolveTurn(s, cmd);
      }
      return s.outcome;
    };
    let wins = 0;
    for (let seed = 0; seed < 100; seed++) if (best(seed) === 'win') wins++;
    expect(wins).toBeLessThan(90);
    // やくそうが「意味はある」ことも同時に固定 (ガードのみ戦略より勝てる)
    let guardOnlyWins = 0;
    for (let seed = 0; seed < 100; seed++) {
      let s = startBattle('warrior', 8, 15, '戦士', 3, seed);
      for (let i = 0; i < 60 && s.outcome === 'ongoing'; i++) {
        s = resolveTurn(s, s.monster.charging ? 'guard' : 'attack');
      }
      if (s.outcome === 'win') guardOnlyWins++;
    }
    expect(wins).toBeGreaterThan(guardOnlyWins);
  });
});

describe('pickTrialTier', () => {
  it('初挑戦 (戦績 0) は必ず tier1', () => {
    for (let seed = 0; seed < 30; seed++) {
      expect(pickTrialTier(seed, 50, 0)).toBe(1);
    }
  });
  it('低レベル (LV<5) には tier3 が出ない', () => {
    for (let seed = 0; seed < 200; seed++) {
      expect(pickTrialTier(seed, 3, 10)).toBeLessThanOrEqual(2);
    }
  });
  it('高レベルでは全 tier が出る (決定的)', () => {
    const seen = new Set<number>();
    for (let seed = 0; seed < 200; seed++) seen.add(pickTrialTier(seed, 20, 10));
    expect(seen).toEqual(new Set([1, 2, 3]));
    expect(pickTrialTier(7, 20, 10)).toBe(pickTrialTier(7, 20, 10));
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
