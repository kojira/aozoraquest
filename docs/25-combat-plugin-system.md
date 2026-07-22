# 25. 戦闘プラグインシステム (とくぎ / 状態異常 / 属性 / モンスター能力)

エピック #434 の後半 (#437 以降)。とくぎ・状態異常・属性・モンスター能力を **データ駆動の
プラグイン方式**で実装する。**ベタ書き if / switch で分岐しない** (オーナー方針 2026-07-22)。
新しいとくぎ・敵・属性・状態は「**定義データを1個足すだけ**」で増え、戦闘エンジン本体は
触らない。#436 (kind enum + `switch(skill.kind)`) はこの方式への踏み台であり、本ドキュメントの
構造へ移行する。

忍者を**パイロット**として、この基盤 + 忍者の全とくぎを end-to-end で実装し、アーキテクチャの
妥当性を証明する。以降のジョブ・モンスターは定義データを足すだけで拡張する。

---

## 0. 原則

- **レジストリ + フック**: エンジンは「登録された定義を回す」だけ。分岐はしない。
- **宣言的**: とくぎ = 効果プリミティブの列。状態異常 = フックの集合。属性 = 小さな表。
- **合成可能**: 「攻撃して毒を盛る」「回復してバフ」等はプリミティブの組み合わせで書く。
- **後方互換**: 既存の物理とくぎ (smash/spell/…) も同じ枠組みに載せ替える。

---

## 1. 属性システム (地水火風 + 空)

5 属性。4 元素は一方向の輪 **地→水→火→風→(地)** (矢印=「強い」)。空は別格 (万能だが脆い)。

```ts
export type Element = 'earth' | 'water' | 'fire' | 'wind' | 'void';

// 輪: X が BEATS[X] に「強い」。空 (void) は輪の外。
const BEATS: Record<Element, Element | null> = {
  earth: 'water', water: 'fire', fire: 'wind', wind: 'earth', void: null,
};

/** 攻撃属性 × 防御属性 → ダメージ倍率。無属性 (null) は常に等倍。 */
export function elementMultiplier(atk: Element | null, def: Element | null): number {
  if (!atk || !def) return 1;                 // 無属性 (物理) は等倍
  if (atk === 'void' || def === 'void') return 1.2; // 空: 攻撃も被弾も 1.2 (器用貧乏の万能)
  if (BEATS[atk] === def) return ELEM_STRONG;  // 有利 (輪で強い)
  if (BEATS[def] === atk) return ELEM_WEAK;    // 不利 (輪で弱い)
  return 1;                                    // 中立 (地↔火, 水↔風)
}
const ELEM_STRONG = 1.5; // 濃い駆け引き。マイルドにするなら 1.3
const ELEM_WEAK = 0.5;   //                          〃          0.7
```

- **相性まとめ**: 地>水, 水>火, 火>風, 風>地。弱点は逆側 (地は風に弱い等)。中立は 地↔火 / 水↔風。
- **メタル (はぐれスライム)**: `resistAll: true` = **全属性技を無効** (最小ダメージ)。属性でも会心でもない
  通常/属性攻撃は 1 に沈む → **会心 (守備無視) のみが討伐路**という既存設計を維持。
- **無属性**: 通常攻撃・物理とくぎ (強撃/連撃/大博打/見切り) は `element` を持たず常に等倍。属性が
  絡むのは属性とくぎ (火遁など) と属性を持つ敵だけ = システムを軽く保つ。
- **敵の属性**: `MonsterDef.element?` を振る (例: スライム=水, キノコ=地, コウモリ=風, ゴーレム=地,
  鬼火=火, 大蛇=水, ガラス=風, 鬼=火, 竜=空)。振り分けは実装時に確定。

---

## 2. とくぎ (SkillDef + 効果プリミティブ + レジストリ)

とくぎは**自己完結の定義**。効果は宣言的プリミティブの列。実行は `EFFECT_HANDLERS` を回すだけ。

```ts
export interface SkillDef {
  id: string;
  name: string;
  mpCost: number;
  element?: Element;      // 属性技のみ
  desc: string;          // UI 表示 (「押せない理由」や効果説明)
  effects: SkillEffect[]; // 上から順に適用
}

export type SkillEffect =
  // ステータス基準ダメージ (既存の smash/spell/flurry/gamble はこれで表現)
  | { kind: 'damage'; stat: 'atk' | 'int' | 'agi' | 'luk'; power: number;
      defFactor?: number; hits?: number; hitBonus?: number; useCrit?: boolean;
      element?: Element;
      // 命中時に状態を盛る (回避されたら盛らない)。毒手・急所狙い等。
      inflict?: { status: StatusId; chance?: number; turns?: number; magnitude?: [number, number] } }
  // 固定ダメージ (防御無視オプション)。火遁。
  | { kind: 'fixedDamage'; min: number; max: number; ignoreDef?: boolean; element?: Element }
  // 回復 (maxHp 割合)。いのり。
  | { kind: 'heal'; ratio: number }
  // 状態を自分/相手に付与 (無条件)。かくれみ (self hidden)・九字切り (self critCharge)。
  | { kind: 'status'; status: StatusId; target: 'self' | 'enemy'; chance?: number; turns?: number; magnitude?: [number, number] };

export const SKILLS: Record<string, SkillDef> = { /* 忍者キットは §7 */ };

// 効果1種 = ハンドラ1個。新効果はここに足すだけ (switch なし)。
type EffectHandler = (e: SkillEffect, ctx: SkillContext) => void;
export const EFFECT_HANDLERS: Record<SkillEffect['kind'], EffectHandler> = {
  damage: (e, ctx) => { /* doAttack + element/crit + inflict */ },
  fixedDamage: (e, ctx) => { /* 属性乗算 + ignoreDef + resistAll チェック */ },
  heal: (e, ctx) => { /* min(maxHp, hp + maxHp*ratio) */ },
  status: (e, ctx) => { /* STATUS_REGISTRY 経由で付与 */ },
};

interface SkillContext { state: BattleState; attacker: Combatant; defender: Combatant; rng: () => number; events: TurnEvent[] }
```

実行 (resolveTurn 内): `for (const e of skill.effects) EFFECT_HANDLERS[e.kind](e, ctx);`
→ とくぎのロジックは**データ**に宿り、エンジンは回すだけ。

---

## 3. 状態異常エンジン (StatusDef + フック + レジストリ)

`Combatant.statuses: StatusInstance[]` を追加。各状態は §4 の **`CombatHook` を実装した定義**
(`StatusDef`) としてレジストリに置き、エンジンが各フック点で回す (§4 のディスパッチと共通)。

```ts
export interface StatusInstance { id: StatusId; turns: number; magnitude?: number }
export type StatusId = 'poison' | 'sleep' | 'stun' | 'hidden' | 'critCharge' | 'atkUp' | 'atkDown' | 'defUp' | 'defDown' | 'agiDown';
// StatusDef の interface は §4 (CombatHook を extends) を参照。
```

**各状態が使うフック (§4 の CombatHook)**:
| 状態 | 使うフック | 挙動 |
|---|---|---|
| poison (毒) | `turnEnd` | ターン終了に magnitude ダメージ。`immuneIf` で毒無効の敵を弾く |
| sleep (眠り) | `beforeAct`(block) | 行動不可 + `wakeOnHit` + 毎ターン起床判定 |
| stun (麻痺) | `beforeAct`(block) | 1 ターン行動不可 |
| hidden (かくれみ) | `dodgeCalc` | 回避↑ (実質 agi2倍)。`clearOnAct` + `clearOnHit` |
| critCharge (九字切り) | `critCalc` | 次の攻撃を確定会心。`clearOnAct` |
| atkUp/atkDown | `powerCalc` | 攻撃威力を magnitude 倍 |
| defUp/defDown | `incomingCalc` | 被ダメを magnitude 倍 |
| agiDown | `dodgeCalc` | 相手を減速 (回避/行動順) |

ターン終了処理: 各 status の `turnEnd` を回し、`turns--`、0 で除去。`clearOnAct`/`clearOnHit`/`wakeOnHit`
は該当イベント (行動/被弾) で除去・起床。付与は `restack` (refresh/ignore/stack) で重ね方を制御。

主要状態 (忍者キット + 汎用):
- **poison** (毒): onTurnEnd で magnitude (1〜3) ダメージ。`immuneIf` = 敵の `statusResist` に 'poison'。
- **stun** (麻痺): blocksAction、turns=1。
- **sleep** (眠り): blocksAction + wakeOnHit + 毎ターン起床判定 (wakeChance)。
- **hidden** (かくれみ): modifyDodge (実質 agi 2倍相当)、clearOnAct + clearOnHit。
- **critCharge** (九字切り): forceCrit、clearOnAct (使ったら消える)、turns=1。
- **atkUp/atkDown/defUp/defDown/agiDown**: modifyOutgoing/Incoming/Dodge を magnitude 倍。

---

## 4. 共通フック機構 (状態異常もパッシブも同じ)

**状態異常もパッシブも「戦闘ライフサイクルのフック点に反応する定義」**という同じ枠組みで扱う
(オーナー方針 2026-07-22: 首狩り専用の `onKillCheck` みたいな特殊メソッドは作らず、汎用の
パッシブ/フックチェックにする)。エンジンは各フック点で「**いま有効なフックを全部集めて回す**」
だけ。首狩りは専用扱いされず、汎用 `onHit` フックで「即死」を返すパッシブになる。

```ts
/** 戦闘の各タイミングで呼ばれる任意ハンドラ群。状態異常もパッシブもこれを実装する。 */
export interface CombatHook {
  beforeAct?(c: Combatant, ctx: HookCtx): { block?: boolean } | void;      // 眠り/麻痺: 行動不可
  dodgeCalc?(dodge: number, c: Combatant, ctx: HookCtx): number;           // かくれみ: 回避↑
  powerCalc?(power: number, c: Combatant, ctx: HookCtx): number;           // atkUp/Down
  critCalc?(willCrit: boolean, c: Combatant, ctx: HookCtx): boolean;       // 九字切り: 確定会心
  onHit?(atk: Combatant, def: Combatant, ctx: HookCtx): { instakill?: boolean } | void; // 首狩り: 即死
  incomingCalc?(power: number, c: Combatant, ctx: HookCtx): number;        // defUp/Down
  turnEnd?(c: Combatant, ctx: HookCtx): void;                              // poison: ダメージ
}

// 状態異常 = 一時的フック (turns で消える) + メタ
export interface StatusDef extends CombatHook {
  id: StatusId; name: string;
  restack?: 'refresh' | 'ignore' | 'stack';
  immuneIf?(c: Combatant): boolean;   // 毒無効・睡眠耐性
  clearOnAct?: boolean; clearOnHit?: boolean; wakeOnHit?: boolean;
}
// パッシブ = ジョブ innate な常時フック (turns なし)
export interface PassiveDef extends CombatHook { id: string; name: string }

export const STATUS_REGISTRY: Record<StatusId, StatusDef> = { /* poison/sleep/hidden/critCharge/… */ };
export const PASSIVES: Record<string, PassiveDef> = {
  kubikari: { id: 'kubikari', name: '首狩り',
    onHit: (atk, def, ctx) => (isWeaker(def, atk) && ctx.rng() < killChance(atk.luk) ? { instakill: true } : undefined) },
};
```

**エンジン側の汎用ディスパッチ (分岐なし)**: 各フック点で、その Combatant の
「有効な状態異常 (statuses → STATUS_REGISTRY) + パッシブ (job innate → PASSIVES)」を集めて回す。

```ts
function hooksOf(c: Combatant): CombatHook[] {
  return [...c.statuses.map(s => STATUS_REGISTRY[s.id]), ...c.passives.map(p => PASSIVES[p])];
}
// 例: 会心判定 = hooksOf(attacker).reduce((crit,h)=> h.critCalc?.(crit,attacker,ctx) ?? crit, baseCrit)
// 例: 命中時 = hooksOf(attacker).some(h => h.onHit?.(attacker,defender,ctx)?.instakill) → defender.hp=0
```

→ 状態異常もパッシブも「フックを実装したデータ」。エンジンはフック点で回すだけで、
`if (status==='poison')` も `onKillCheck` みたいな専用メソッドも要らない。新しい状態/パッシブは
`CombatHook` を実装して登録するだけで増える。**首狩りの即死判定 (isWeaker / killChance) と
メタル除外 (resistAll)** は onHit ハンドラ内のデータ/関数で完結。

---

## 5. モンスター能力プラグイン

現行 `ability: 'charger'|'healer'|'fleer'` の `if` 分岐を `MONSTER_ABILITIES` レジストリへ。

```ts
export interface AbilityDef {
  id: string;
  decideAction?(state: BattleState, rng: () => number): MonsterAction | null; // null=通常判定へ
  // 将来: onTurnStart / onDamaged など
}
export const MONSTER_ABILITIES: Record<string, AbilityDef> = {
  charger: { id: 'charger', decideAction: /* ため予告→解放 */ },
  healer:  { id: 'healer',  decideAction: /* 低HPで回復 */ },
  fleer:   { id: 'fleer',   decideAction: /* 毎ターン逃走判定 */ },
  caster:  { id: 'caster',  decideAction: /* MPあるうちは def無視の属性魔撃 */ }, // #456
};
```
`monsterCommand` は `MONSTER_ABILITIES[def.ability]?.decideAction(...)` を呼ぶだけ (switch なし)。

**caster (#456)**: `MonsterDef.spell { name, element?, min, max, intScale? }` を持つ敵が MP を消費して
`doMagic` で def 無視の属性魔撃を撃つ。**対物理型 (覇王/不動) の弱点=魔法を成立させる要**の content で、
魔法致死は `onLethal` を通らないため覇王将軍も魔法では死ぬ (§14.6)。聖騎士の清き心 (魔法反射) は**後続
(#483) で `onIncomingMagic` を配線すればこの経路に乗る**前提が整う (本 PR 時点では清き心は未実装)。初期投入は
night-raven (tier3・かまいたち/wind) の 1 体・控えめな数値 (def 無視は def タンクに刺さるため)。full 配置・
数値・int 対 int 軽減 (低 def の支援職に過剰に刺さらない配分) は #479 sim 待ち。

---

## 6. とくぎ習得モデル

- **Lv1 にとくぎを持たせない** (基本とくぎ=署名の概念を廃止)。序盤の敵は十分弱いので素の「たたかう」で
  足り、**最速 Lv3 で初習得**する演出で有難みを出す (オーナー方針)。
- ジョブのとくぎは `JOB_SKILLS` にデータで持つ:
  ```ts
  const JOB_SKILLS: Record<Archetype, ReadonlyArray<{ skillId: string; learnAt: number }>> = {
    ninja: [ { skillId:'dokute', learnAt:3 }, { skillId:'kakuremi', learnAt:5 }, … ],
    …
  };
  export function skillsForJob(a: Archetype, jobLevel: number): SkillDef[] =>
    JOB_SKILLS[a].filter(e => jobLevel >= e.learnAt).map(e => SKILLS[e.skillId]);
  ```
- **弱ジョブほどとくぎ多い**を learnAt の数・間隔で表現。
- **習得ペースの調整 (要対応)**: 現状 jobLv3 = 累積 108 XP = tier1 で約21戦。「Lv3 まで約10戦」に
  するには **jobLv3 閾値を 108→約55 に下げる** (または序盤の敵の jobXp を増やす)。パイロットで確定。
- **UI**: Lv1 でとくぎ 0 個の職は「とくぎ」ボタンを非表示/無効。習得済みが 1 個ならそれを、複数なら
  サブメニュー (既存 #436 UI を流用)。「〜を おぼえた!」のレベルアップ演出を足す。

---

## 7. 忍者キット (確定版・パイロット)

効果量・命中率は**仮 (要 sim 調整)**。属性・状態は本ドキュメントの枠組みで表現。

| Lv | とくぎ | MP | 効果 (SkillEffect) |
|---|---|---|---|
| 3 | 毒手 | 3 | `damage(agi, 0.7, inflict:{poison, chance 0.8, turns 3, mag [1,3]})` — 命中で毒 (毒無効の敵あり) |
| 5 | かくれみ | 4 | `status(self, hidden)` — 回避↑ (agi 実質2倍)。攻撃 or 被弾で解除。**安全に回復する布石** |
| 8 | 火遁の術 | 6 | `fixedDamage(10-20, ignoreDef, element:fire)` — 防御無視。火耐性/メタル(全耐性)には無効 |
| 12 | 急所狙い | 8 | `damage(agi, 1.5, inflict:{stun, chance 1.0, turns 1})` — 1.5倍 + 命中で1ターン麻痺 |
| 15 | 九字切り | 4 | `status(self, critCharge, turns 1)` — 次の攻撃が確定会心 (守備無視) |
| 20 | 影分身 | 10 | `damage(agi, ~0.9, hits:2)` — 2回連続攻撃。会心チャンスも火力も2倍級 (終盤技) |
| 30 | 首狩り | — | パッシブ `onKillCheck` — 自分より弱い敵を 20% (luk補正) で一撃 |

**意図した相互作用 (オーナー確認済み)**:
- **九字切り → 通常攻撃 = メタル確定討伐** (確定会心=守備無視)。忍者=メタルの天敵。
- **九字切り → 影分身 = 確定会心×2発**の大ダメージコンボ (Lv20+・MP14 の玄人技)。
- かくれみは攻撃力を上げない (上げると MP を上げざるを得ず「序盤に気軽に」から外れる)。回避専用。

---

## 8. 実装フェーズ

1. **プラグイン基盤 + 属性 + 状態エンジン** (packages/core): Element/elementMultiplier、SkillDef/
   SkillEffect/EFFECT_HANDLERS、StatusDef/STATUS_REGISTRY、Combatant.statuses、doAttack へフック挿入。
2. **忍者パイロット**: SKILLS に忍者7技、JOB_SKILLS.ninja、首狩りパッシブ。sim で威力/MP/習得Lvを調整。
3. **UI**: Lv1 とくぎ0対応、習得演出、属性/状態のイベント表示 (「毒をくらった!」等)。edge は skillId
   検証を skillsForJob ベースに (既存 #436 の skillIndex → skillId へ)。
4. **モンスター能力プラグイン化** + 敵に element/statusResist を付与。
5. **習得ペース調整** (jobLv3 ≈ 10戦)。
6. 忍者で手触り確定後、**他ジョブは JOB_SKILLS + SKILLS にデータを足すだけ**で展開。

## 9. 現行 #436 からの移行

- `SkillKind` enum + `playerSkillAction` の `switch` → `SKILLS` レジストリ + `EFFECT_HANDLERS`。
- 既存 5 kind (smash/parry/flurry/spell/gamble) と heal を SkillDef 化 (効果プリミティブで表現)。
  - smash = `damage(atk, 1.7, hitBonus -0.1)` / spell = `damage(int, 1.0, defFactor 0.5)` (必中) /
    flurry = `damage(agi, 0.65, hits 2)` / gamble = 可変 power (専用 effect か power 関数) /
    parry = `status(self, parrying)` 相当 / heal = `heal(0.35)`。
- `resolveTurn` の skillIndex は skillId 選択に置き換え (UI/edge も)。`BattleState.playerSkills` は
  `skillsForJob` の SkillDef 列。
- 移行中の後方互換は #436 と同様、旧 sealed state を署名フォールバックで吸収。

---

## 10. 追加部品 (遊び人/守護者の設計で判明)

3ジョブ検証で足りないと分かった部品。**エンジンのディスパッチは不変**、以下を「足すだけ」:

**効果プリミティブ (SkillEffect) 追加:**
- `gain{ item, chance }` — 在庫/素材を得る (ぶんどり)
- `restoreMp(ratio)` — MP 回復 (サボる)
- `random([{ weight, effects }])` — 重み付きランダム発動・luk 補正 (ルーレット/傑作)
- `recoil{ ratio }` — 反動で自分にダメージ (いちかばちか)
- `cleanse{ target, which:'debuff'|'all' }` — 状態異常を解除 (お祓い)
- `resolve{ outcome, grantXp, grantDrops, dropBonus }` — 戦闘を特殊決着 (首狩り=win / せっとく=reconciled)
- `damage.stat` に **'def'** を追加 (盾殴り)、`damage` に「累積被ダメ基準」オプション (フルカウンター)

**共通フック (CombatHook) 追加:**
- `onDamaged(self, attacker, damage, ctx)` — 物理被弾後のリアクティブ反応 (とげの盾=攻撃者へ反射)。実装済み
  (#456)。**damage 引数 = 食らった最終ダメージ**で反射割合の計算に使う。**フルカウンター (累積被ダメ返し) は
  別途 `Combatant.damageTaken` の積算が要る** (このフック単体では書けない = 後続バッチ)。
- `onLethal(self, atk, damage, ctx) → { survive? }` — 物理致死を耐える。実装済み (#456)。onDamaged と同じ
  `(self, attacker, damage, ctx)` 並びで、反射など攻撃者への副作用はハンドラ内で `atk` を直接操作する。
  **物理経路 (doAttack) のみで発火**し魔法致死 (doMagic) には効かない = 「物理耐性・魔法貫通」を経路分離で
  分岐なしに表現。**1 戦闘 1 回のみ**発動する切り札 (`Combatant.lethalGuardUsed` フラグ。オーナー判断
  2026-07-22: 敵が物理のみの現状で毎回発動だと対モンスター完全不死になるため)。覇王=1回耐えて同ダメ反射、
  不動=1回確定で耐える (旧 50% 運要素は壁役の capstone に合わないため確定 1 回に変更)。
- `onIncomingMagic(self, atk, damage, ctx) → { reflect? }` — 魔法被弾の直前 (self=被弾側/atk=術者)。実装済み
  (#456)。reflect=true で被弾 0 に無効化 (術者への反射などはハンドラ内で atk を操作。onLethal と同じ idiom)。
  **魔法経路 (doMagic) のみで発火**。清き心 (聖騎士): 低確率 (25%・暫定) で敵魔法を術者へ跳ね返す。見切りの
  必中回避 (魔法をミス化) も将来このフックに乗せられる (§14.6)。
- `targetBonus(mult, c, target, ctx) → mult` — 対象の状態に応じた与ダメ倍率補正 (c=攻撃側/target=被弾側)。
  実装済み (#456)。審美眼 (芸術家): 状態異常 (AILMENT_IDS) の敵に与ダメ **×1.3** (sim 調整前提の暫定値)。
  基準 1 に対する乗数を返し doAttack/doMagic 双方で dmg に乗算。芸術家の fixedDamage は doMagic を通るので
  実効。会心↑ (必中 fixedDamage に乗らない)・良素材↑ (非戦闘) は §12 の残部分で別途 (#483)。
- `elementBonus(mult, c, ctx) → mult` — 属性相性倍率の補正 (c=攻撃側)。実装済み (#456)。慧眼 (賢者): 弱点
  (mult>=1.5) を突いたとき **×1.25 増幅** (1.5→1.875)。1.25 の根拠 = 弱点を突く能動プレイへの報酬。大賢者
  の一撃 (×2.5) と合わせても過剰にならない範囲で、閾値 1.5/倍率 1.25 とも sim 調整余地を残す暫定値。
  doAttack/doMagic 双方の属性倍率適用点で発火。none なら素通し。**告知テキストは増幅時も共通の「弱点を突
  いた!」のまま** (賢者専用の別演出は出さず、跳ねる数値で実感させる = 情報量を増やさない方針)。

**Combatant フィールド:** `statuses: StatusInstance[]` / `passives: string[]` / `damageTaken: number`(累積)
**BattleOutcome 追加:** `reconciled`(和解 = XP なし・素材あり)。battle-reward は outcome + `resolve` の
フラグを読む (分岐でなくフラグ駆動)。

---

## 11. 全ジョブ とくぎ一覧 (初期の叩き台 — **§12 が確定版・そちらが正**)

> ⚠️ このセクションは最初の草案。オーナーの書き直しを経た **確定版は §12「確定事項」**。
> 矛盾したら §12 が優先 (多くのジョブは §12 で別物になっている)。

**Lv1 にとくぎ無し・最速 Lv3。弱ジョブほど多い。** 記法: 攻=ダメージ / 博=大博打 / 連=連撃 /
固=固定(貫通) / 回=回復 / 状=状態付与 / +命=命中時付与 / 属=属性 / 乱=ランダム / P=パッシブ。

### 攻撃特化 (強い・少なめ)
**将軍** (atk39): Lv3 号令一閃(MP4 攻atk×1.7) / Lv8 一騎当千(MP7 攻×2.2) / Lv15 鬼神斬り(MP10 攻×3.0) / Lv25 天下無双(P: 高atk時 会心率↑)
**隊長** (atk38): Lv3 突撃号令(MP4 攻atk×1.7) / Lv5 士気高揚(MP5 状atkUp自) / Lv8 統率(MP4 状atkDown敵) / Lv12 突進(MP6 攻×1.8+命stun) / Lv20 総攻撃(MP10 攻×2.6)

### 前衛・タンク
**戦士** (def41/atk25): Lv3 なぎ払い(MP4 攻atk×1.6) / Lv5 みだれ突き(MP5 攻×0.7×2) / Lv8 防御態勢(MP4 状defUp自) / Lv12 かぶとわり(MP6 攻×1.3+命defDown敵) / Lv15 ためる(MP3 状atkUp自・次撃) / Lv20 全力斬り(MP8 攻×2.5)
**守護者** (def43): §7参照 — 盾殴り(def)/大盾の護り/とげの盾(onDamaged)/仁王立ち/守護の祈り/フルカウンター(累積)/不動(P onLethal 50%)

### 素早さ・技巧
**忍者** (agi34): §7 (確定版) — 毒手/かくれみ/火遁(火)/急所狙い/九字切り/影分身/首狩り(P)
**遊び人** (agi32): ぶんどり(gain)/サボる(restoreMp)/ルーレット(乱)/いちかばちか(recoil)/曲芸乱舞(agi×0.6×3)/大道芸(乱)/せっとく(MP10 resolve和解 30%・XPなし素材)

### int キャスター (攻撃魔法を伸ばす)
**魔法使い** (int37): Lv3 解式マギア(MP4 攻int×1.0貫half) / Lv5 火炎術式(MP5 攻int×1.3属火) / Lv8 氷結術式(MP5 攻int×1.3属水+命agiDown) / Lv12 まもりくずし(MP5 状defDown敵) / Lv15 滅魔術式(MP8 攻int×2.0) / Lv20 メテオ(MP12 攻int×3.0属地)
**賢者** (int40): Lv3 天啓の一手(MP4 攻int×1.0貫half) / Lv5 眠りの理(MP5 状sleep敵) / Lv8 まもりくずし(MP5 状defDown敵) / Lv12 星辰の魔法(MP8 攻int×1.8属空) / Lv15 見切りの理(MP4 状回避Up自) / Lv20 大賢者の一撃(MP10 攻int×2.5属空) / Lv30 慧眼(P: 弱点属性で追加ダメ)
**予言者** (int43): Lv3 未来視(MP4 攻int×1.0貫half) / Lv5 弱点看破(MP4 状defDown敵) / Lv8 予知回避(MP4 状回避Up自) / Lv12 呪詛(MP5 状poison敵) / Lv15 予言の一撃(MP7 攻int×1.8属水) / Lv20 運命の刻(MP10 攻int×2.4+命stun)
**匠** (int43): Lv3 からくり仕掛け(MP4 攻int×1.0貫half) / Lv5 毒煙装置(MP4 状poison敵) / Lv8 落とし穴(MP4 攻int×1.2属地+命stun) / Lv12 鉄球投擲(MP5 固8-14貫) / Lv15 起爆術式(MP7 攻int×1.8属火) / Lv20 大発破(MP10 固15-25貫属火)

### 支援・回復 (回復はここ)
**巫女** (luk37): Lv3 神楽の癒し(MP4 回35%) / Lv5 神楽の祈り(MP4 博luk) / Lv8 お祓い(MP3 cleanse自+回少) / Lv12 眠りの神楽(MP5 状sleep敵) / Lv15 加護(MP5 状atkUp+defUp自) / Lv20 神威(MP8 攻luk×2.0) / Lv25 完全回復(MP12 回100%)
**聖騎士** (luk34/def): Lv3 聖光の癒し(MP4 回30%) / Lv5 聖光の誓い(MP4 博luk) / Lv8 聖なる守り(MP4 状defUp自) / Lv12 光の裁き(MP6 攻luk×1.5属空) / Lv15 不屈(MP5 状defUp大自) / Lv20 聖光爆発(MP9 攻luk×2.2属空+回自少)

### 歌・技巧 (弱め・とくぎ多め = 戦術で戦う)
**吟遊詩人** (luk31/agi27): Lv3 眠りの歌(MP4 状sleep敵) / Lv5 応援歌(MP4 状atkUp自) / Lv8 セレナーデ(MP4 博luk) / Lv12 不協和音(MP5 状atkDown+defDown敵) / Lv15 癒しの旋律(MP5 回30%) / Lv20 英雄譚(MP8 状atkUp+defUp大自)
**詩人** (luk34/def32): Lv3 心晴の韻(MP4 博luk) / Lv5 静心(MP4 状defUp自) / Lv8 昂ぶりの詩(MP4 状atkUp自) / Lv12 詠唱(MP5 攻luk×1.5) / Lv15 無心(MP4 状回避Up+会心Up自) / Lv20 絶唱(MP8 攻luk×2.2+recoil)
**冒険者** (luk34/agi25): Lv3 未踏の一歩(MP4 博luk) / Lv5 足がらめ(MP4 状agiDown敵) / Lv8 みやぶる(MP3 状defDown敵) / Lv12 石つぶて(MP4 固6-12属地) / Lv15 サバイバル(MP4 回25%+MP回) / Lv20 一撃離脱(MP7 攻agi×2.0)
**芸術家** (luk26/def26): Lv3 色彩の閃き(MP4 博luk) / Lv5 幻惑の色(MP4 状atkDown敵) / Lv8 極彩色(MP5 攻luk×1.4+命ランダムデバフ) / Lv12 だまし絵(MP4 状回避Up自) / Lv15 芸術は爆発(MP7 攻luk×2.0属火) / Lv20 傑作(MP9 乱[大ダメ/全デバフ/大回復])

### 敵の属性 (案・要確定)
スライム=水 / キノコ=地 / コウモリ=風 / ゴーレム=地 / 鬼火=火 / 大蛇=水 / ガラス=風 / 鬼=火 /
竜=空 / メタル=全耐性 (属性無効・状態無効=会心のみ)。

---

## 12. 確定事項 (2026-07-22 設計セッション)

### 戦闘モデル: パーティ vs 敵グループ (オーナー決定)
1体 vs 1体から、**味方パーティ (`allies[]`) vs 敵グループ (`enemies[]`)** に拡張する。ソロは
「味方1人」の特殊ケース。とくぎのターゲットは `self / oneEnemy / allEnemies / oneAlly / allAllies`。
AoE は対象をループするだけ (プラグインで吸収)。**とくぎは全ジョブ マルチ前提で設計する。**
※ 実装は大改装 (world 戦闘・edge・UI 全て複数対応)。**実装順 = 全ジョブ設計 → マルチ戦闘基盤 → 実装**。

### ダメージ 3 系統
- **物理**: `(atk×係数 − 敵def×係数) × roll`。回避あり・最低1。(smash/連撃/大博打/盾殴り等)
- **魔法(int型)**: `(自int×威力 − 敵int×係数) × 属性倍率 × roll`。**必中・敵def無視**。int低い敵ほど通る。
  (魔法使い/賢者/予言者/匠)
- **魔法(luk型)**: `固定範囲(min〜max) × luk連動 × 属性倍率`。**必中・敵def無視**。(巫女=霊的な力を運で振る)
- 共通: **メタル(resistAllMagic)は全魔法無効 → 会心の物理のみ**。`flying` の敵は地属性技(じわれ等)無効。

### 状態異常・命中
- 成功率 = **caster側(luk 等) − 敵int差** で算出 (眠り/混乱)。耐性 (`statusResist`) 持ち・メタルは無効。
- **混乱 (confusion)**: `overrideAction` フックで対象の行動を乱択に差し替え (何もしない/敵味方ランダム攻撃/
  プレイヤーを回復)。被弾で高確率解除。
- 既存 + 新 status: poison/sleep/stun/hidden/critCharge/atkUp/atkDown/defUp/defDown/agiDown/intDown/**confusion**。

### デバフは 2 系統 (パーティ役割分担のため両方)
- **defDown (メルティ等)**: 物理仲間が得する。 / **intDown (イディオット等)**: 魔法勢が得する (魔法耐性↓)。

### バフ上限ルール (青天井防止・オーナー決定)
**同じステータスの倍率バフは合算するが、ステータスごとに上限 (例 atk ×2 まで)。** 複数の atk↑ を重ねても
頭打ち。各技は副次効果 (agi↑ / 敵デバフ等) で差別化される。フラット加算バフ (光の加護 +N) は別枠。
吟遊詩人の全能力2倍もこの上限にちょうど収まる。パッシブ常時バフ (名将 +10%) も上限内でカウント。数値は sim 調整。

### ジョブ特性 (非戦闘/情報)
- **フィールド危険度が見える**: 賢者・予言者・忍者・遊び人 (他ジョブは見えない = パーティ価値。現状の
  全ジョブ可視から変更)。
- **敵 HP/MP 見抜き** (既存): 賢者・予言者・巫女・魔法使い・忍者。

### 追加プリミティブ/フック (これまでの設計で判明・§10 に追記済み + 以下)
- effect: `gain / restoreMp / random / recoil / cleanse / resolve` + `damage.stat:'def'` + luk連動固定範囲 + `target`
- hook: `onDamaged / onLethal / overrideAction`
- Combatant: `statuses[] / passives[] / damageTaken` + パーティ化で `side / allies / enemies`

### 敵の trait (データ)
`element` (火水地風空) / `flying` (地技無効) / `resistAllMagic` (メタル) / `statusResist[]` (毒無効・眠り耐性等)。

### 確定キット (改訂版)
**魔法使い** (火水地特化の大砲・脆い): 火炎術式3/解式マギア5/石射6/氷結術式8(素早さ↓)/メルティ12(敵def↓)/
イディオット?(敵int↓)/爆炎術式15/じわれ18(飛行無効)/永久凍土20(3T行動不可)/メテオ25/魔力障壁30(P: 常時10-20%軽減)。全て必中・int型。
**賢者** (最高int・全5属性・支援): 火炎3/解式5/石射6/氷結8/疾風10/天啓12(空)/イディオット14(敵int↓)/賢者の癒し16/
知恵の加護18(自int↑)/星辰の大魔法22(空 int×2.5)/慧眼30(P: 弱点属性で追加ダメ) + 特性:危険度可視。
**巫女** (luk型霊的支援・物理攻撃なし・全体技): 癒しの鈴3(回復10-20 luk)/風の舞5(風5-15 luk)/眠りの鈴8(眠り int差luk)/
魅惑の神楽10(敵全体 混乱 int差luk)/加護12(味方 atk↑def↑)/破魔の舞15(敵全体 風5-10×3)/癒し神楽18(味方全体 回復30-50)/
神楽乱舞20(敵全体 風5-12×4)/払串22(全員 状態異常回復)/神託の光25(味方全体 満タン+状態回復)/巫女の直感30(P: ドロップ↑・MP消費30%off)。
**吟遊詩人** (agi/luk型・空属性・歌でバフ/デバフ/眠り・回復なし): プレリュード3(味方全体 atk+agi↑3T)/デスペラード5(敵全体 空3-10 luck)/
ララバイ8(敵全体 眠り int差luk)/スタッカート10(敵単体 空 最大6連 luck)/スケルツォ12(味方全体 agi**2倍**3T)/ディスコード14(敵全体 atk↓def↓3T+低確率混乱)/
ラプソディ15(味方全体 atk・def 1.5倍3T)/カプリッチョ20(random[混乱/睡眠/MP全吸収(中ボス無効)/魔神の足 空30-40/自分睡眠/敵逃走(素材残す)/味方HP50%回復]・luck補正)/
アプローズ25(敵全体 空 luck)/英雄叙事詩28(味方全体 全能力2倍2T・MP30)/名演30(P: 歌の効果ターン+1)。
新部品: `drainMp` / 可変ヒット数(luck連動) / 全能力一括バフ。
**戦士** (純物理ブルーザー・無属性・パーティ守り無し): なぎ払い3(敵全体 atk×0.8)/みだれ突き5(敵単体 atk×0.7×2)/かぶとわり10(敵単体 atk×1.3+命中でdef↓3T)/
ためる15(自atk↑次撃)/全力斬り18(敵単体 atk×2・MP10)/一騎当千22(敵全体 atk×1.5)/剣豪30(P: 会心率↑)。
※ **かばう/挑発 (パーティ守り) は一旦保留** — 付けるなら かばう=聖騎士/守護者、挑発=守護者。マルチ戦闘基盤ができてから。
**聖騎士** (前衛・聖なる支援・atk/int両刀・holy=無属性): 聖光の癒し3(味方1体 回復15-20)/光の加護5(自 atk+5/def+10/agi+5 **フラット**)/
光の剣8(敵単体 無属性魔法15-20 int差luck・必中)/聖光斬12(atk物理+int補正・**避けられる**)/聖なる守り15(自def×1.5 3T)/浄化18(味方1体 状態異常回復)/
裁きの光20(敵全体 無属性魔撃30-50 int差luck・低確率で行動不可・必中)/女神降臨25(味方全体 50%回復+def+20%3T+デバフ解除)/清き心30(P: 低確率で魔法反射)。
新部品: フラット加算バフ / 無属性魔法(属性の輪外・int型必中) / atk主+int補正の物理 / 魔法反射フック。holy系(聖騎士/巫女の聖)は属性外。
**将軍** (最強atk39・最脆def10・物理一本・対キャスター): 一閃3(単体 atk×1.5)/なぎ倒し6(敵全体 atk×0.8+中確率で転倒)/足払い8(敵単体 atk×1.2+高確率で転倒)/
勝鬨12(味方全体 atk↑3T+低確率で敵怯み agi↓)/見切り15(自 agi+10+次の敵魔法を100%回避=必中無効)/鬼神斬り20(敵単体 atk×2.5+敵の詠唱魔法をかき消す)/
覇王30(P: 物理致死を**1戦闘1回**HP1で耐え+同ダメ反射。2回目以降と魔法致死は普通に死ぬ。once化はオーナー判断 2026-07-22 = 敵魔法が無い現状で毎回発動だと完全不死のため)。int28は**魔法耐性(int対int式)として活用=魔法が通らない対キャスター**。見切り/かき消しは100%固定(int連動しない)。
新部品・全体ルール: **転倒(status: 次行動不可 + 被ダメ×1.2、誰の攻撃でも)** / 必中回避(次の魔法をミス化) / 魔法かき消し(詠唱割り込みキャンセル) / 物理限定onLethal+反射 / 怯み(flinch)。
**隊長** (タフな前衛指揮官 def23・鼓舞): 突撃号令3(単体atk×1.5+味方atk少↑)/鼓舞5(味方atk↑3T)/防陣8(味方def↑3T)/突進12(単体atk×1.5+中確率転倒)/
檄15(味方atk↑agi↑3T)/捨て身攻撃18(敵全体atk×1.6+会心↑・自def↓1T=リスク)/攻陣25(敵を囲い 味方atk中↑+敵agi中↓3T)/名将30(P: 常時atk/def+10%)。
バフ上限(×2)で無双を防ぐ。将軍(ガラス大砲)との対=打たれ強い鼓舞役。
**予言者** (int43最高・回復なし・破滅のオラクル・全体&遅延): 未来スイッチ3(回避不能物理1-20 luck)/雷の予言4(単体10-20 int差luck・必中・無属性)/未来予知5(次の攻撃100%回避)/
毒の予言7(単体 毒)/地震予知10(飛行以外の全体20-30 地・int連動)/嵐の予知12(全体20-30 風・飛行に1.5倍+転倒)/日照り予知15(全体20-30 火)/水難の予知18(全体20-30 水+高確率転倒)/
蠱毒の王20(単体 atk50+int補正・必中・会心あり・メタルに最低1保証)/死の宣告25(単体 毎ターンHP半分・中ボス無効・int差で確率)/アポカリプス28(全体 全5属性80-120+自己スタン)/全知30(P: 常時回避↑)。
※ **高Lv技(80-120等)は endgame の強敵前提**。モンスター側の強化(高HP敵)が別途必要。数値は圧縮せず、覚えるLvに見合う敵を用意する。魔法は範囲ダメージ。
**芸術家** (幻術師 + 創造召喚士・luk/def26・魔法は範囲): 色彩の弾3(単体3-12空)/幻惑の色5(敵命中↓攻撃↓)/だまし絵7(自回避↑)/極彩の霧8(全体4-10空+低確率混乱)/
目くらまし10(敵全体命中↓)/原色の刃12(単体10-20空+高確率攻撃↓)/芸術は爆発だ15(全体15-25火)/幻影の分身18(次の被弾1回無効=囮)/だまし討ち20(単体8-16空・混乱/眠り/転倒中に1.5倍)/
創造の絵筆20(**ランダム召喚**: うさぎ地/番犬・熊無/グリフォン風/ドラゴン火/魔神空 を luck連動で・3T味方AI・撃破で消滅)/万華鏡22(敵全体 確率混乱)/傑作25(random[全体大ダメ/全体混乱/全体命中↓/味方回復/自全能力↑]・全部当たり)/
究極芸術28(全体40-70空+混乱)/審美眼30(P: 会心↑・良素材↑・状態異常の敵に与ダメ↑)。新部品: `summon`(一時味方) / 命中率デバフ / 状態異常シナジー(だまし討ち+審美眼)。

### 魔法ダメージは範囲ベース (DQ流・オーナー決定 2026-07-22)
魔法系ダメージは **int×倍率でなく固定範囲 (min〜max)** で表す (後の調整が楽・DQ準拠。イオナズン120-160的)。
`(範囲min〜max + int連動ボーナス) × 属性倍率` ・必中・def無視。§11 で int×倍率で書いた魔法使い/賢者は
後で範囲ベースに直す。luck型魔法 (巫女/芸術家) は範囲 × luck連動。

**詩人** (水属性・自己バフ火力・言葉の拘束・タンク寄り luk34/def32): 心晴の韻3(単体4-12水)/静心5(自def↑)/昂ぶりの詩7(自atk↑)/
言の葉縛り8(単体 束縛=1-2T行動不可・被弾で解けない・luk/int差)/言葉の雨10(全体8-16水)/無心12(自回避↑+次被ダメ半減)/感傷15(自会心↑)/慟哭18(敵全体atk↓)/
感情爆発20(単体大ダメージ=**今の自己バフ数×係数**・水)/心の詩22(自全能力↑3T)/絶唱25(全体20-35水+反動)/白鳥の歌28(全体40-70水・使用後 自3T全能力2倍)/詩心30(P: 自己バフ中 与ダメ↑)。
新部品: **束縛(status: 被弾で解けない行動不可)** / 自己バフ数参照ダメージ(感情爆発)。
**匠** (からくり技師・罠と装置・int43/agi23・範囲): からくり仕掛け3(単体4-12無・必中)/煙玉5(敵全体命中↓)/毒煙装置7(単体毒)/落とし穴8(単体5-12地+高確率転倒)/
鉄球投擲10(単体8-16・**防御無視**装置)/火炎放射器12(全体10-18火)/拘束網15(単体束縛1-2T)/高圧放水18(全体10-18水+押し流し転倒)/自爆人形20(遅延: 次ターン全体大ダメージ火)/
からくり兵22(**召喚: 固定性能のからくり人形3T味方AI**)/大発破25(全体30-50火+自反動)/兵器解放28(全体50-80各属性)/発明家30(P: とくぎMP消費↓)。
召喚の対比: 匠=固定性能で安定 / 芸術家=ランダム個体。
**冒険者** (万能スカーミッシャー・生存/先制/逆転・luk34/agi25): 石つぶて3(単体4-12地)/足がらめ5(敵agi↓)/みやぶる7(敵弱点表示+def↓)/サバイバル8(自HP回復+MP少)/
疾風の一撃10(単体8-16風・**先制**)/野営12(HP/MP回復・旅の休息)/かく乱15(敵全体命中↓)/一撃離脱18(単体12-22+攻撃後 自回避↑)/秘境探索20(random[素材/回復/自バフ/敵を罠(転倒)]・全部プラス)/
武器投げ22(**MP0・所持武器から選んで投げる・威力=武器威力×強力倍率・勝てば回収/負けで喪失・AoE武器なら全体**)/背水の陣25(単体特大・**自HP低いほど威力↑**)/冒険の集大成28(全体40-70各属性)/旅の勘30(P: 回避↑+ドロップ↑+逃走成功↑)。
召喚は持たない(自分の腕で生きる)。

### 装備連携 (冒険者・オーナー決定 2026-07-22)
- **全体攻撃武器**: ムチ・ブーメランは**冒険者専用装備**で、**通常攻撃が敵全体に**なる (武器に `aoe:true` + `装備可ジョブ` 制限)。とくぎの対象はとくぎ側の指定通り。
- **武器投げ (冒険者とくぎ)**: **所持武器 (装備中に限らずインベントリから選択)** を投げる。MP0。威力=武器の威力ベース×強力倍率。
  **勝てば回収・負け/逃げ/引き分けで喪失** (雑魚武器を弾に / 強武器を賭ける駆け引き)。AoE武器を投げれば全体、通常武器は単体特大。
  → 装備×インベントリ×戦闘の連結。投擲選択UI + 「投擲中」状態 (勝利で回収)。#438 装備progression と接続。

---

## 13. 状態: 全16ジョブ設計完了 (2026-07-22)

**§12 が確定版**。§11 は初期の叩き台で、オーナーの書き直しにより **§12 の確定キットが正**
(将軍/隊長/巫女/吟遊詩人/戦士/聖騎士/予言者/芸術家/詩人/匠/冒険者は §11 と異なる。§7 の忍者、遊び人/守護者も含め全16確定)。
実装は #437 以降で: (1) プラグイン基盤+属性+状態エンジン → (2) マルチ戦闘(パーティvs敵グループ) → (3) 装備連携 →
(4) モンスター拡張(属性/飛行/耐性+endgame強敵) → (5) 全ジョブ とくぎデータ投入+sim調整 → (6) UI+edge。issue を段階分割する。

---

## 14. レビュー反映・仕様の穴埋め (第三者レビュー3本の統合 2026-07-22)

整合性/アーキ/バランスの3レビューで判明した「定義漏れ・書けないとくぎ・大穴」を埋める。**§12 と本節が正**。

### 14.1 §12 に不足していた3職 (忍者/遊び人/守護者の確定キット)
- **忍者**: §7 参照 (毒手3/かくれみ5/火遁8火/急所狙い12/九字切り15/影分身20/首狩り30P)。
- **遊び人**: ぶんどり3(gain)/サボる5(restoreMp+heal)/ルーレット8(random)/いちかばちか12(damage+recoil)/曲芸乱舞15(agi連撃)/大道芸20(random豪華)/せっとく30(resolve和解30%・XPなし素材)。
- **守護者**: 盾殴り3(def基準)/大盾の護り5(parry反撃)/とげの盾8(thorns=onDamaged)/仁王立ち12(被ダメ≒0の1T)/守護の祈り15(defUp)/フルカウンター25(累積被ダメ返し)/不動30(P onLethal・物理致死を**1戦闘1回確定で**耐える。旧50%運要素は壁役に合わず確定化・オーナー判断 2026-07-22)。

### 14.2 StatusId 完全版 (使用中の状態を全部登録)
`poison / sleep / stun / tumble(転倒) / restraint(束縛) / confusion(混乱) / flinch(怯み) / hidden / critCharge / magicEvade(必中回避) / atkUp/atkDown / defUp/defDown / agiUp/agiDown / intUp/intDown / evadeUp / accDown(命中↓) / doomMark(遅延) / weaponThrown`。定義の要点:
- **tumble(転倒)**: beforeAct=block + incomingCalc ×1.2 + restack:ignore。
- **restraint(束縛)**: beforeAct=block・**clearOnHit=false(被弾で解けない)**・clearOnAct=true。sleep/stun と別。
- **confusion(混乱)**: overrideAction で乱択[何もしない/敵味方ランダム攻撃/プレイヤー回復]・被弾で高確率解除。
- **flinch(怯み)**: 1T beforeAct=block(軽い) + agiDown。**doomMark**: turnEnd でカウントダウン→0で大ダメージ(破滅の予言)。
- **accDown**: 攻撃側の命中に modifyHit で効く(目くらまし/幻惑/煙玉/かく乱)。

### 14.3 CombatHook 完全版
既存(beforeAct/dodgeCalc/powerCalc/critCalc/onHit/incomingCalc/turnEnd)+ 追加:
- **overrideAction**(混乱)/ **modifyHit**(命中率デバフ)/ **onIncomingMagic**(見切りの必中回避・清き心の魔法反射)/
  **onEnemyCast**(鬼神斬りの魔法かき消し=マルチでは殴った1体の詠唱をキャンセル)/ **onLethal**(覇王=物理限定・1戦闘1回+反射/不動=物理限定・1戦闘1回確定)。

### 14.4 target と適用ループ
`SkillDef.target: 'self'|'oneEnemy'|'allEnemies'|'oneAlly'|'allAllies'`(効果ごとに変えたい場合は SkillEffect 側にも)。
resolveTurn が target を解決して対象集合を作り、**各対象に EFFECT_HANDLER を適用(ループはエンジン側・ハンドラは1対象分)**。ソロは allies=[player] の特殊ケース。

### 14.5 計算値 (静的プリミティブで足りない分)
effect の数値に **`scaleBy`** を許す(データ駆動を保つ限定的な参照): `'buffCount'`(感情爆発)/`'missingHpRatio'`(背水の陣)/`'weaponPower'`(武器投げ)。ハンドラが ctx から引く。任意関数は使わない(=プラグイン原則維持)。

### 14.6 resolve(決着効果)
`{ kind:'resolve', outcome:'win'|'reconciled', chance?, grantXp, grantDrops, dropBonus? }`。ハンドラが rng<chance で
outcome を state に set(以降のターン処理打ち切り)。reward 層が outcome+フラグを読む(分岐でなくフラグ駆動)。
BattleOutcome に **reconciled** 追加。首狩り=resolve win(即死)/せっとく=resolve reconciled(XPなし素材)。

### 14.7 バフ計算の順序と上限
最終 = **(基礎 + フラット加算バフ合計) × 倍率バフ**。倍率はステータスごとに合算し **×2 で頭打ち**(全能力2倍もここに収まる)。
パッシブ常時(名将+10%)も倍率側にカウント。フラット(光の加護+5)は別枠で先に加算(値が小さいので上限は緩め)。デバフも係数で対称。

### 14.8 マルチ戦闘の AI・行動順 (最大の穴・ここで方針決定)
- **行動順**: 全参加者(味方[player+召喚+NPC]/敵[複数])を毎ターン agi+乱数で並べる(現行 playerFirst ブールを撤廃)。
- **敵AI**: 各敵が `MONSTER_ABILITIES[ability].decideAction` で「自分1体分」を決める(単体前提から改修)。ターゲットは AI が味方集合から選ぶ(弱い味方/ランダム)。
- **召喚/NPC味方AI**: 一時味方(からくり兵/創造の絵筆/NPC)は autoBattleCommand の味方版で自動行動。
- **ターゲット上書き**: 挑発/かばう(将来)で選択を上書き。
- **BattleState/edge**: `allies[] / enemies[]` に再構築。旧 sealed state は #436 同様フォールバック(単体戦闘として解決)。edge の skillId 検証も味方ごとに。

### 14.9 次ステップ (この仕様のスコープ外・別 issue)
- **endgame の強敵 = tier を増やす**(オーナー: 「tier がまだ少なすぎる。モンスター調整は次のステップ」)。高Lv技(80-120)に
  見合う上位 tier/ボス(高HP・強攻撃・属性/耐性)を**別 workstream**で用意。数値は圧縮しない。
- **武器投げ = そのまま維持**(オーナー決定)。3層連結(装備/インベントリ/報酬)を受け入れ、バランスは sim。
- **balance watch(sim/実装で監視・数値でなく機構)**: 支援職の全体バフ過密 vs 回復2職 / 死の宣告(ザコ即殺)/ 覇王・不動(対物理ほぼ不死)/
  吟遊・芸術家の火力 / 属性の駆け引きが飾りにならない導線(敵属性を見せる)。
