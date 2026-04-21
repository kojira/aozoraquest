# 05 - 相性システム (共鳴)

## 概要

他のユーザーとの「共鳴度」を計算して表示する機能。Bluesky 上で誰と最も響き合うかを可視化し、バイラル性と内発動機の両方を提供する。

**用語**: 「相性」は恋愛文脈を想起させるので、UI では「共鳴」「旅の仲間」「響き合う」のような表現を使う。

## 共鳴度の定義

2 つの要素の加重和で計算する。

```
共鳴度 = 類似度 × 0.6 + 相補性 × 0.4
```

### 類似度 (Similarity)

ステータス分布の Pearson 相関。

```typescript
function similarity(a: number[], b: number[]): number {
  const aMean = mean(a);
  const bMean = mean(b);
  const aC = a.map(v => v - aMean);
  const bC = b.map(v => v - bMean);
  const dot = aC.reduce((s, v, i) => s + v * bC[i], 0);
  const aMag = Math.hypot(...aC);
  const bMag = Math.hypot(...bC);
  if (aMag === 0 || bMag === 0) return 0;
  return Math.max(0, dot / (aMag * bMag));
}
```

「話が通じる」「共通言語がある」関係を表現する。完全一致 = 1.0、無相関 = 0、対極 = 負数 (0 にクリップ)。

### 相補性 (Complementarity)

片方が強い軸をもう片方が弱く、互いに補い合う関係。

```typescript
function complementarity(a: number[], b: number[]): number {
  let score = 0;
  for (let i = 0; i < 5; i++) {
    const diff = Math.abs(a[i] - b[i]);
    // 10-25% の差が理想。5% 未満は同じすぎる、25% 超は乖離しすぎ
    if (diff >= 10 && diff <= 25) {
      score += 0.2;
    }
  }
  return Math.min(score, 1);
}
```

### 最終スコア

```typescript
function resonance(a: StatVector, b: StatVector): number {
  return similarity(a, b) * 0.6 + complementarity(a, b) * 0.4;
}
```

結果は 0-1 の範囲。UI 表示時は百分率に変換して「共鳴度 72%」のように見せる。

## 共鳴度の意味付け

| スコア | 表示 |
|---|---|
| 0.8+ | 「最高の相棒」 |
| 0.6 - 0.8 | 「よき仲間」 |
| 0.4 - 0.6 | 「共に歩める」 |
| 0.2 - 0.4 | 「違いが面白い」 |
| 0 - 0.2 | 「異なる道を歩む者」 |

どのレベルも肯定的に表現する。低スコアを「相性が悪い」とは言わない。

## 相手のステータス取得

他ユーザーの現在ステータスを得るには 2 つの経路がある。

### 経路 A: 相手の PDS から読む (優先)

相手が Aozora Quest ユーザーで、診断結果を公開設定にしている場合。

```typescript
async function getStatsFromPDS(did: string): Promise<StatVector | null> {
  try {
    const record = await client.getRecord({
      repo: did,
      collection: 'app.aozoraquest.analysis',
      rkey: 'self',
    });
    if (!record?.value?.public) return null;
    const analyzedAt = new Date(record.value.analyzedAt);
    if (Date.now() - analyzedAt.getTime() > 30 * 86400000) return null; // 30日古いと無効
    return record.value.rpgStats;
  } catch {
    return null;
  }
}
```

### 経路 B: 相手の投稿を自分の端末で解析 (フォールバック)

相手がアプリユーザーでない、または非公開にしている場合。

```typescript
async function getStatsFromPosts(did: string): Promise<StatVector> {
  const posts = await fetchAuthorFeed(did, 150);
  return await diagnose(posts); // 04-diagnosis.md で定義
}
```

このフォールバックには数秒かかる。UI には「{userName} の投稿を解析中...」を表示。

### 統合関数

```typescript
async function getPartnerStats(did: string): Promise<{
  stats: StatVector;
  source: 'pds' | 'local-analysis';
}> {
  const fromPds = await getStatsFromPDS(did);
  if (fromPds) return { stats: fromPds, source: 'pds' };
  const fromPosts = await getStatsFromPosts(did);
  return { stats: fromPosts, source: 'local-analysis' };
}
```

### 解析結果のローカルキャッシュ

他ユーザーの解析結果も IndexedDB にキャッシュする (TTL 7 日)。同じ人のプロフィールを何度開いても再解析しない。

## 公開と非公開

### 自分の診断結果の公開設定

設定画面に「診断結果の公開」トグルを用意する。

- **公開**: `app.aozoraquest.analysis` に `public: true` で書き込まれる。他ユーザーが `getRecord` できる
- **非公開** (デフォルト): `public: false`。他ユーザーからの読み取りは PDS 側でブロックされる想定

AT Protocol では現状レコードレベルの ACL がないため、実装として:
- 公開時は専用の公開レコード `app.aozoraquest.analysis` (rkey = self) として書き込み
- 非公開時は書き込まない、または別コレクション `app.aozoraquest.privateAnalysis` に書く

### 公開のインセンティブ

公開することで得られる体験:
- 他ユーザーから「旅の仲間」として認識される
- ジョブが他人のプロフィールに表示される
- 相性表示で明示的なジョブ名を出せる (非公開時は「未知の旅人」)

## UI での表示

### プロフィール画面 (他人)

```
@kaori.bsky
————————————
詩人 · 共鳴 72%

最も共鳴する軸: LUK と DEF
違いを補い合う軸: INT
————————————
[フォロー] [共に旅する ↗]
```

「共に旅する」ボタンは、その人を「旅の仲間」リストに追加する (自分のプロフィールに表示される)。

### 自分のプロフィール画面

```
わたしの旅の仲間
┌───────┬───────┬───────┐
│ Kaori │ Taro  │ Miya  │
│ 72%   │ 68%   │ 65%   │
│ 詩人  │ 戦士  │ 巫女  │
└───────┴───────┴───────┘
        [もっと見る ↗]
```

タップで相手のプロフィールへ遷移。

### タイムライン

タイムライン上の投稿には**基本的に共鳴度を表示しない** (ノイズ防止)。ただし **80% 以上の超高共鳴の人の投稿だけ、アバターに微かな金色の輪**を加えて視覚的に強調する。

### 共鳴マップ (オプション機能)

自分を中心に、フォロー中のユーザーを共鳴度に応じた距離で配置した 2D マップ。スクリーンショット映えする。Twitter カード想定。

```
       [Kaori 72%]
        ・
   [Taro 68%]        [Miya 65%]
       ・              ・
              [自分]
       ・              ・
   [Ken 45%]           [Aya 50%]
```

距離 = (1 - resonance) × 半径。角度は DID のハッシュで決定的に割り当て。

## ペアジョブ称号

特定のジョブ組み合わせで相互フォローしている相手には、ペア称号を付与する。

| ジョブ A | ジョブ B | 称号 |
|---|---|---|
| 賢者 | 吟遊詩人 | 旅の哲学詩 |
| 戦士 | 巫女 | 城の守り手 |
| 冒険者 | 賢者 | 先駆の探検隊 |
| 魔法使い | 舞踏家 | 夜の宴 |
| 詩人 | 武闘家 | 対照の二人 |
| 守護者 | 将軍 | 鉄の結束 |
| 予言者 | 踊り子 | 運命の舞台 |
| 聖騎士 | 冒険者 | 光の行進 |

(合計 16C2 = 120 組あるが、すべてに特別称号を付ける必要はない。20 組程度で十分)

ペア称号が成立すると両者に通知が飛び、スクリーンショットしたくなる演出。

## 「好きな相手の相棒」動機設計

ユーザーが @kaori を好きで、彼女と最も共鳴するジョブを目指したい場合に、さりげなく導く。

### ジョブ選択画面での相性プレビュー

目標ジョブを選ぶとき、選択肢の横に「この相手と最もよく共鳴するジョブ」を表示する。

```
目標ジョブを選ぶ
──────────────────────
● 建築家 (賢者)   ← 現在のあなた
  Kaori との共鳴 52%

● 触媒 (冒険者)
  Kaori との共鳴 85%   ✨

● 案内人 (聖騎士)
  Kaori との共鳴 81%
──────────────────────
```

「Kaori を基準にする」ボタンを用意し、選んだ相手との共鳴度順にジョブをソートできる。

### 重要な倫理的配慮

「好きな人との相性だけで目標ジョブを決める」のは、自分のアイデンティティを曲げるリスクがある。アプリの価値観 (「自分らしくあれ」) と衝突する。

**緩和策**:
- 相性はあくまで「参考情報」として提示
- 現在の自分の本来型を常に併記
- 「相性 100% を目指すジョブ」を強く推奨しない
- 精霊のセリフに「なりたい自分を選ぶのは、誰かのためではなく、自分のため」のようなリマインダー

## プライバシー

### 他人の投稿を解析することの倫理

本機能は相手の公開投稿を自分のブラウザで解析するだけであり、データを外部に送信しない。Bluesky の公開投稿は本来誰でも読める情報なので、その範囲を超えない。

ただし、「本人が知らないところで勝手に診断される」という違和感はあり得る。

**対策**:
- 相手のプロフィールを開いた時に**一度だけ**診断する (自動連続解析しない)
- 相手のステータスを自分の PDS に保存しない (ローカルキャッシュのみ、7 日で失効)
- 「この人を旅の仲間にする」時のみ、相手の DID と共鳴度を自分の PDS に記録

### 相手側に通知するか

相性を計算されたことを相手に通知する機能は用意しない。プライバシーとストーカー化防止のトレードオフ。

「旅の仲間に追加された」ときだけ相手に通知する、という案もあるが、これはフォロー通知と機能が被るので**初期 MVP では実装しない**。

## パフォーマンス

### ボトルネック

相手の投稿からの診断 (経路 B) が重い。150 投稿 × 30ms = 約 5 秒。

### 最適化

- プロフィール画面を開いた瞬間にバックグラウンド開始
- UI には即座に「解析中...」表示、完了でフェードイン
- 途中でユーザーが画面を離れたらキャンセル
- Web Worker で実行 (UI スレッドをブロックしない)

### キャッシュ戦略

```typescript
async function cachedPartnerStats(did: string): Promise<StatVector> {
  const cached = await db.get(`partner-stats/${did}`);
  if (cached && Date.now() - cached.at < 7 * 86400000) {
    return cached.stats;
  }
  const fresh = await getPartnerStats(did);
  await db.put(`partner-stats/${did}`, { stats: fresh.stats, at: Date.now() });
  return fresh.stats;
}
```

## 共鳴タイムライン (目玉機能)

フォローしていなくても、**同じアプリを使って診断したことのある、自分と共鳴度の高い相手の投稿** だけを時系列で流すタイムライン。Bluesky 標準のフォローベース TL とは別タブとして提供する。

### 狙い

- **既存フォローグラフの外側にある「自分に合う声」への出会い**。気質が響き合う人は、実生活でもネット上でも貴重
- Aozora Quest を使う動機の中核。診断しただけで終わらず「あなたに響く声が毎日流れてくる」体験へ
- バイラル性: 「共鳴する誰かと Aozora Quest 経由で出会った」が語られやすい

### 参加の条件 (オプトイン)

自分の投稿を他人の共鳴 TL に流したい場合、以下の両方を有効にする必要がある。

- `app.aozoraquest.profile.discoverable = true` (自分がディレクトリに登録されて良いという意思表示)
- `app.aozoraquest.analysis.public = true` (診断結果を他人から読み取り可能にする)

**オプトインしなくても、共鳴 TL の閲覧自体は可能**。見るだけなら誰でも使える。

### 発見 (Discovery) メカニズム

ディレクトリを主管理者 DID の PDS に置く。

- レキシコン: `app.aozoraquest.directory` (08-data-schema.md)
- rkey: `self` (シングルトン)
- 内容: オプトインした DID の配列

```json
{
  "users": [
    { "did": "did:plc:abc", "addedAt": "2026-04-20T09:15:00Z" },
    { "did": "did:plc:def", "addedAt": "2026-04-18T14:30:00Z" }
  ],
  "updatedAt": "2026-04-20T09:15:00Z"
}
```

#### 登録フロー (MVP)

1. ユーザーが設定画面で「発見 ON」をトグル → 自分の PDS に `discoverable: true` を書く
2. 主管理者が定期的にオプトイン希望者を確認し、ディレクトリに追加 (手動)
3. 追加後、そのユーザーは全 Aozora Quest ユーザーの共鳴 TL の探索対象になる

**登録方法 (post-MVP)**: Bluesky の jetstream (公開 WebSocket) をブラウザから購読し、`app.aozoraquest.profile` への書き込みイベントを検知して半自動でディレクトリを更新する案。手動運用がスケールしなくなった時点で検討。

#### なぜ管理者ディレクトリなのか

- 完全にバックエンドレスのままで発見を成立させる
- 「アプリ利用者かどうか」の真偽を主管理者が担保 (スパム防止)
- 初期規模 (数十〜数百人) なら手動追加で回る

### アルゴリズム

```typescript
async function buildResonanceTimeline(selfDid: string): Promise<FeedPost[]> {
  // 1. ディレクトリを取得 (主管理者 PDS)
  const directory = await getAdminDirectory();
  const candidateDids = directory.users.map(u => u.did).filter(d => d !== selfDid);

  // 2. 各候補の分析結果と共鳴度を取得 (キャッシュ優先、7 日 TTL)
  const myStats = await getSelfStats();
  const scored = await Promise.all(candidateDids.map(async did => {
    const theirStats = await cachedPartnerStats(did);
    return { did, score: resonance(myStats, theirStats) };
  }));

  // 3. 上位 K 人に絞る (既定 K=30)
  const topK = scored.sort((a, b) => b.score - a.score).slice(0, 30);

  // 4. 各人の直近投稿を取得
  const feeds = await Promise.all(topK.map(({ did, score }) =>
    fetchAuthorFeed(did, 20).then(posts => posts.map(p => ({ ...p, score })))
  ));

  // 5. マージして「共鳴度 × 新鮮度」でランク付け
  const merged = feeds.flat();
  const ranked = merged.sort((a, b) => {
    const scoreA = a.score * Math.exp(-ageInHours(a.indexedAt) / 48);
    const scoreB = b.score * Math.exp(-ageInHours(b.indexedAt) / 48);
    return scoreB - scoreA;
  });

  return ranked.slice(0, 50);
}
```

`48` (時間) は新鮮度の減衰の時定数。2 日前の投稿は約 1/e (≒ 37%) に減衰。この数値は運用しながら調整する (仮置き)。

### UI

- Home 画面のタイムラインタブを「フォロー / 共鳴」の 2 つに分ける (詳細は 07-ui-design.md)
- 共鳴 TL の各投稿には、著者の表示ジョブと自分との共鳴度バッジを付ける
- 投稿をタップすると相手のプロフィール (自分との共鳴度の詳細が見える)
- 初回は「ディレクトリに {N} 人の旅人がいます」的な空状態表示

### キャッシュ戦略

- ディレクトリ: boot 時に 1 回取得、セッション中は再取得しない
- 各ユーザーの分析結果: IndexedDB に 7 日キャッシュ (既存の `partnerStats` と同じ TTL)
- 共鳴 TL 自体 (スコア計算結果): 10 分キャッシュ。TL 再読み込みで更新

### プライバシー

- オプトインしたユーザーのみがディレクトリ掲載対象 (発見される側は完全同意制)
- 見る側 (閲覧者) の DID はどこにも記録されない。純粋にクライアント側計算
- オプトイン解除 (`discoverable = false`): ユーザーが書き換えれば、次回の管理者によるディレクトリ掃除で除外される
- 緊急削除要請: 管理者に連絡 → ディレクトリから即時除去 → 以降の共鳴 TL 対象から外れる

### スケーリング注記

ディレクトリが 1,000 人を超えると、各クライアントが全員の分析結果を引くのはやりすぎになる。次の段階:

- ランダムサンプリング (例: 300 人だけ引く)
- 言語フィルター (自分が日本語中心なら日本語アカウントのみ)
- ジョブ類似度の事前フィルタ (diagonal opposite な形の人は先に切る)

これらは成長期の課題。MVP 時点では全件スキャンで十分。

## バイラル設計

本機能はアプリのバイラル性の核。以下の要素で SNS シェア性を高める。

1. **共鳴マップのシェア**: Twitter カードで共鳴マップ画像を生成、「#AozoraQuest 私の旅の仲間たち」でシェア
2. **ペア称号の告知**: 称号解放時に自動で投稿下書きを提示「Kaori と『旅の哲学詩』の称号を獲得した」
3. **ジョブ別共鳴ランキング**: 「賢者と最も共鳴したのは巫女の Miya」のような自動投稿案
4. **月次サマリー**: 「今月の旅の仲間 TOP 3」を月末に表示、シェア可能

これらは**強制しない**。下書きを提示するだけでユーザーが選んで投稿する。
