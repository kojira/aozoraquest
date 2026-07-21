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
};
```
`monsterCommand` は `MONSTER_ABILITIES[def.ability]?.decideAction(...)` を呼ぶだけ (switch なし)。

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
- `onDamaged(self, attacker, ctx)` — 被弾時のリアクティブ反応 (とげの盾/カウンター/見切り反撃を一般化)
- `onLethal(self, incoming, ctx) → { survive? }` — 致死を耐える (不動)

**Combatant フィールド:** `statuses: StatusInstance[]` / `passives: string[]` / `damageTaken: number`(累積)
**BattleOutcome 追加:** `reconciled`(和解 = XP なし・素材あり)。battle-reward は outcome + `resolve` の
フラグを読む (分岐でなくフラグ駆動)。

---

## 11. 全ジョブ とくぎ一覧 (叩き台・数値は要 sim 調整)

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
