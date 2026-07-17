# ブルスコンの試練 (ミニゲーム)

あおぞらパワーを消費して遊ぶターン制バトルのミニゲーム。ブルスコン (召喚済みの精霊)
が「試練の使い」として SVG モンスターを召喚し、プレイヤーはジョブの特性を活かして戦う。

**精霊チャット (LLM 会話) はこの機能で置き換えて廃止する** (オーナー決定 2026-07-17)。
過去の spiritChat レコードは消さない (パワー式の userMessages は従来どおり数える =
残高が急に増えない)。

## 経済

- 1 戦 = あおぞらパワー **1** 消費 (`BATTLE_TUNING.powerCost`)。
- パワー残高式は `viaPosts − userMessages − cardDraws − battles` に拡張する
  (`app.aozoraquest.power/self` に `battles` カウンタを追加。旧レコードは欠落 → 0 扱い)。
- 勝利でパワーは**返さない** (インフレ防止)。報酬は XP / 戦績 / 称号 / 素材ドロップ。
- 挑戦条件: ブルスコン召喚済み (従来の SUMMON_THRESHOLD ゲートを流用)。

## バトルエンジン (packages/core/src/battle.ts)

- **決定的**: seed + コマンド列から結果が一意。乱数はターン毎に `hash(seed, turn)`
  から生成するので state は JSON 化できる (テストで挙動を固定できる)。
  ※ battle レコードにはコマンド列は残さないため、記録から勝敗を再現・検証すること
  はできない。記録の目的は消費の記帳と戦績集計。
- プレイヤーの戦闘値はジョブの 5 ステータス [atk, def, agi, int, luk] +
  jobLevel/playerLevel 補正から導出 (`playerCombatant`)。
- **特技はジョブの支配ステータスで決まる** (技名はジョブ固有 `JOB_SKILL_NAMES`):
  | 支配 | kind | 効果 |
  |---|---|---|
  | atk | smash | 1.7 倍撃・少し外れやすい |
  | def | parry | 防御 + 被弾時に反撃 (行動順に関係なくターン頭で構える) |
  | agi | flurry | 0.65 倍 × 2 回攻撃 |
  | int | spell | 防御半減貫通・必中 (int 依存)。硬い敵に有効 |
  | luk | gamble | 0〜2.6 倍 (luk が高いと下振れしにくい) |

  gamble 職 (bard/miko/paladin 等) は atk が低く素の火力は控えめ。luk はクリティカル
  とドロップ率に効く設計で、Step2 の装備で火力を補う前提。
- コマンドは たたかう / ぼうぎょ / とくぎ の 3 択 (スマホ縦画面前提の大ボタン)。
- モンスターは tier 1〜3 (手習い/修練/真剣勝負) × 各 3 種。プレイヤーレベルに追随して
  スケールし、tier1 は勝ちやすく tier3 は挑戦的 (バランスはテストで固定:
  高 Lv×tier1 勝率 ≥80%、Lv1×tier3 敗率 ≥60%)。
- 30 ターンで強制判定 (残 HP 割合勝負)。

## 記録 (PDS)

- `app.aozoraquest.battle` (tid rkey): 1 戦 1 レコード
  `{ seed, tier, monsterId, outcome, turns, drops, at, via }` — 消費の監査 +
  戦績/称号/素材の集計ソース。
- `app.aozoraquest.power/self`: `battles` カウンタを増分 (bumpPower 拡張)。
- 集計 (`wins/losses/bestStreak/tier3Wins`) から称号 (`TITLES`) を導出。

## SVG モンスター

species キー (slime/bat/mushroom/golem/wisp/serpent/raven/oni/dragon) ごとに
UI 側でインライン SVG を描く。画像アセットなし = 軽量・省メモリ (モバイル方針)。

## 段階

1. **PR①** core エンジン + テスト (本 doc 追加) — UI 無し、本番挙動に影響なし
2. **PR②** 消費配線 (power の `battles` / battle レコード / points.ts 拡張)
3. **PR③** UI: /spirit をチャット → 試練アリーナへ転換、SVG モンスター、戦績/称号表示
4. **PR④ (Step2)** 装備ショップ: 素材 + パワーで武器防具を購入 → 戦闘値に加算
