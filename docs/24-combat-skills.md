# 24. 複数とくぎ + 状態異常 (エピック #434: #436 / #437)

戦闘刷新エピック #434 の後半。減算式ダメージ (#435, docs/18) の上に「**とくぎで戦略を
楽しむ**」層を載せる。オーナーのビジョン (2026-07-20):

> こうげきが低いジョブはとくぎと装備で補正する方向がよい。序盤はこうげきが弱いジョブでも
> こなせる程のモンスターの弱さにして、装備や回復アイテムを揃えていくとこうげきよりも有利に
> なるとよい。**とくぎは複数選択ができるようになるべき。弱いジョブ程とくぎが増えて戦略を
> 楽しめる。相手を眠らせたり、デバフしたり、自分を強化したり**など。

減算式は「atk が敵の防御項を超えるまでダメージ 0」という性質を持つ (minDamage=0。docs/19 §6.4.5)。
低攻撃ジョブの火力の谷を、**通常攻撃の代わりに使うとくぎ**(状態異常・バフ・デバフ・
ステータス非依存の割合/固定ダメージ等)で埋めるのが本エピックの狙い。

---

## 現状 (リファクタ前のアンカー)

- **1 ジョブ = 1 とくぎ**。`skillForJob(archetype)` (battle.ts:191) が支配ステータスから
  1 種 (`smash/parry/flurry/spell/gamble`) を導出し、`BattleState.playerSkill` (battle.ts:713)
  に固定。`playerSkillAction` (battle.ts:919) が kind で分岐。
- **MP コストは一律 4** (`skillMpCost`, battle.ts:96)。per-skill 差なし。
- `Command = 'attack'|'guard'|'skill'|'herb'|'tonic'|'flee'` (battle.ts:692) はフラット文字列。
  **どのとくぎか**を指定する payload は無い。`resolveTurn(prev, command, turnSeed?)` は
  `cmd==='skill'` で単一 `playerSkill` を撃つ (battle.ts:1052)。
- 状態フラグは `guarding` / `parrying` / `charging` (敵) / `focus` のみ (battle.ts:261-269)。
  **眠り・バフ・デバフ・毒 (継続ダメージ) のフィールドは未実装**。
- UI は `world-battle-controls.tsx:70` で `playerSkill.name` の単一ボタン。どうぐは
  サブメニュー (トグル) 済みなので、とくぎのサブメニューはこれを踏襲できる。
- サーバー権威: `battle-resolver.ts` は `startBattle` 内で `skillForJob` を呼ぶだけ
  (sealed.state.playerSkill を保存)。`handleTurn` は毎ターン再導出せず sealed state を使う。
  **どのとくぎかをプレイヤーが選ぶなら `handleTurn` に skill_id を通し、archetype で妥当性検証**が要る。

---

## 設計

### A. とくぎをデータ化する (`SKILLS` テーブル)

kind ベタ書き分岐 (`playerSkillAction` の switch) を、**とくぎ定義テーブル**に置き換える:

```ts
type SkillCategory = 'attack' | 'buff' | 'debuff' | 'ailment' | 'heal';
interface SkillDef {
  id: string;              // 'smash' | 'lull' | 'guard-break' | ...
  name: string;            // 表示名 (ジョブ別名は JOB_SKILL_NAMES を継承 or 個別)
  category: SkillCategory;
  mpCost: number;          // per-skill (一律 4 を廃止)
  // 攻撃系: 火力パラメータ
  power?: number; stat?: 'atk'|'agi'|'int'|'luk'; defFactor?: number; hits?: number;
  // 状態系: 付与する効果と成功率
  effect?: { kind: EffectKind; magnitude?: number; turns?: number; chance?: number; target: 'self'|'enemy' };
}
```

既存 5 kind は SkillDef に移植 (smash=attack power1.7 / spell=attack int defFactor0.5 / flurry=attack agi hits2 / gamble=attack luk power可変 / parry=特殊: 被弾半減+反撃)。

### B. ジョブ別とくぎセット — レベルアップで習得 (弱ジョブほど多い) 【オーナー決定 2026-07-20】

とくぎは**固定数ではなくレベルアップで増える**。各ジョブに「習得レベル付きのとくぎリスト」を
持たせ、`skillsForJob(archetype, jobLevel): SkillDef[]` が**その時点で習得済みのとくぎ**を返す。

```ts
interface JobSkillEntry { skillId: string; learnAt: number; }  // learnAt = 習得 jobLevel
const JOB_SKILLS: Record<Archetype, JobSkillEntry[]> = { ... };
export function skillsForJob(a: Archetype, jobLevel: number): SkillDef[] =>
  JOB_SKILLS[a].filter(e => jobLevel >= e.learnAt).map(e => SKILLS[e.skillId]);
```

- **1 個目 (learnAt:1)** は現状の支配ステータス由来スキル → 後方互換 (Lv1 で `skillsForJob()[0]`
  = 旧 `skillForJob()`)。
- **弱火力ジョブほどリストが長く・習得が早い** (オーナー: 「弱いジョブ程とくぎが増えて戦略を
  楽しめる」)。目安として最終的なとくぎ数を素の atk に反比例させる:
  - shogun(atk39)/captain(atk38) → 最終 1〜2 (脳筋は素殴りで強い、習得も遅め)
  - warrior(25)/performer(25) → 2〜3
  - guardian(24)/artist(15)/explorer(14)/fighter(12) → 3
  - mage(7)/bard(7)/seer(8)/miko(8)/paladin(9) → 4〜5 (弱火力を戦術で補う、習得も早い)
- 追加分は「バフ / デバフ / 眠り / 毒 / 回復」から世界観に合うものを配る (例: miko=味方バフ+
  眠り+回復、mage=デバフ+int アタック、bard=眠り+全体デバフ寄り)。習得レベルの割り付けで
  「新しいとくぎを覚える楽しみ」を progression に組み込む。
- 具体的な配り方 (どのジョブが何を何レベルで) は #436/#437 実装時に sim で調整。

### C. 戦闘中の複数選択 UI

「とくぎ」ボタン → **とくぎサブメニュー** (どうぐメニューと同じトグル方式) → 各とくぎを
リスト表示 (名前 + MP コスト + 一言効果)。MP 不足 / 既に付与済みの状態技は disabled。
`onCommand('skill', skillId)` で撃つ。DQ の「じゅもん/とくぎ」リスト相当。

### D. Command に skill_id を載せる

- `Command` を `{ kind: 'skill', skillId: string }` を許すよう拡張 (または `resolveTurn` に
  第 2 引数 `skillId?`)。既存のフラット文字列コマンドは互換維持。
- `resolveTurn` は skillId から SkillDef を引き、`applySkill(def, ...)` で実行。
- **サーバー権威**: `handleTurn` が skill_id を受け取り、`skillsForJob(sealed.archetype)` に
  その id が含まれるか検証 (詐称防止)。`VALID_COMMANDS` (battle-resolver.ts:31) を拡張。

### E. 状態異常モデル (#437)

`Combatant` に継続状態を追加:

```ts
sleep: number;                         // 残りターン (0=なし)。行動時に自然回復判定
buffs:  Partial<Record<Stat, {mult:number; turns:number}>>;  // 自己強化 (atk/def/agi…)
debuffs: Partial<Record<Stat, {mult:number; turns:number}>>; // 相手弱体
poison?: { damage: number; turns: number };                  // 継続ダメージ (将来)
```

- `doAttack` (battle.ts:826〜) で **buff/debuff をステータスに乗算**して評価。
- **眠り**: 行動選択前に `sleep>0` なら行動スキップ + 毎ターン一定確率で起床。被弾で起床
  (DQ 流)。強敵ほど耐性 (成功率を敵の何かで割る) を検討。
- `resolveTurn` の cleanup (battle.ts:1106) で各状態の turns をデクリメント。
- `TurnEvent` に `effect?: EffectKind` を足して UI 演出 (「〜は ねむってしまった!」等)。
- 敵にも状態異常が乗る (プレイヤーが眠らせ・デバフする) = 低火力ジョブの主戦術。
  敵→プレイヤーの状態異常は #437 のスコープで慎重に (理不尽回避、まずはプレイヤー有利側から)。

### F. 後方互換 & 移行

- `playerSkill` (単数) → `playerSkills: SkillDef[]` + 現在選択の一時状態は UI 側。
  sealed state には `playerSkills` を保存 (archetype から再導出可能なので id 列だけでも可)。
- `autoBattleCommand` (battle.ts:1149) を複数とくぎ対応に (眠り→デバフ→攻撃の優先度付け)。
  模擬戦シミュレータ (debug-battle-sim / sim-*.ts) が新戦術で回るようにする。
- 既存テスト (skillForJob 全16・skill 完走・parry 回帰・spell 優位) は
  `skillsForJob()[0]` が旧 `skillForJob()` と一致する形で緑を維持。

---

## 実装ステップ (issue マッピング)

**#436 複数とくぎ (框組み)** — 状態異常の中身は #437。ここは「複数持てる・選べる・撃てる」。
1. `SKILLS` テーブル + `SkillDef` 型、既存 5 kind を移植 (挙動不変)。
2. `JOB_SKILLS` (習得レベル付き) + `skillsForJob(archetype, jobLevel)` + `BattleState.playerSkills`。
   Lv1 で [0] が旧 `skillForJob()` と一致 (後方互換)。**レベルアップで新とくぎ習得**の通知線も
   (既存のレベルアップ演出に「〜を おぼえた!」を足す)。
3. `resolveTurn` に skillId、`applySkill` ディスパッチ。既存単一挙動を [0] で維持。
4. UI: とくぎサブメニュー (どうぐメニュー踏襲、毎ターン選択)。各とくぎに MP コスト表示・
   MP 不足で disabled。
5. サーバー権威: `handleTurn` skill_id 検証 (`skillsForJob(archetype, jobLevel)` に含まれるか) +
   `VALID_COMMANDS` 拡張。
6. `autoBattleCommand` 複数対応 + sim 更新。テスト緑維持。

   ※ #436 単体では既存の**攻撃系とくぎ + レベルで増える枠組み**が入る (状態異常の中身は #437)。
   テスト可能な最小形として、各ジョブに攻撃系のバリエーション or 既存 1 種のみでも framework は成立。

**#437 状態異常 (眠り/デバフ/バフ)** — #436 の framework 上に効果種を足す。
1. `Combatant` に sleep/buffs/debuffs。`doAttack` で乗算・眠りで行動スキップ。
2. cleanup で turns デクリメント + 起床判定。`TurnEvent.effect` で演出。
3. buff/debuff/ailment カテゴリのとくぎを各ジョブに配布 (§B の具体化)。
4. sim で「弱ジョブが状態異常で強ジョブに追いつく」ことを実測して数値調整。
5. 眠り耐性・命中率・敵側状態異常の理不尽回避を tier 別に検証。

**#438 装備・回復 progression** (既存 issue) と合わせて「装備が揃うと攻撃より有利」を完成。

---

## 決定事項

### 確定 (オーナー決定 2026-07-20)

1. **とくぎ選択の粒度**: **毎ターンとくぎメニューから選ぶ (DQ 流)**。事前ロードアウトは採らない。
   → §C / §D の framework で確定。
2. **とくぎ数**: **レベルアップで増える** (固定数ではない)。習得レベル付きリスト
   (`JOB_SKILLS`) + `skillsForJob(archetype, jobLevel)`。弱ジョブほど多く・早く習得。→ §B。
3. **効果種のスコープ**: **幅広く** — 眠り / 攻撃バフ・デバフ / **防御デバフ** / **毒 (継続
   ダメージ)** を含める。→ §E を広めに実装。

### 実装時に詰める (sim で調整)

4. **習得レベルの具体割り付け**: どのジョブが何を何レベルで覚えるか (§B の目安を sim で確定)。
5. **敵側の状態異常**: プレイヤー→敵 (眠らせ・デバフ・毒) が主目的。敵→プレイヤーの状態異常は
   framework 上は対称に作れるが、理不尽回避のため tier 別に慎重導入 (まずプレイヤー有利側から)。
6. **とくぎ定義の置き場所**: 当面 core の `SKILLS` テーブル (コード)。将来 #418 (PDS データ化)
   で管理ダッシュボードから編集可能にする射程に含める (データ構造を JSON 化しやすく保つ)。

---

## 実装状況

### #436 (完了) — framework + heal
上記設計のうち **framework 部分**を実装 (packages/core/src/battle.ts)。当初案の「`SkillDef` データ
テーブル」までは行かず、**既存の `SkillKind` enum + `LEARNED_SKILLS` (習得レベル付きリスト)** で
実装した (最小差分・後方互換優先)。
- `skillsForJob(archetype, jobLevel)`: [0]=署名スキル (`skillForJob` 一致) + `LEARNED_SKILLS` から
  習得済み副スキル。`BattleState.playerSkills` に格納。
- `resolveTurn(..., skillIndex=0)` で毎ターン選択 (既定 0=署名 → auto-battle/sim/既存テスト不変)。
- 新 kind `heal` (MP で maxHp の `skillHealRatio` 回復) を回復役・低攻撃ジョブに配布して複数選択を成立。
- UI: とくぎサブメニュー (world-battle-controls)。edge: `/api/battle/turn` の skillIndex を sealed
  state の playerSkills で検証 (サーバー権威・詐称防止)。
- 習得レベル/heal 配布は暫定 (dev 体感で調整)。auto-battle は署名スキル固定なので sim は heal を
  使わない = heal 職の実力を保守的に評価する (実プレイの回復で上振れ)。

### #437 (未) — 状態異常 + データ化への移行メモ
眠り/デバフ/バフ/毒は **状態エンジン** (`Combatant` に sleep/buffs/debuffs、`doAttack` で乗算、
cleanup で turns 減算) が要る。このとき `playerSkillAction` の switch が肥大化するので、**kind enum →
`SkillDef` データ (効果 category/magnitude/turns/chance) への移行**を #437 の頭で行うのが自然
(#418 の PDS データ化ともここで接続する)。#436 の enum は移行の踏み台であり、`LEARNED_SKILLS` の
形 (id + learnAt) はそのまま `SkillDef` 参照に置き換えられる。習得レベルの割り付け・敵側状態異常は
#437 で sim 調整。
