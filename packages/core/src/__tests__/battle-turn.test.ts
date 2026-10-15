import { describe, it, expect } from 'vitest';
import {
  BATTLE_TUNING,
  turnRng,
  skillForJob,
  playerCombatant,
  summonMonster,
  startBattle,
  resolveTurn,
  MONSTERS,
  MONSTERS_BY_ID,
  type BattleState,
  type Command,
} from '../battle.js';

describe('モンスターの行動バリエーション (charger/healer + MP)', () => {
  it('ため攻撃は一部 (~20%) のモンスターに限定 (charger)', () => {
    const chargers = MONSTERS.filter((m) => m.ability === 'charger');
    // 全 12 種中 2 種 = ~17%。全モンスターが力をためる状態は解消
    expect(chargers.length).toBe(2);
    expect(chargers.length / MONSTERS.length).toBeLessThanOrEqual(0.25);
  });

  it('回復する敵 (healer) が存在し、専用の回復技名を持つ', () => {
    const healers = MONSTERS.filter((m) => m.ability === 'healer');
    expect(healers.length).toBeGreaterThanOrEqual(1);
    for (const h of healers) expect(typeof h.healName).toBe('string');
  });

  it('モンスターは int から MP を持ち、特技 (ため/回復) に MP を消費する', () => {
    // healer は tier3 の そらのりゅう (#536 で あおい鬼火 は caster に変更した)。
    const wisp = summonMonster(6, 15, 42).combatant;
    expect(wisp.maxMp).toBeGreaterThan(0);
    // 回復すると MP が減る: healer を低 HP・MP 満タンから 1 手進めて確認
    // sky-dragon が出る seed を探す (見つからないと空 pass になるので存在を明示検証)
    // そらのりゅう (healer) は tier6 = 想定 Lv26 (#536)。jobLv も帯に合わせないと即死して
    // 回復を観測できない。
    let s = startBattle('warrior', 26, 15, 'x', 6, 0);
    let found = false;
    for (let seed = 0; seed < 50; seed++) {
      const t = startBattle('warrior', 26, 15, 'x', 6, seed);
      if (t.monsterId === 'sky-dragon') { s = t; found = true; break; }
    }
    expect(found).toBe(true);
    s.monster.hp = Math.floor(s.monster.maxHp * 0.3); // 低 HP に
    const mpBefore = s.monster.mp;
    // 回復が起きたら MP が減っているはず (決定的なので回復が出るまで進める)
    let healedMpDropped = false;
    for (let i = 0; i < 20 && s.outcome === 'ongoing'; i++) {
      const hpBefore = s.monster.hp;
      s = resolveTurn(s, 'guard'); // プレイヤーは防御に徹して長引かせる
      if (s.monster.hp > hpBefore && s.monster.mp < mpBefore) { healedMpDropped = true; break; }
    }
    expect(healedMpDropped).toBe(true);
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

  it('attack 連打で決着する', () => {
    for (const seed of [1, 22, 333, 4444, 55555]) {
      const s = playOut(startBattle('poet', 3, 5, '詩人', 2, seed), 'attack');
      expect(s.outcome).not.toBe('ongoing');
    }
  });

  it('31 ターン目以降も両者が立っていれば残り HP で判定せず続く (D-BATTLE-001)', () => {
    const s0 = startBattle('guardian', 5, 10, '守護者', 1, 12, 0, undefined, { monsterId: 'sky-slime' });
    s0.turn = 30;
    s0.player.hp = s0.player.maxHp = 9999;
    s0.monster.hp = s0.monster.maxHp = 9999;
    const s = resolveTurn(s0, 'guard');
    expect(s.turn).toBe(31);
    expect(s.outcome).toBe('ongoing');
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
      const s = playOut(startBattle('poet', 1, 1, '詩人', 5, seed), 'attack');
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

  it('大盾の護り (parry) は行動順に関係なく被弾半減 + 反撃が発動する', () => {
    // 守護者は #456 で大盾の護り (parry フラグ技) を Lv15 で習得。鈍足 (agi6) でも後手で反撃が出る。
    let counterSeen = 0;
    for (let seed = 0; seed < 30; seed++) {
      let s = startBattle('guardian', 15, 20, '守護者', 1, seed);
      const parryIdx = s.playerSkills.findIndex((sk) => sk.name === '大盾の護り');
      for (let i = 0; i < 20 && s.outcome === 'ongoing'; i++) {
        s = resolveTurn(s, 'skill', undefined, parryIdx);
        if (s.lastEvents.some((e) => e.text.includes('はんげき'))) counterSeen++;
      }
    }
    expect(counterSeen).toBeGreaterThan(0);
  });

  it('守護者の盾殴り (def 基準) 連打が attack 連打より不利にならない (tier1 勝率)', () => {
    // 守護者は skill[0]=盾殴り (def43 基準)。固有特技を使うほど弱くなる回帰を防ぐ。
    let skillWins = 0;
    let attackWins = 0;
    for (let seed = 0; seed < 100; seed++) {
      if (playOut(startBattle('guardian', 5, 10, '守護者', 1, seed), 'skill').outcome === 'win') skillWins++;
      if (playOut(startBattle('guardian', 5, 10, '守護者', 1, seed), 'attack').outcome === 'win') attackWins++;
    }
    expect(skillWins).toBeGreaterThanOrEqual(attackWins - 10);
  });

  it('spell 型 (sage) Lv1 でも tier3 は skill 連打で突破できない (過半数敗北)', () => {
    // 旧実装 (防御完全無視) は Lv1 sage が tier3 に勝率 79.5% で難易度設計が壊れていた。
    // 閾値は ≥55 (過半数敗北 = cheese 不可)。2026-07-18 のモンスター行動バリエーション
    // (ため攻撃を ~20% に限定) で tier3 が僅かに易化し敗率 60→59 になったため緩和。
    let losses = 0;
    for (let seed = 0; seed < 100; seed++) {
      if (playOut(startBattle('sage', 1, 1, '賢者', 5, seed), 'skill').outcome === 'lose') losses++;
    }
    expect(losses).toBeGreaterThanOrEqual(55);
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

  it('artist の同値タイ (def=luk=26) は後勝ちで gamble に固定', () => {
    // 技名「色彩の閃き」の趣に合わせて gamble。parry だと防御空打ちしか
    // できず tier3 で全ジョブ最弱に沈む (sim 実測 28% → 80%)
    expect(skillForJob('artist').kind).toBe('gamble');
  });

  it('ため予告の次ターンは必ずため攻撃 (または決着済み)', () => {
    for (let seed = 0; seed < 40; seed++) {
      let s = startBattle('warrior', 5, 10, '戦士', 5, seed);
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

  it('MP: 特技で消費する。回復はジョブ特性のみ (特性なしジョブはぼうぎょでも回復 0)', () => {
    // tier は想定プレイヤーレベル (#518) なので、tier2 には **jobLv10** を当てるのが拮抗帯。
    // tier1 では特技 1 撃で決着して MP 検証が回らず、格上 tier では数ターンで負ける。
    const s0 = startBattle('sage', 10, 10, '賢者', 3, 42);
    expect(s0.player.mp).toBe(s0.player.maxMp);
    const s1 = resolveTurn(s0, 'skill');
    expect(s1.player.mp).toBe(s0.player.mp - BATTLE_TUNING.skillMpCost);
    expect(s1.outcome).toBe('ongoing');
    // sage は特性なし → ぼうぎょで回復しない (全員一律回復はジョブ差をぼやけさせる
    // ため)。ログにも MP 表記が出ない
    const s2 = resolveTurn(s1, 'guard');
    expect(s2.player.mp).toBe(s1.player.mp);
    expect(s2.lastEvents.some((e) => e.text.includes('ぼうぎょのかまえ'))).toBe(true);
    // 特性持ち (bard: ぼうぎょ +4) は回復し、ログに特性名が出る。
    // skill 2 連発で headroom を作り、クランプ境界で過大回帰を見逃さない
    // (mp+4 がちょうど maxMp だと guardGain 5 でも通ってしまう — レビュー指摘)
    const b0 = startBattle('bard', 10, 10, '詩人', 3, 42, 0, { mp: 8 });
    const b1 = resolveTurn(b0, 'skill');
    expect(b1.outcome).toBe('ongoing');
    const b2 = resolveTurn(b1, 'guard');
    expect(b2.player.mp - b1.player.mp).toBe(4);
    expect(b2.player.mp).toBeLessThan(b2.player.maxMp);
    expect(b2.lastEvents.some((e) => e.text.includes('歌の余韻'))).toBe(true);
  });

  it('MP 不足の特技は「たたかう」にフォールバックし MP を消費しない', () => {
    // carry.mp で MP 不足状態を決定的に作る (撃ち尽くしループは seed 次第で
    // バトルが先に終わり、assert が一度も走らない構造だった — レビュー指摘)
    const s = startBattle('warrior', 1, 1, '戦士', 1, 7, 0, { mp: BATTLE_TUNING.skillMpCost - 1 });
    expect(s.player.mp).toBeLessThan(BATTLE_TUNING.skillMpCost);
    const next = resolveTurn(s, 'skill');
    expect(next.lastEvents.some((e) => e.text.includes('MP が足りない'))).toBe(true);
    // フォールバック攻撃で MP は消費されない。warrior は特性なしなので回復もしない
    expect(next.player.mp).toBe(s.player.mp);
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
    // tier2 = 想定 Lv10 (#518) なので jobLv10 を当てる。tier1 では 1 撃決着して回復検証が回らない。
    // 職は guardian: 賢者は素の HP が低く、防具なしの検証条件だと 2 ターン目に落ちて
    // しずくを飲む前に決着してしまう (キャスターは防具前提という設計。#518)。
    let s = startBattle('guardian', 10, 10, '守', 3, 42, 0, undefined, { tonics: 2 });
    expect(s.tonics).toBe(2);
    // MP を減らしてから使う (seed 42 は 1 ターン目で決着しない前提を明示的に固定)
    s = resolveTurn(s, 'skill');
    expect(s.outcome).toBe('ongoing');
    const mpBefore = s.player.mp;
    const next = resolveTurn(s, 'tonic');
    expect(next.lastEvents.some((e) => e.text.includes('そらのしずく'))).toBe(true);
    expect(next.tonics).toBe(1);
    expect(next.tonicsUsed).toBe(1);
    // 肝心の MP が仕様どおり増えること (maxMp * tonicMpRatio、上限クランプ)
    const expectedGain = Math.max(1, Math.round(next.player.maxMp * BATTLE_TUNING.tonicMpRatio));
    expect(next.player.mp).toBe(Math.min(next.player.maxMp, mpBefore + expectedGain));
    expect(next.player.mp).toBeGreaterThan(mpBefore);
    const none = startBattle('sage', 5, 10, '賢者', 1, 7); // 所持 0 の分岐だけ見るので tier は軽くてよい
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

  it('会心: 守備力を無視して非会心の理論最大を超える (DQ 流。攻撃力1.5倍 + 守備無視)', () => {
    // 高 def の敵 (ヒカリダケ) にプレイヤーが会心する (seed, turnSeed) を探す。会心は守備無視 +
    // 1.5 倍なので、非会心の理論最大 (roll 1.15、守備軽減あり) を必ず超える。
    const t = BATTLE_TUNING;
    let found: { atk: number; def: number; dmg: number } | null = null;
    for (let seed = 0; seed < 300 && !found; seed++) {
      const b0 = startBattle('warrior', 3, 5, '戦士', 1, seed, 0, undefined, { monsterId: 'glow-shroom' });
      for (let ts = 0; ts < 120; ts++) {
        const next = resolveTurn(b0, 'attack', ts);
        const ev = next.lastEvents.find(
          (e) => e.actor === 'player' && e.damage !== undefined && e.text.includes('会心の一撃'),
        );
        if (ev) { found = { atk: b0.player.atk, def: b0.monster.def, dmg: ev.damage! }; break; }
      }
    }
    expect(found).not.toBeNull();
    // 守備無視が効いている証拠: 非会心の理論最大 (減算式・守備あり・roll 1.15) を会心が上回る。
    const maxNonCrit = Math.max(t.minDamage, Math.round((found!.atk * t.atkCoef - found!.def * t.defCoef) * 1.15));
    expect(found!.dmg).toBeGreaterThan(maxNonCrit);
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
    // やくそう持ち + 300 seed で計測。難易度は「拮抗帯」に合わせる: 固定強度化 (Lv 追従なし)
    // + T2/T3 強化 (#444 の敵 atk 底上げ) 後は tier3 の競り合い帯が上がり、warrior は
    // jobLv15 (T3 ~42%) が拮抗帯 (#507 でジョブ Lv 基準に貼り直し)。ここで予告防御 (reactive) が attack 連打 (spam) を上回る
    // = 防御の存在意義。強化された charger の予告を防がないと事故死するため差が明確に出る。
    const HERBS = 2;
    const reactive = (seed: number) => {
      let s = startBattle('warrior', 15, 1, '戦士', 5, seed, HERBS);
      for (let i = 0; i < 60 && s.outcome === 'ongoing'; i++) {
        const p = s.player;
        // 予告があれば防御、HP 危険域なら やくそう、なければ攻撃
        s = resolveTurn(s, s.monster.charging ? 'guard' : s.herbs > 0 && p.hp < p.maxHp * 0.45 ? 'herb' : 'attack');
      }
      return s.outcome;
    };
    const spam = (seed: number) => {
      let s = startBattle('warrior', 15, 1, '戦士', 5, seed, HERBS);
      for (let i = 0; i < 60 && s.outcome === 'ongoing'; i++) {
        const p = s.player;
        s = resolveTurn(s, s.herbs > 0 && p.hp < p.maxHp * 0.45 ? 'herb' : 'attack');
      }
      return s.outcome;
    };
    let reactiveWins = 0;
    let spamWins = 0;
    for (let seed = 0; seed < 300; seed++) {
      if (reactive(seed) === 'win') reactiveWins++;
      if (spam(seed) === 'win') spamWins++;
    }
    expect(reactiveWins).toBeGreaterThan(spamWins);
  });

  it('固定強度: モンスターはプレイヤー/ジョブレベルに追従しない', () => {
    // 同 seed = 同モンスターで、playerLevel/
    // jobLevel を 1→30 に振っても combatant の強さ (HP/atk/def/agi/int/MP) が完全に一致する
    // = 敵は tier (エリア) 固定強度で、プレイヤーが伸びれば相対的に楽になる。
    for (const tier of [1, 2, 3] as const) {
      const lo = summonMonster(tier, 1, 42, 1, undefined, 0).combatant;
      const hi = summonMonster(tier, 30, 42, 20, undefined, 0).combatant;
      expect(hi.name).toBe(lo.name);
      expect(hi.maxHp).toBe(lo.maxHp);
      expect(hi.atk).toBe(lo.atk);
      expect(hi.def).toBe(lo.def);
      expect(hi.agi).toBe(lo.agi);
      expect(hi.int).toBe(lo.int);
      expect(hi.luk).toBe(lo.luk);
      expect(hi.maxMp).toBe(lo.maxMp);
    }
  });

  it('やくそうは拮抗帯で意味がある (やくそう有り > ガードのみ) — tier3 / jobLv5', () => {
    // tier が想定プレイヤーレベル化した (#518) ので、jobLv5 が競り合う帯は tier2 (想定 Lv10)。
    // そこで「やくそう込み」が「ガードのみ」に勝ることを固定する。
    const reactiveHerb = (s: BattleState): Command =>
      s.monster.charging ? 'guard' : s.herbs > 0 && s.player.hp < s.player.maxHp * 0.45 ? 'herb' : 'attack';
    let withHerb = 0;
    let guardOnlyWins = 0;
    for (let seed = 0; seed < 200; seed++) {
      let s = startBattle('warrior', 5, 8, '戦士', 3, seed, BATTLE_TUNING.herbCarryMax);
      for (let i = 0; i < 60 && s.outcome === 'ongoing'; i++) s = resolveTurn(s, reactiveHerb(s));
      if (s.outcome === 'win') withHerb++;
      let g = startBattle('warrior', 5, 8, '戦士', 3, seed);
      for (let i = 0; i < 60 && g.outcome === 'ongoing'; i++) {
        g = resolveTurn(g, g.monster.charging ? 'guard' : 'attack');
      }
      if (g.outcome === 'win') guardOnlyWins++;
    }
    expect(withHerb).toBeGreaterThan(guardOnlyWins);
  });
});

describe('resolveTurn: 外部 seed 注入 (サーバー権威 §5)', () => {
  const fresh = () => startBattle('warrior', 5, 5, 'テスト勇者', 1, 12345, 0, undefined, { vitalsVariance: 0 });

  it('turnSeed 省略時は従来どおり turnRng(seed,turn) で決定的 (試練/テスト不変)', () => {
    const a = resolveTurn(fresh(), 'attack');
    const b = resolveTurn(fresh(), 'attack');
    expect(a).toEqual(b);
  });

  it('同じ turnSeed なら同じ結果 (再現性: Worker のリトライで一致)', () => {
    const a = resolveTurn(fresh(), 'attack', 0xabcdef);
    const b = resolveTurn(fresh(), 'attack', 0xabcdef);
    expect(a).toEqual(b);
  });

  it('turnSeed が違えば別の乱数列 (先読み不可: 少なくとも一部の seed で結果が変わる)', () => {
    // 同一初期 state・同一コマンドでも turnSeed 次第で分岐すること。複数 seed で差が出るのを確認。
    const base = resolveTurn(fresh(), 'attack');
    let diverged = false;
    for (let s = 1; s <= 40 && !diverged; s++) {
      if (JSON.stringify(resolveTurn(fresh(), 'attack', s)) !== JSON.stringify(base)) diverged = true;
    }
    expect(diverged).toBe(true);
  });

  it('turnSeed 注入でも state を破壊しない (イミュータブル)', () => {
    const s0 = fresh();
    const snap = JSON.stringify(s0);
    resolveTurn(s0, 'attack', 777);
    expect(JSON.stringify(s0)).toBe(snap);
  });
});
