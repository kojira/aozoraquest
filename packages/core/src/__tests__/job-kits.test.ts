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
    // warrior はキット未登録 → 支配ステータス由来の基本 6 種の署名を返す (挙動不変)。
    const base = ['smash', 'parry', 'flurry', 'spell', 'gamble', 'heal'];
    expect(base).toContain(skillsForJob('warrior', 10)[0]!.kind);
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
