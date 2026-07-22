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
    // fighter (匠) はまだキット未登録 → 支配ステータス由来の基本 6 種の署名を返す (挙動不変)。
    const base = ['smash', 'parry', 'flurry', 'spell', 'gamble', 'heal'];
    expect(base).toContain(skillsForJob('fighter', 10)[0]!.kind);
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

describe('守護者 確定キット (#456。壁役・def基準)', () => {
  it('レベルで盾殴り〜大盾の護りを習得', () => {
    expect(skillsForJob('guardian', 3).map((s) => s.name)).toContain('盾殴り');
    expect(skillsForJob('guardian', 15).map((s) => s.name)).toEqual(['盾殴り', '大盾の護り', 'とげの盾', '仁王立ち', '守護の祈り']);
  });

  it('キット技はすべて SKILLS に定義がある', () => {
    for (const sk of skillsForJob('guardian', 30)) expect(SKILLS[sk.kind], sk.kind).toBeDefined();
  });

  it('盾殴りは def 基準でダメージを与える (守りの固さで殴る)', () => {
    const s = startBattle('guardian', 3, 8, '守', 1, 5, 0);
    const idx = s.playerSkills.findIndex((sk) => sk.name === '盾殴り');
    const before = s.monster.hp;
    const next: BattleState = resolveTurn(s, 'skill', 999, idx);
    expect(next.monster.hp).toBeLessThan(before); // def43 型なので通常攻撃(atk24)より重い
  });

  it('とげの盾を張ると敵の攻撃を反射する', () => {
    // とげの盾 (self) を張ってから、敵が殴ってくるターンで敵 HP が反射ぶん減る。
    let reflected = false;
    for (let seed = 0; seed < 20 && !reflected; seed++) {
      let s = startBattle('guardian', 8, 12, '守', 3, seed, 0);
      const idx = s.playerSkills.findIndex((sk) => sk.name === 'とげの盾');
      s = resolveTurn(s, 'skill', undefined, idx); // とげの盾を張る
      if (s.outcome !== 'ongoing' || !s.player.statuses?.some((st) => st.id === 'thorns')) continue;
      const monBefore = s.monster.hp;
      // ぼうぎょして敵の攻撃を受ける (反射狙い)。
      const next: BattleState = resolveTurn(s, 'guard');
      if (next.lastEvents.some((e) => e.text.includes('とげに'))) {
        reflected = true;
        expect(next.monster.hp).toBeLessThanOrEqual(monBefore);
      }
    }
    expect(reflected).toBe(true);
  });
});

describe('巫女 確定キット (#456。luk支援・全体技のソロ退化)', () => {
  it('レベルで癒しの鈴〜払串を習得', () => {
    expect(skillsForJob('miko', 3).map((s) => s.name)).toContain('癒しの鈴');
    expect(skillsForJob('miko', 22).map((s) => s.name)).toEqual(['癒しの鈴', '風の舞', '眠りの鈴', '加護', '破魔の舞', '癒し神楽', '払串']);
  });

  it('キット技はすべて SKILLS に定義がある', () => {
    for (const sk of skillsForJob('miko', 30)) expect(SKILLS[sk.kind], sk.kind).toBeDefined();
  });

  it('癒しの鈴 (heal allAllies) はソロで自分を回復する', () => {
    const s = startBattle('miko', 3, 8, '巫', 1, 5, 0);
    s.player.hp = Math.max(1, s.player.maxHp - 20);
    const before = s.player.hp;
    const idx = s.playerSkills.findIndex((sk) => sk.name === '癒しの鈴');
    const next: BattleState = resolveTurn(s, 'skill', 999, idx);
    expect(next.player.hp).toBeGreaterThan(before);
  });

  it('眠りの鈴 (sleep allEnemies) はソロで敵を眠らせる', () => {
    let slept = false;
    for (let seed = 0; seed < 30 && !slept; seed++) {
      const s = startBattle('miko', 8, 12, '巫', 3, seed, 0);
      const idx = s.playerSkills.findIndex((sk) => sk.name === '眠りの鈴');
      const next: BattleState = resolveTurn(s, 'skill', undefined, idx);
      if (next.monster.hp > 0 && next.monster.statuses?.some((st) => st.id === 'sleep')) slept = true;
    }
    expect(slept).toBe(true);
  });
});

describe('吟遊詩人 確定キット (#456。空属性・歌支援)', () => {
  it('レベルでプレリュード〜アプローズを習得', () => {
    expect(skillsForJob('bard', 3).map((s) => s.name)).toContain('プレリュード');
    expect(skillsForJob('bard', 25).map((s) => s.name)).toEqual(['プレリュード', 'デスペラード', 'ララバイ', 'スケルツォ', 'ディスコード', 'ラプソディ', 'アプローズ']);
  });

  it('キット技はすべて SKILLS に定義がある', () => {
    for (const sk of skillsForJob('bard', 30)) expect(SKILLS[sk.kind], sk.kind).toBeDefined();
  });

  it('プレリュード (atkUp+agiUp allAllies) はソロで自分に2バフ', () => {
    const s = startBattle('bard', 3, 8, '吟', 1, 5, 0);
    const idx = s.playerSkills.findIndex((sk) => sk.name === 'プレリュード');
    const next: BattleState = resolveTurn(s, 'skill', undefined, idx);
    const ids = new Set(next.player.statuses?.map((st) => st.id));
    expect(ids.has('atkUp')).toBe(true);
    expect(ids.has('agiUp')).toBe(true);
  });

  it('デスペラード (void 魔法 allEnemies) が敵にダメージ', () => {
    const s = startBattle('bard', 5, 8, '吟', 2, 3, 0);
    const idx = s.playerSkills.findIndex((sk) => sk.name === 'デスペラード');
    const before = s.monster.hp;
    const next: BattleState = resolveTurn(s, 'skill', undefined, idx);
    expect(next.monster.hp).toBeLessThan(before);
  });
});

describe('隊長 確定キット (#456。全体バフはソロで自己/敵に退化)', () => {
  it('レベルで突撃号令〜攻陣を習得', () => {
    expect(skillsForJob('captain', 3).map((s) => s.name)).toContain('突撃号令');
    expect(skillsForJob('captain', 25).map((s) => s.name)).toEqual(['突撃号令', '鼓舞', '防陣', '突進', '檄', '捨て身攻撃', '攻陣']);
  });

  it('キット技はすべて SKILLS に定義がある', () => {
    for (const sk of skillsForJob('captain', 30)) expect(SKILLS[sk.kind], sk.kind).toBeDefined();
  });

  it('鼓舞 (atkUp allAllies) はソロで自分に atk バフを付与', () => {
    const s = startBattle('captain', 5, 8, '隊', 1, 5, 0);
    const idx = s.playerSkills.findIndex((sk) => sk.name === '鼓舞');
    const next: BattleState = resolveTurn(s, 'skill', undefined, idx);
    expect(next.player.statuses?.some((st) => st.id === 'atkUp')).toBe(true);
    expect(next.monster.statuses?.some((st) => st.id === 'atkUp')).toBe(false); // 敵には付かない
  });

  it('攻陣 (§12: 味方atk↑+敵agi↓) はソロで自分に atkUp・敵に agiDown を付与', () => {
    const s = startBattle('captain', 25, 28, '隊', 3, 5, 0);
    const idx = s.playerSkills.findIndex((sk) => sk.name === '攻陣');
    const next: BattleState = resolveTurn(s, 'skill', undefined, idx);
    expect(next.player.statuses?.some((st) => st.id === 'atkUp')).toBe(true); // 味方 (自分) に atk↑
    expect(next.monster.statuses?.some((st) => st.id === 'agiDown')).toBe(true); // 敵に agi↓
    expect(next.monster.statuses?.some((st) => st.id === 'atkUp')).toBe(false); // 敵にはバフが付かない
  });
});

describe('将軍 確定キット (#456)', () => {
  it('レベルで一閃〜鬼神斬りを習得', () => {
    expect(skillsForJob('shogun', 3).map((s) => s.name)).toContain('一閃');
    expect(skillsForJob('shogun', 20).map((s) => s.name)).toEqual(['一閃', '足払い', '見切り', '鬼神斬り']);
  });

  it('キット技はすべて SKILLS に定義がある', () => {
    for (const sk of skillsForJob('shogun', 30)) expect(SKILLS[sk.kind], sk.kind).toBeDefined();
  });

  it('足払いは命中で転倒を付与 (次行動不可 + 被ダメ↑)', () => {
    let tumbled = false;
    for (let seed = 0; seed < 40 && !tumbled; seed++) {
      const s = startBattle('shogun', 8, 12, '将', 3, seed, 0);
      const idx = s.playerSkills.findIndex((sk) => sk.name === '足払い');
      const next: BattleState = resolveTurn(s, 'skill', undefined, idx);
      if (next.monster.hp > 0 && next.monster.statuses?.some((st) => st.id === 'tumble')) tumbled = true;
    }
    expect(tumbled).toBe(true);
  });
});

describe('予言者 確定キット (#456)', () => {
  it('レベルで未来スイッチ〜蠱毒の王を習得', () => {
    expect(skillsForJob('seer', 3).map((s) => s.name)).toContain('未来スイッチ');
    expect(skillsForJob('seer', 20).map((s) => s.name)).toEqual(['未来スイッチ', '雷の予言', '毒の予言', '破滅の予言', '蠱毒の王']);
  });

  it('キット技はすべて SKILLS に定義がある', () => {
    for (const sk of skillsForJob('seer', 30)) expect(SKILLS[sk.kind], sk.kind).toBeDefined();
  });

  it('破滅の予言は doomMark を敵に付与し、炸裂は int 連動 (基礎15超)', () => {
    const s = startBattle('seer', 12, 18, '予', 3, 5, 0);
    const idx = s.playerSkills.findIndex((sk) => sk.name === '破滅の予言');
    const next: BattleState = resolveTurn(s, 'skill', undefined, idx);
    const doom = next.monster.statuses?.find((st) => st.id === 'doomMark');
    expect(doom).toBeDefined();
    // 炸裂ダメージ = 15 + int×0.3。seer は int 最高なので基礎 15 を上回る。
    expect(doom!.magnitude).toBeGreaterThan(15);
    expect(next.lastEvents.some((e) => e.text.includes('破滅の刻印'))).toBe(true);
  });
});

describe('賢者 確定キット (#456)', () => {
  it('レベルで火炎〜星辰の大魔法を習得 (全5属性)', () => {
    expect(skillsForJob('sage', 3).map((s) => s.name)).toContain('火炎');
    expect(skillsForJob('sage', 22).map((s) => s.name)).toEqual([
      '火炎', '解式', '石射', '氷結', '疾風', '天啓', '賢者の癒し', '星辰の大魔法',
    ]);
  });

  it('キット技はすべて SKILLS に定義がある', () => {
    for (const sk of skillsForJob('sage', 30)) expect(SKILLS[sk.kind], sk.kind).toBeDefined();
  });

  it('全5属性 (fire/water/earth/wind/void) を網羅する', () => {
    const els = new Set<string>();
    for (const sk of skillsForJob('sage', 22)) {
      for (const e of SKILLS[sk.kind]!.effects) {
        if (e.kind === 'fixedDamage' && e.element) els.add(e.element);
      }
    }
    expect(els).toEqual(new Set(['fire', 'earth', 'water', 'wind', 'void']));
  });

  it('天啓 (void) が実戦でダメージを通す (空属性の初使用)', () => {
    const s = startBattle('sage', 12, 18, '賢', 2, 3, 0);
    const idx = s.playerSkills.findIndex((sk) => sk.name === '天啓');
    const before = s.monster.hp;
    const next: BattleState = resolveTurn(s, 'skill', undefined, idx);
    expect(next.monster.hp).toBeLessThan(before);
    expect(next.lastEvents.some((e) => e.text.includes('天啓'))).toBe(true);
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

  it('isPureHealSkill: 純回復技のみ true (サボる=restoreMp混在は false)', async () => {
    const { isPureHealSkill } = await import('../index.js');
    expect(isPureHealSkill('paladin-heal')).toBe(true); // heal のみ
    expect(isPureHealSkill('heal')).toBe(true); // 基本 heal
    expect(isPureHealSkill('performer-slack')).toBe(false); // restoreMp+heal
    expect(isPureHealSkill('paladin-lightblade')).toBe(false); // 攻撃
    expect(isPureHealSkill('unknown')).toBe(false);
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

  it('いちかばちかは agi 基準 (遊び人の最強ステ)。luk 基準の弱火力ではない', () => {
    // gamble の抽選を最大に固定 (turnSeed) しても、agi 基準なので luk 型より火力が出る想定。
    // ここでは stat が agi であることを SKILLS 定義で担保 (実火力は sim)。
    const def = SKILLS['performer-gamble']!;
    const dmg = def.effects.find((e) => e.kind === 'damage');
    expect(dmg && dmg.kind === 'damage' ? dmg.stat : undefined).toBe('agi');
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
