import { describe, it, expect } from 'vitest';
import {
  BATTLE_TUNING,
  summonMonster,
  battleXpFor,
  baselineXp,
  favoredMonsterFor,
  pickTrialTier,
  startBattle,
  resolveTurn,
  MONSTERS,
  MONSTERS_BY_ID,
  ITEMS,
} from '../battle.js';

describe('summonMonster', () => {
  it('tier ごとのプールから決定的に選ぶ', () => {
    const a = summonMonster(1, 5, 123);
    const b = summonMonster(1, 5, 123);
    expect(a.def.id).toBe(b.def.id);
    expect(a.def.tier).toBe(1);
  });
  it('序盤の tier に最低 3 体いる + はぐれスライムはレア逃走敵', () => {
    // tier は 6 段階になった (#536)。**まず tier1〜3 を固める**方針 なので、
    // 顔ぶれの厚みを保証するのは序盤 3 帯。上位 tier は敵を足しながら埋める。
    for (const tier of [1, 2, 3] as const) {
      expect(MONSTERS.filter((m) => m.tier === tier).length, `tier${tier} の顔ぶれ`).toBeGreaterThanOrEqual(3);
    }
    // 全 tier に最低 1 体は必要 (プールが空だと summonMonster が壊れる)
    for (const tier of [4, 5, 6] as const) {
      expect(MONSTERS.filter((m) => m.tier === tier).length, `tier${tier} の顔ぶれ`).toBeGreaterThanOrEqual(1);
    }
    // はぐれメタル型: 序盤帯・レア出現 (spawnWeight<1)・逃走 (fleer)・HP 明示・高 XP
    const stray = MONSTERS_BY_ID['stray-slime'];
    expect(stray?.tier).toBeLessThanOrEqual(2);
    expect(stray?.ability).toBe('fleer');
    expect(stray?.spawnWeight).toBeLessThan(1);
    expect(stray?.hp).toBeDefined();
  });

  it('色違い強い版: tint + 専用素材 + レア出現 (spawnWeight<1) で差別化されている', () => {
    // 強い版と専用素材の対応 (変種ごとに専用素材)
    const variants: Array<[string, string]> = [
      ['red-slime', 'red-jelly'],
      ['dusk-bat', 'dusk-wing'],
      ['crimson-shroom', 'crimson-spore'],
    ];
    for (const [id, mat] of variants) {
      const m = MONSTERS_BY_ID[id];
      // tier は 6→8 段階になった (#536)。色違いは序盤帯 (tier1-2) にいることを固定する。
      expect(m?.tier).toBeLessThanOrEqual(2);
      expect(m?.tint).toMatch(/^#[0-9a-f]{6}$/i); // 色違い (明示色)
      expect(m?.spawnWeight).toBeLessThan(1); // 出現は base より稀
      expect(m?.drops.some((d) => d.item === mat)).toBe(true); // 専用素材を落とす
      expect(ITEMS[mat]).toBeDefined();
    }
    // そらいろスライムは最弱の練習敵 (式で最低クラスの XP)。強い版 (red-slime) より低い。
    expect(battleXpFor('sky-slime')).toBeLessThan(battleXpFor('red-slime'));
  });

  it('はぐれスライム: HP 明示で低い + fleer は逃走して monster-fled で決着 (勝敗なし)', () => {
    // レア出現なので stray-slime を引く seed を探す
    let battle: import('../battle.js').BattleState | null = null;
    for (let seed = 0; seed < 4000; seed++) {
      const b = startBattle('warrior', 1, 1, 'テスト', 2, seed, 0); // #536 で tier2 に移った
      if (b.monsterId === 'stray-slime') { battle = b; break; }
    }
    expect(battle).not.toBeNull();
    // HP 明示 (6) × 想定 Lv 係数 → 同帯の敵より明確に低い (会心一撃圏)
    expect(battle!.monster.maxHp).toBeLessThan(25);
    // 逃走する turnSeed があり、そのとき outcome は monster-fled (win/lose ではない)
    let fled = false;
    for (let ts = 0; ts < 500; ts++) {
      const next = resolveTurn(battle!, 'guard', ts); // guard で自分から倒しに行かない
      if (next.outcome === 'monster-fled') { fled = true; break; }
    }
    expect(fled).toBe(true);
  });
  it('はぐれメタル: 超高守備で通常攻撃は 0 ダメージ・会心 (def無視) のみ貫通', () => {
    // メタルは flatDef で減算式が負に沈み、**通常攻撃は 1 も通らない** (minDamage=0)。
    // プレイヤーの会心だけが def を無視して貫通する (#432)。専用ロジックなし = 守備の数値だけで
    // 「硬い」を表現。最高 atk の shogun でも通常攻撃は 0。
    let normalMax = 0;
    let critDealt = 0;
    for (let seed = 0; seed < 300; seed++) {
      let s = startBattle('shogun', 8, 15, 'x', 2, seed, 0, undefined, { monsterId: 'stray-slime' });
      for (let i = 0; i < 6 && s.outcome === 'ongoing'; i++) {
        const before = s.monster.hp;
        s = resolveTurn(s, 'attack', seed * 100 + i);
        const dealt = before - s.monster.hp;
        if (dealt <= 0) continue;
        if (s.lastEvents.some((e) => e.text.includes('会心'))) critDealt = Math.max(critDealt, dealt);
        else normalMax = Math.max(normalMax, dealt);
      }
    }
    expect(normalMax).toBe(0); // 通常攻撃は 1 も通らない (守備を上回れない)
    expect(critDealt).toBeGreaterThan(1); // 会心は貫通して低 HP を一撃
  });
  it('地域相性 (affinity) は tier プール内の favor 対象を出やすくする (index 方式、死角なし)', () => {
    // tier5 pool = [raven, oni]。#536 で tier が 8 段階になり、よるのおおガラスは tier5 に移った。
    const count = (affinity: number | undefined) => {
      let raven = 0;
      for (let seed = 0; seed < 600; seed++) {
        if (summonMonster(5, 15, seed, 1, affinity).def.id === 'night-raven') raven++;
      }
      return raven;
    };
    const pool = MONSTERS.filter((m) => m.tier === 5);
    const ravenIdx = pool.findIndex((m) => m.id === 'night-raven');
    const uniform = count(undefined);
    const ravenFavored = count(ravenIdx); // その index の敵を favor
    expect(ravenFavored).toBeGreaterThan(uniform);
    // どの affinity でも必ず実在モンスターを favor (死に相性が無い)
    for (let a = 0; a < 3; a++) {
      expect(favoredMonsterFor(5, a)!.tier).toBe(5);
    }
  });

  it('affinity 未指定は従来どおり一様抽選 (後方互換)', () => {
    // 決定的: 同 seed で affinity 有無に関わらず、未指定は旧挙動と一致
    expect(summonMonster(2, 10, 42).def.id).toBe(summonMonster(2, 10, 42, 1).def.id);
  });

  it('モンスターのドロップ素材は全部 ITEMS に定義がある', () => {
    for (const m of MONSTERS) {
      for (const d of m.drops) expect(ITEMS[d.item]).toBeDefined();
    }
  });

  describe('勝利 XP は式＋個別調整 (battleXpFor / baselineXp)', () => {
    it('全モンスターの勝利 XP は 0 より大きい (式 or 個別上書き)', () => {
      for (const m of MONSTERS) expect(battleXpFor(m.id)).toBeGreaterThan(0);
    });

    it('XP は敵の強さと連動する: 硬い敵ほど高い / 上位 tier ほど上限が高い (レア除く)', () => {
      // tier1 内: 硬い ヒカリダケ > 最弱 そらいろスライム (HP 連動)
      expect(battleXpFor('glow-shroom')).toBeGreaterThan(battleXpFor('sky-slime'));
      expect(new Set(MONSTERS.map((m) => battleXpFor(m.id))).size).toBeGreaterThan(1);
      // レアなジャックポット (はぐれメタル型) を除けば tier が上ほど上限が高い。閾値未満の
      // spawnWeight = 「tier 単調性の対象外にするレア敵」の境界 (stray=0.06 を除外)。
      const RARE_JACKPOT_MAX_SPAWN = 0.1;
      const maxOf = (t: 1 | 2 | 3) =>
        Math.max(
          ...MONSTERS.filter((m) => m.tier === t && (m.spawnWeight ?? 1) >= RARE_JACKPOT_MAX_SPAWN).map((m) => battleXpFor(m.id)),
        );
      expect(maxOf(2)).toBeGreaterThan(maxOf(1));
      expect(maxOf(3)).toBeGreaterThan(maxOf(2));
    });

    it('想定 Lv8 以上は xp を明示している (式は序盤校正なので省略すると過小になる — 回帰防止)', () => {
      // baselineXp は序盤帯 (Lv1-6) 校正。強い敵で xp を省くと式が ~1/3〜1/8 に崩落するため、
      // 上位は必ず明示 xp を持たせる契約 (レビュー ★★)。
      // **tier ではなく想定 Lv で判定する** — #536 で tier が 8 段階になり、
      // 旧 tier1 の敵が tier2 に移ったため、tier 基準だと弱い敵にも明示を強いてしまう。
      for (const m of MONSTERS) {
        if ((m.level ?? 1) >= 8) {
          expect(m.xp, `${m.id} (Lv${m.level}) は xp を明示すべき`).toBeGreaterThan(0);
          // 式より十分高い (明示の意味がある) ことも確認
          expect(m.xp!).toBeGreaterThan(baselineXp(m));
        }
      }
    });

    it('式 baselineXp: 基準 HP + atk/agi から算出 (xp 省略時のフォールバック)', () => {
      // tier1-6 の敵は #536 で全て xp を明示した (DQ の刻みに合わせるため。式まかせだと
      // tier2 の敵が tier1 の敵より低い XP になる逆転が起きていた)。式は「xp を書かずに
      // 敵を足したとき」の保険として残っているので、式そのものを直接検証する。
      const def = MONSTERS_BY_ID['sky-slime']!;
      const { xp: _omitted, ...noXp } = def;
      expect(baselineXp(noXp)).toBeGreaterThan(0);
      expect(baselineXp(noXp)).toBeLessThanOrEqual(3); // 低 HP なので低 XP
      // 明示値があるときは式より明示が優先される
      expect(battleXpFor('sky-slime')).toBe(def.xp);
    });

    it('個別上書き: はぐれスライムは低 HP でも xp=100 (ジャックポット)、未知 id は xpWin', () => {
      expect(MONSTERS_BY_ID['stray-slime']!.xp).toBe(100);
      expect(battleXpFor('stray-slime')).toBe(100);
      // 低 HP なので式なら低 XP になる = 上書きが効いている証拠
      expect(baselineXp(MONSTERS_BY_ID['stray-slime']!)).toBeLessThan(100);
      expect(battleXpFor('no-such-monster')).toBe(BATTLE_TUNING.xpWin);
    });
  });

  describe('HP/MP 分散 (vitalsVariance)', () => {
    it('variance=0 (既定) は固定値 = 従来どおり (rng ストリーム不変)', () => {
      const a = summonMonster(2, 10, 42, 1, undefined, 0);
      const b = summonMonster(2, 10, 42, 1); // 既定 0
      expect(a.combatant.maxHp).toBe(b.combatant.maxHp);
      expect(a.combatant.maxMp).toBe(b.combatant.maxMp);
    });

    it('variance>0 は seed 決定的 (同 seed → 同値) かつ満タン開始', () => {
      const a = summonMonster(2, 10, 42, 1, undefined, 0.15);
      const b = summonMonster(2, 10, 42, 1, undefined, 0.15);
      expect(a.combatant.maxHp).toBe(b.combatant.maxHp);
      expect(a.combatant.maxMp).toBe(b.combatant.maxMp);
      expect(a.combatant.hp).toBe(a.combatant.maxHp);
      expect(a.combatant.mp).toBe(a.combatant.maxMp);
    });

    it('分散は def 抽選を変えない (同 seed なら variance 有無で同じモンスター)', () => {
      // jitter は def 抽選の後に rng を引く前提。この順序が崩れると world の敵顔ぶれが
      // 変わるので回帰で固定する (レビュー ★★)。
      for (let s = 1; s <= 30; s++) {
        expect(summonMonster(2, 10, s, 1, undefined, 0.15).def.id).toBe(summonMonster(2, 10, s, 1, undefined, 0).def.id);
      }
    });

    it('同 seed でも variance の有無で HP がばらつく (jitter が効く)', () => {
      // def 選択は jitter より前なので同 seed なら def は同一 → 差は jitter 由来
      let changed = 0;
      for (let s = 1; s <= 20; s++) {
        const fixed = summonMonster(2, 10, s, 1, undefined, 0).combatant.maxHp;
        const jit = summonMonster(2, 10, s, 1, undefined, 0.15).combatant.maxHp;
        if (jit !== fixed) changed++;
      }
      expect(changed).toBeGreaterThan(10);
    });

    it('分散は ±variance の範囲内 (同 def で比較)', () => {
      for (let s = 1; s <= 30; s++) {
        const fixed = summonMonster(3, 12, s, 1, 0, 0).combatant; // affinity 固定で def を揃える
        const jit = summonMonster(3, 12, s, 1, 0, 0.15).combatant;
        if (jit.name !== fixed.name) continue; // 念のため def 一致時のみ
        expect(jit.maxHp).toBeGreaterThanOrEqual(Math.round(fixed.maxHp * 0.85) - 1);
        expect(jit.maxHp).toBeLessThanOrEqual(Math.round(fixed.maxHp * 1.15) + 1);
      }
    });
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
