import { describe, it, expect } from 'vitest';
import { skillsForJob, startBattle, resolveTurn, SKILLS, type BattleState } from '../index.js';

describe('魔法使い 確定キット (#456)', () => {
  it('低 Lv (未習得帯) は署名スキルにフォールバック', () => {
    const s = skillsForJob('mage', 1);
    expect(s).toHaveLength(1);
    // 署名 = 解式マギア (spell)。Lv1-2 はこれだけ。
    expect(s[0]!.kind).toBe('spell');
  });

  it('Lv3 で火炎術式を習得、Lv6 までに石射まで揃う', () => {
    const l3 = skillsForJob('mage', 3).map((s) => s.name);
    expect(l3).toContain('火炎術式');
    expect(l3).not.toContain('解式マギア'); // 解式は Lv5
    const l6 = skillsForJob('mage', 6).map((s) => s.name);
    expect(l6).toEqual(['火炎術式', '解式マギア', '石射']);
  });

  it('Lv25 で全 9 技 (メテオまで)。魔力障壁 P は後続', () => {
    const names = skillsForJob('mage', 25).map((s) => s.name);
    expect(names).toEqual(['火炎術式', '解式マギア', '石射', '氷結術式', 'メルティ', '爆炎術式', 'じわれ', '永久凍土', 'メテオ']);
  });

  it('キット技はすべて SKILLS レジストリに定義がある', () => {
    for (const sk of skillsForJob('mage', 30)) {
      expect(SKILLS[sk.kind], sk.kind).toBeDefined();
    }
  });

  it('他ジョブ (キット未登録) は従来どおり基本 6 種の署名スキル', () => {
    // guardian はキット未登録 → 支配ステータス由来の基本 6 種の署名を返す (挙動不変)。
    const base = ['smash', 'parry', 'flurry', 'spell', 'gamble', 'heal'];
    expect(base).toContain(skillsForJob('guardian', 10)[0]!.kind);
  });

  it('火炎術式が実戦で魔法ダメージ (必中・def無視・範囲) を通す (mage)', () => {
    // 高 def の敵に対し、物理は通りにくいが魔法 (fixedDamage) は def を無視して範囲ダメを通す。
    const s = startBattle('mage', 3, 8, '魔', 2, 12345, 0);
    const skills = s.playerSkills;
    const flameIdx = skills.findIndex((sk) => sk.name === '火炎術式');
    expect(flameIdx).toBeGreaterThanOrEqual(0);
    const before = s.monster.hp;
    // 火炎術式を撃つ (skillIndex=flameIdx)。魔法は必中なのでダメージが必ず入る。
    let next: BattleState = resolveTurn(s, 'skill', undefined, flameIdx);
    // 敵にダメージが入っている (必中・def無視で最低でも min×相性ぶん)。
    const dealt = before - next.monster.hp + (next.monster.hp === 0 ? 0 : 0);
    expect(next.monster.hp).toBeLessThan(before);
    expect(next.lastEvents.some((e) => e.text.includes('火炎術式'))).toBe(true);
    void dealt;
  });
});

describe('忍者 確定キット (#456)', () => {
  it('レベルで毒手→かくれみ→火遁→急所狙い→九字切りを習得', () => {
    expect(skillsForJob('ninja', 3).map((s) => s.name)).toContain('毒手');
    expect(skillsForJob('ninja', 15).map((s) => s.name)).toEqual(['毒手', 'かくれみ', '火遁', '急所狙い', '九字切り']);
  });

  it('キット技はすべて SKILLS に定義がある', () => {
    for (const sk of skillsForJob('ninja', 30)) expect(SKILLS[sk.kind], sk.kind).toBeDefined();
  });

  it('毒手が実戦で毒を付与する (inflict)', () => {
    // chance 0.7 なので複数 seed で少なくとも1回は毒が乗る。
    let poisoned = false;
    for (let seed = 0; seed < 20 && !poisoned; seed++) {
      const s = startBattle('ninja', 3, 8, '忍', 1, seed, 0);
      const idx = s.playerSkills.findIndex((sk) => sk.name === '毒手');
      const next: BattleState = resolveTurn(s, 'skill', undefined, idx);
      if (next.monster.statuses?.some((st) => st.id === 'poison')) poisoned = true;
    }
    expect(poisoned).toBe(true);
  });

  it('かくれみ / 九字切りは自分に状態を付与 (self)', () => {
    const s = startBattle('ninja', 15, 20, '忍', 1, 7, 0);
    const hideIdx = s.playerSkills.findIndex((sk) => sk.name === 'かくれみ');
    const afterHide: BattleState = resolveTurn(s, 'skill', undefined, hideIdx);
    expect(afterHide.player.statuses?.some((st) => st.id === 'hidden')).toBe(true);
  });

  it('九字切りの critCharge は付与ターンを生き延び、次ターン頭に残っている (turns:2 回帰)', () => {
    // turns:1 だと付与ターン末の tickStatuses で即消え、次の攻撃で会心にならない空撃ちだった。
    const s = startBattle('ninja', 15, 20, '忍', 1, 7, 0);
    const kujiIdx = s.playerSkills.findIndex((sk) => sk.name === '九字切り');
    const afterKuji: BattleState = resolveTurn(s, 'skill', undefined, kujiIdx);
    expect(afterKuji.player.statuses?.some((st) => st.id === 'critCharge')).toBe(true);
    // 付与を告知している (無告知回帰の防止)。
    expect(afterKuji.lastEvents.some((e) => e.text.includes('研ぎ澄ま'))).toBe(true);
  });

  it('急所狙いは命中で麻痺を付与 + 告知が出る (§7)。fresh スキップで付与ターンに消えない', () => {
    // 一撃で倒すと inflict は乗らない (res.fatal ガード) ので、生き残る tier3 の敵で検証。
    let stunned = false;
    for (let seed = 0; seed < 40 && !stunned; seed++) {
      const s = startBattle('ninja', 12, 18, '忍', 3, seed, 0);
      const idx = s.playerSkills.findIndex((sk) => sk.name === '急所狙い');
      const next: BattleState = resolveTurn(s, 'skill', undefined, idx);
      // fresh スキップにより turns:1 の麻痺が付与ターン末の tick で消えず残る。
      if (next.monster.hp > 0 && next.monster.statuses?.some((st) => st.id === 'stun')) {
        stunned = true;
        expect(next.lastEvents.some((e) => e.text.includes('麻痺'))).toBe(true);
      }
    }
    expect(stunned).toBe(true);
  });
});

describe('詩人 確定キット (#456)', () => {
  it('レベルで心晴の韻〜心の詩を習得', () => {
    expect(skillsForJob('poet', 3).map((s) => s.name)).toContain('心晴の韻');
    expect(skillsForJob('poet', 12).map((s) => s.name)).toEqual(['心晴の韻', '静心', '昂ぶりの詩', '言の葉縛り', '無心']);
    expect(skillsForJob('poet', 20).map((s) => s.name)).toContain('感情爆発');
    expect(skillsForJob('poet', 22).map((s) => s.name)).toContain('心の詩');
  });

  it('感情爆発が実戦で水属性の大ダメージを通す (scaleBy の威力伸長は skills.test で単体検証)', () => {
    const s = startBattle('poet', 20, 25, '詩', 3, 11, 0);
    const burstIdx = s.playerSkills.findIndex((sk) => sk.name === '感情爆発');
    expect(burstIdx).toBeGreaterThanOrEqual(0);
    const next: BattleState = resolveTurn(s, 'skill', undefined, burstIdx);
    expect(next.monster.hp).toBeLessThan(s.monster.hp);
    expect(next.lastEvents.some((e) => e.text.includes('感情爆発'))).toBe(true);
  });

  it('キット技はすべて SKILLS に定義がある', () => {
    for (const sk of skillsForJob('poet', 30)) expect(SKILLS[sk.kind], sk.kind).toBeDefined();
  });

  it('心の詩は自分に atk/def/agi の3バフを一括付与 (複数 effect 合成)', () => {
    const s = startBattle('poet', 22, 25, '詩', 1, 3, 0);
    const idx = s.playerSkills.findIndex((sk) => sk.name === '心の詩');
    const next: BattleState = resolveTurn(s, 'skill', undefined, idx);
    const ids = new Set(next.player.statuses?.map((st) => st.id));
    expect(ids.has('atkUp')).toBe(true);
    expect(ids.has('defUp')).toBe(true);
    expect(ids.has('agiUp')).toBe(true);
  });

  it('言の葉縛りは敵に束縛を付与 (被弾で解けない拘束)', () => {
    let bound = false;
    for (let seed = 0; seed < 20 && !bound; seed++) {
      const s = startBattle('poet', 8, 12, '詩', 3, seed, 0);
      const idx = s.playerSkills.findIndex((sk) => sk.name === '言の葉縛り');
      const next: BattleState = resolveTurn(s, 'skill', undefined, idx);
      if (next.monster.hp > 0 && next.monster.statuses?.some((st) => st.id === 'restraint')) bound = true;
    }
    expect(bound).toBe(true);
  });
});

describe('聖騎士 確定キット (#456)', () => {
  it('レベルで聖光の癒し〜浄化を習得', () => {
    expect(skillsForJob('paladin', 3).map((s) => s.name)).toContain('聖光の癒し');
    expect(skillsForJob('paladin', 18).map((s) => s.name)).toEqual(['聖光の癒し', '光の加護', '光の剣', '聖なる守り', '浄化']);
  });

  it('キット技はすべて SKILLS に定義がある', () => {
    for (const sk of skillsForJob('paladin', 30)) expect(SKILLS[sk.kind], sk.kind).toBeDefined();
  });

  it('浄化は自分のデバフを回復するがバフは残す (cleanse)', () => {
    const s = startBattle('paladin', 18, 25, '聖', 1, 5, 0);
    // 手動でデバフ + バフを乗せてから浄化。
    s.player.statuses = [
      { id: 'poison', turns: 3, magnitude: 2 },
      { id: 'atkDown', turns: 3 },
      { id: 'atkUp', turns: 3 },
    ];
    const purifyIdx = s.playerSkills.findIndex((sk) => sk.name === '浄化');
    const next: BattleState = resolveTurn(s, 'skill', undefined, purifyIdx);
    const ids = next.player.statuses?.map((st) => st.id) ?? [];
    expect(ids).not.toContain('poison'); // デバフ除去
    expect(ids).not.toContain('atkDown');
    expect(ids).toContain('atkUp'); // バフは残る
    expect(next.lastEvents.some((e) => e.text.includes('状態異常が回復'))).toBe(true);
  });

  it('光の剣が holy (無属性) 魔法で def 無視ダメージ', () => {
    const s = startBattle('paladin', 8, 12, '聖', 2, 3, 0);
    const idx = s.playerSkills.findIndex((sk) => sk.name === '光の剣');
    const before = s.monster.hp;
    const next: BattleState = resolveTurn(s, 'skill', undefined, idx);
    expect(next.monster.hp).toBeLessThan(before);
    expect(next.lastEvents.some((e) => e.text.includes('光の剣'))).toBe(true);
  });
});

describe('遊び人 確定キット (#456)', () => {
  it('レベルでサボる〜曲芸乱舞を習得', () => {
    expect(skillsForJob('performer', 5).map((s) => s.name)).toContain('サボる');
    expect(skillsForJob('performer', 15).map((s) => s.name)).toEqual(['サボる', 'いちかばちか', '曲芸乱舞']);
  });

  it('キット技はすべて SKILLS に定義がある', () => {
    for (const sk of skillsForJob('performer', 30)) expect(SKILLS[sk.kind], sk.kind).toBeDefined();
  });

  it('サボるは MP を回復する (restoreMp)', () => {
    const s = startBattle('performer', 5, 8, '遊', 1, 5, 0);
    s.player.mp = 0; // MP を空に
    const idx = s.playerSkills.findIndex((sk) => sk.name === 'サボる');
    // MP0 だと skill が attack にフォールバックするので、サボる自体は MP コストを踏むが回復で上回る想定。
    // ここでは MP を skillMpCost 以上にしてから撃つ。
    s.player.mp = 6;
    const next: BattleState = resolveTurn(s, 'skill', undefined, idx);
    expect(next.player.mp).toBeGreaterThan(6 - 4); // 消費4を上回って回復
    expect(next.lastEvents.some((e) => e.text.includes('MP が'))).toBe(true);
  });

  it('いちかばちかは反動で自分もダメージを受ける (recoil、HP1未満にはしない)', () => {
    const s = startBattle('performer', 12, 18, '遊', 1, 5, 0);
    const idx = s.playerSkills.findIndex((sk) => sk.name === 'いちかばちか');
    const next: BattleState = resolveTurn(s, 'skill', undefined, idx);
    expect(next.lastEvents.some((e) => e.text.includes('反動'))).toBe(true);
    expect(next.player.hp).toBeGreaterThanOrEqual(1);
  });
});

describe('戦士 確定キット (#456)', () => {
  it('レベルでみだれ突き〜全力斬りを習得 (全体技は後続なので Lv3-4 は署名)', () => {
    expect(skillsForJob('warrior', 4)[0]!.kind).not.toMatch(/^warrior-/); // Lv5 未満は署名フォールバック
    expect(skillsForJob('warrior', 18).map((s) => s.name)).toEqual(['みだれ突き', 'かぶとわり', 'ためる', '全力斬り']);
  });

  it('キット技はすべて SKILLS に定義がある', () => {
    for (const sk of skillsForJob('warrior', 30)) expect(SKILLS[sk.kind], sk.kind).toBeDefined();
  });

  it('かぶとわりは命中で守備力↓を付与 (継続戦)', () => {
    let debuffed = false;
    for (let seed = 0; seed < 40 && !debuffed; seed++) {
      const s = startBattle('warrior', 10, 15, '戦', 3, seed, 0);
      const idx = s.playerSkills.findIndex((sk) => sk.name === 'かぶとわり');
      const next: BattleState = resolveTurn(s, 'skill', undefined, idx);
      if (next.monster.hp > 0 && next.monster.statuses?.some((st) => st.id === 'defDown')) debuffed = true;
    }
    expect(debuffed).toBe(true);
  });
});
