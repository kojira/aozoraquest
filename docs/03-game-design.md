# 03 - ゲームデザイン

## 設計哲学

Aozora Quest のゲーム性は「**自分の形を刻む**」ことに集約される。RPG のレベル上げのように数値を大きくするのではなく、5 軸の**相対的な配分**を意図的に偏らせることで、16 の気質の中から自分が目指す形に近づいていく。

平坦な分布 (すべて 20%) は何者でもない旅人を意味し、どのジョブにもマッチしない。これは **No Free Lunch 定理**を UX に組み込んだ設計であり、「全部やる」戦略を無効化する。

## 5 ステータス

### 一覧

| 略称 | 名称 | 意味 | 育て方 |
|---|---|---|---|
| ATK | こうげきりょく | 能動的に世界へ働きかける力 | 意見ポスト、議論参加、引用リポスト + 意見 |
| DEF | ぼうぎょりょく | 揺るがない心の強さ | スレッド継続、連続投稿、冷静な議論応答 |
| AGI | すばやさ | 反応の速さと軽やかさ | 短文連投、即レス、話題転換 |
| INT | かしこさ | 知的な深さと洞察力 | 長文分析、引用考察、データ言及 |
| LUK | うんのよさ | 場に愛される力 | 共感リプ、ユーモア、埋もれた投稿への反応 |

### 表示方法

**絶対値は表示しない**。常に正規化した百分率で表示する。

```
ATK 25% | DEF 14% | AGI 10% | INT 37% | LUK 14%
```

合計は常に 100%。どの軸が強いかが一目で分かる形を優先する。

### 色と配置

レーダーチャート上の配置:

| 位置 | ステータス | 意味付け |
|---|---|---|
| 上 | ATK | 最も目立つ、能動性 |
| 右上 | AGI | 動 |
| 右下 | LUK | 偶発 |
| 左下 | INT | 静、賢者的内省 |
| 左上 | DEF | 守り |

色ランプ (Tailwind ベース):
- ATK: coral (`#D85A30`)
- DEF: blue (`#378ADD`)
- AGI: amber (`#EF9F27`)
- INT: purple (`#7F77DD`)
- LUK: pink (`#D4537E`)

## 16 ジョブ

### 配分表

ATK / DEF / AGI / INT / LUK の順、合計 100 になるよう設計されている。

| id | 既定名 | 生産系 | 別系統 | ATK | DEF | AGI | INT | LUK | 主機能 | 補助機能 |
|---|---|---|---|---|---|---|---|---|---|---|
| `sage` | 賢者 | 建築家 | 戦略家 | 25 | 14 | 10 | 37 | 14 | Ni | Te |
| `mage` | 魔法使い | 錬金術師 | 研究者 | 7 | 23 | 16 | 31 | 23 | Ti | Ne |
| `shogun` | 将軍 | 棟梁 | 起業家 | 38 | 10 | 14 | 28 | 10 | Te | Ni |
| `bard` | 吟遊詩人 | 発明家 | 即興師 | 7 | 20 | 23 | 20 | 30 | Ne | Ti |
| `seer` | 予言者 | 導師 | 語り部 | 7 | 14 | 13 | 44 | 22 | Ni | Fe |
| `poet` | 詩人 | 職人 | 彫刻家 | 14 | 34 | 12 | 7 | 33 | Fi | Ne |
| `paladin` | 聖騎士 | 教育者 | 案内人 | 7 | 16 | 16 | 32 | 29 | Fe | Ni |
| `explorer` | 冒険者 | 触媒 | 旅芸人 | 18 | 24 | 20 | 8 | 30 | Ne | Fi |
| `warrior` | 戦士 | 書記 | 鍛冶師 | 24 | 42 | 8 | 9 | 17 | Si | Te |
| `guardian` | 守護者 | 司書 | 家守 | 7 | 39 | 10 | 20 | 24 | Si | Fe |
| `fighter` | 武闘家 | 技師 | 匠 | 10 | 13 | 22 | 42 | 13 | Ti | Se |
| `dancer` | 舞踏家 | 工芸家 | 庭師 | 15 | 20 | 23 | 15 | 27 | Fi | Se |
| `captain` | 隊長 | 指揮者 | 管理官 | 34 | 28 | 10 | 10 | 18 | Te | Si |
| `miko` | 巫女 | 世話役 | 看護師 | 7 | 32 | 10 | 15 | 36 | Fe | Si |
| `gladiator` | 剣闘士 | 職方 | 現場監督 | 15 | 10 | 33 | 27 | 15 | Se | Ti |
| `performer` | 踊り子 | 芸人 | 祭司 | 20 | 12 | 30 | 10 | 28 | Se | Fi |

### ジョブ名の選択

ユーザーは設定画面でジョブの表示名バリアントを選ぶことができる。

- `default`: 既定名 (RPG ファンタジー系)
- `maker`: 生産系 (作り手のイメージ)
- `alt`: 別系統 (現代的 / 抽象的)

内部識別子 (`sage` など) は変わらない。UI に表示される名前のみ差し替わる。

### ジョブマッチング

ユーザーの現在のステータス分布と、各ジョブの配分との**形の類似度**を Pearson 相関で計算する。

```typescript
function shapeSimilarity(user: number[], job: number[]): number {
  const uMean = mean(user);
  const jMean = mean(job);
  const uC = user.map(v => v - uMean);
  const jC = job.map(v => v - jMean);
  const dot = uC.reduce((s, u, i) => s + u * jC[i], 0);
  const uMag = Math.hypot(...uC);
  const jMag = Math.hypot(...jC);
  if (uMag === 0 || jMag === 0) return 0;
  return dot / (uMag * jMag);
}

function currentJob(userStats: number[]): { jobId: string; score: number } | null {
  const matches = JOBS.map(j => ({
    jobId: j.id,
    score: shapeSimilarity(userStats, j.stats),
  })).sort((a, b) => b.score - a.score);
  
  if (matches[0].score < 0.3) return null; // 旅人状態
  return matches[0];
}
```

マッチ度 0.3 未満 = 「未修行の旅人」。特化していない状態を否定的ではなく肯定的に提示する。

**旅人度の計算**: ステータスの標準偏差から導出する。

```typescript
function wandererScore(stats: number[]): number {
  const variance = stdev(stats);
  return Math.max(0, Math.min(1, 1 - variance / 10));
}
```

- 0.0 - 0.2: 「道に立つ者」
- 0.2 - 0.5: 「修行中」
- 0.5 - 0.8: 「旅の初心」
- 0.8 - 1.0: 「白紙の旅人」

## 行動 × ステータス重み

各アクションが複数ステータスを同時に動かす。主軸に強く、対極を弱める構造で、No Free Lunch を機能させる。

### 重み表

| アクション | ATK | DEF | AGI | INT | LUK | 判定方法 |
|---|---|---|---|---|---|---|
| 意見ポスト (断定・主張) | +3 | -1 | 0 | +1 | 0 | LLM タグ: opinion |
| 長文分析ポスト (200字+) | +1 | 0 | -1 | +3 | 0 | 文字数 + タグ: analysis |
| 短文連投 (60字未満) | 0 | 0 | +3 | -1 | +1 | 文字数 + 5分以内の連続投稿 |
| 5分以内の即レス | 0 | -1 | +2 | 0 | +1 | 親投稿からの経過時間 |
| 共感リプ | -1 | +1 | 0 | 0 | +3 | 親の LLM タグ: distress / goodnews |
| ユーモア投稿 | 0 | 0 | 0 | 0 | +3 | LLM タグ: humor |
| 引用リポスト + 意見 | +2 | -1 | 0 | +1 | 0 | quote + LLM タグ: opinion |
| 引用リポスト + 考察 | 0 | 0 | -1 | +2 | +1 | quote + LLM タグ: analysis |
| スレッド継続 (自己連投3+) | 0 | +2 | 0 | +1 | 0 | self-reply 3 件以上 |
| 冷静な議論応答 | -1 | +2 | 0 | +1 | 0 | reply + 親の LLM タグ: debated |
| 連続投稿日数維持 (日次) | 0 | +2 | 0 | 0 | 0 | 日付ベース、アクション不問 |
| 埋もれた投稿へいいね | 0 | 0 | 0 | 0 | +2 | 親の経過時間 > 60分 かつ いいね < 5 |
| 普通のいいね | 0 | 0 | 0 | 0 | +1 | デフォルト |
| リポストのみ | 0 | 0 | +1 | 0 | 0 | repost event |

### 日次上限

**同一アクション種別あたり、1 日 5 回までカウント**。6 回目以降は重みゼロで記録のみ。

これにより:
- スパム的な連打で特定ステータスを伸ばせない
- 自然に行動が分散する (多様なアクションを取る動機)
- ライトユーザーには不可視 (5 回以下しかやらない人は影響を受けない)

### 減衰

行動の累積値は指数減衰する。半減期 60 日。

```typescript
function currentStatRaw(actions: Action[]): number {
  const now = Date.now();
  return actions.reduce((sum, a) => {
    const ageInDays = (now - a.timestamp) / 86400000;
    const decay = Math.exp(-ageInDays / 60);
    return sum + a.weight * decay;
  }, 0);
}
```

これにより「過去の自分」に縛られず、最近の行動が形を決める。転職したければ今日から違う行動を始めればよい。

### 床値

減算の連続で 0 を割らないよう、床値 5 を設定する。

```typescript
const MIN_STAT = 5;
const displayStat = Math.max(MIN_STAT, rawStat);
```

### 正規化

最終的な表示は正規化されて合計 100 になる。

```typescript
function normalize(raw: Record<Stat, number>): Record<Stat, number> {
  const total = sum(Object.values(raw));
  return Object.fromEntries(
    Object.entries(raw).map(([k, v]) => [k, Math.round(v / total * 100)])
  );
}
```

## クエスト

### 概要

毎朝 3 つのクエストが自動生成される。ユーザーの目標ジョブと現在のステータスの差分から、必要な行動を促す。

### クエスト生成アルゴリズム

機械的・決定的に生成する。LLM は使わない。

```typescript
function generateDailyQuests(user: User, date: Date): Quest[] {
  const current = user.currentStats;
  const target = JOBS[user.targetJob].stats;
  
  const gaps = STATS.map(stat => ({
    stat,
    gap: target[stat] - current[stat],
    abs: Math.abs(target[stat] - current[stat]),
  })).sort((a, b) => b.abs - a.abs);
  
  const slots = [
    { type: 'growth',      stat: gaps[0].stat, needsDirection: 'up' },
    { type: 'growth',      stat: gaps[1].stat, needsDirection: 'up' },
    { type: 'restraint',   stat: gaps[2].stat, needsDirection: 'down' },
  ];
  
  const seed = hash(user.did + date.toISOString().slice(0, 10));
  const recent = user.recentQuests(7);
  
  return slots.map((slot, i) => {
    const pool = QUEST_TEMPLATES[slot.type][slot.stat]
      .filter(t => !recent.includes(t.id));
    const template = pool[(seed + i) % pool.length];
    return instantiate(template, user.lv);
  });
}
```

**ポイント**:
- ギャップが大きいステータス上位 2 つに成長クエスト
- 過剰なステータス 1 つに節制クエスト
- 日付とユーザー DID のハッシュがシードなので、同じ日は同じクエスト (再起動で変わらない)
- 過去 7 日以内に出たクエストはフィルタ (ローテーション)

### クエストのタイプ

#### 成長クエスト

不足しているステータスを伸ばす行動を促す。

例: 「軽やかに短文を放て」
- 対象ステータス: AGI
- 条件: 60 字未満の投稿を N 個
- N = `max(3, Math.floor(3 × (1 + (lv - 1) * 0.1)))`
- XP: 50 + N × 10

#### 維持クエスト

既に足りているステータスを保つ行動を促す。挫折防止の「簡単な日常クエスト」。

例: 「今日も一言を記せ」
- 対象: 任意のステータス (ギャップが小さいもの)
- 条件: 任意の投稿を 1 件
- XP: 20

#### 節制クエスト

過剰なステータスを控える行動。「やらないこと」が成長になる独自要素。

例: 「今日は長文分析を控えよ」
- 対象: INT が目標より高い
- 条件: 24 時間以内に 200 字以上の投稿をしない
- 判定: 日付変更時に過去 24 時間をチェック
- XP: 80

節制クエストの UX は慎重に扱う (後述)。

### クエストテンプレートプール

各ステータスごとに 5-8 個のテンプレート。

#### ATK 成長
- 「自分の意見を N 個発信せよ」(意見ポスト)
- 「議論に N 回参戦せよ」(debated タグの投稿へのリプ)
- 「引用して自分の考えを添えよ、N 回」(引用リポスト + 意見)
- 「ポジティブな宣言を N 件」(goodnews + opinion 複合)

#### DEF 成長
- 「N 日連続で投稿せよ」(ストリーク)
- 「スレッドを N 段続けよ」(self-reply)
- 「反論に冷静に N 回応じよ」(冷静な議論応答)
- 「同じテーマで N 日書き続けよ」(日付を跨ぐテーマ継続)

#### AGI 成長
- 「軽やかに短文を N 個連投せよ」
- 「N 件のポストに 5 分以内に反応せよ」(即レス)
- 「話題を N 回転換せよ」(タグの多様性)
- 「新鮮な投稿 (10 分以内) に N 件絡め」

#### INT 成長
- 「200 字以上の分析を N 件書け」
- 「引用して考察を添えよ、N 回」
- 「スレッドで論点を N 段深めよ」
- 「根拠に N 回言及せよ」(URL 含む投稿等)

#### LUK 成長
- 「N 人に共感を贈れ」(distress / goodnews への共感リプ)
- 「埋もれた投稿に N いいね」(underseen タグ)
- 「ユーモアのある投稿を N 件」
- 「祝福リプを N 件送れ」(goodnews への祝い)

#### 節制テンプレート (全ステータス共通構造)

- 「今日は〇〇を控えよ」(対応するアクションを 24h やらない)
- 「今日は受動に徹せよ」(投稿せずタイムライン閲覧のみ)
- 「〇〇のバランスを整えよ」(特定のアクションを 5 回以上しない日を作る)

### 達成判定

ユーザー行動ごとに同期的に判定する。

```typescript
async function checkProgress(
  action: Action,
  post: Post,
  activeQuests: Quest[]
): Promise<QuestUpdate[]> {
  const updates: QuestUpdate[] = [];
  for (const quest of activeQuests) {
    if (await matchQuest(quest, action, post)) {
      updates.push({ questId: quest.id, delta: 1 });
    }
  }
  return updates;
}

async function matchQuest(quest: Quest, action: Action, post: Post): Promise<boolean> {
  switch (quest.templateId) {
    case 'agi_short_post':
      return action === 'post' && post.text.length < 60;
    case 'int_long_post':
      return action === 'post' && post.text.length >= 200;
    case 'luk_likes_given':
      return action === 'like';
    case 'luk_empathy_reply':
      if (action !== 'reply') return false;
      const tags = await tagPost(post.parent.text);
      return tags.includes('distress') || tags.includes('goodnews');
    // ...
  }
}
```

純粋ルールで判定できるものは JS のみ。トーン判定が必要なものは Browser LLM (`tagPost`) を呼ぶ。

### 節制クエストの判定

節制クエストは「アクションが**発生しなかったこと**」を成功とする。日付変更時のバッチで判定する。

```typescript
function settleRestraintQuest(quest: Quest, actionsToday: Action[]): boolean {
  const violatingActions = actionsToday.filter(a =>
    quest.forbiddenActionTypes.includes(a.type)
  );
  return violatingActions.length === 0;
}
```

### XP とレベル

各クエスト完了時に XP を加算。累計 XP から LV を計算。

| LV | 累計 EXP |
|---|---|
| 2 | 100 |
| 5 | 800 |
| 10 | 3,500 |
| 20 | 15,000 |
| 30 | 40,000 |
| 50 | 150,000 |

**LV の役割**:
- UI のドーパミン層 (絶対的な成長実感)
- クエストの難易度スケーリング係数
- 称号の解放条件

ただし**ステータスの形には影響しない**。LV 50 の旅人もあり得る。

### コンボ

5 分以内に連続してアクションした数をコンボとしてカウント。コンボ中は XP に倍率がかかる。

- ×1 (単発)
- ×2 (2-4 連続)
- ×3 (5-9 連続)
- ×5 (10+ 連続)

コンボ切れは 5 分の無活動でリセット。**短期集中セッション**を奨励し、ダラダラ滞在を抑制する。

## タイムラインバッジ

各投稿の右上に「このポストに何をすると何が育つか」を予告する小さなバッジ。

### 算出フロー

1. **特徴抽出**: 投稿のタグ付け (Browser LLM)
2. **機会候補の計算**: タグ × アクションから可能な獲得を列挙
3. **アクティブクエスト絞り込み**: 今日のクエストに関連するもののみ
4. **キャップ・CD 判定**: 日次上限、同一ユーザー CD、品質乗算
5. **最高スコア選定**: 残った候補から最もポイントが高い 1 つを選択

詳細は [03-game-design.md の付録 A] 参照。

### 表示ルール

- 1 画面に 2-3 個まで (ノイズ防止)
- 該当クエストがないポストにはバッジを出さない
- フォント 10px、ピル形、極力小さく

## アンチチート

### スパム検出

- 同一ユーザーへの連続いいねは 4 時間クールダウン
- 日次 LUK 上限 (いいね由来): 15 ポイント
- 10 文字未満の返信は XP 計算から除外
- 5 分以内の連続リプは 2 件目以降 50% 減衰
- Bot 判定ユーザーの投稿は全バッジ非表示

### 品質乗算

自分の直近 24 時間の投稿トーンがスパム的 (全て 10 文字以下、繰り返し、同一内容) なら、獲得する LUK に 0.5 倍の乗算。質の低い投稿者はいいね贈与でステータスが伸びない。

## 成長ループのまとめ

```
① ポストする／反応する
        ↓
② 行動に応じてステータス加減算
        ↓
③ クエスト進捗更新
        ↓
④ 日付変更で達成確定、XP 獲得
        ↓
⑤ LV アップ、ステータス形が微変化
        ↓
⑥ 翌朝、新しいクエスト (差分に応じて)
        ↓
⑦ 精霊のお告げ
        ↓
①へ
```

## 転職

ユーザーの形が目標ジョブ配分に十分近づいた時 (マッチ度 0.85 以上)、転職可能状態になる。転職の演出は特別なもの (称号獲得、精霊の祝福、LV 次第で装飾差分) にする。

転職前後で停止することはなく、内部の `currentJob` はマッチ度が最大のジョブに常時追従している。ユーザーが「転職する」と明示的に選ぶと、プロフィール上の表示ジョブが切り替わる。

ジョブは何度でも変更可能。複数のジョブを経験した人には「二つの道を歩む者」「諸芸の旅人」のような称号が与えられる。
