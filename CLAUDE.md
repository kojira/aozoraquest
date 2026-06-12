# aozoraquest プロジェクト 開発ルール

プロとして守るべき最低限のルールを以下に記す。違反したらすぐ止めて修正する。

(プロジェクトの現状や公開範囲はオーナー (kojira) のみが定義する。Claude が
勝手に「本番運用中」「友人が使ってる」等と性質を決めつけない。確認が必要なら聞く)

---

## 1. ブランチ運用

### 厳守事項

- **`main` ブランチは本番デプロイ専用** (Cloudflare Workers Builds が main push で `aozoraquest.app` に自動 deploy)。
  直接 commit / push / 編集してはいけない。
- **`dev` ブランチは統合 / dev 環境デプロイ専用** (Cloudflare Workers Builds が dev push で `dev.aozoraquest.app` に自動 deploy)。
  **直接 commit / push してはいけない**。すべての修正は feature ブランチで行い、PR 経由で dev にマージする。
- 機能開発・修正は **トピックブランチ** を切ってそこで作業する。命名規則:
  - `feature/<topic>`: 新機能 (例 `feature/quest-board-columns`)
  - `fix/<topic>`: バグ修正 (例 `fix/handle-cache-ssr`)
  - `docs/<topic>`: ドキュメントのみ
  - `chore/<topic>`: 設定 / 依存関係
  - `refactor/<topic>` / `perf/<topic>` / `test/<topic>` も Conventional Commits の prefix に合わせて使う
- 1 トピックブランチ = 1 PR = 1 つの目的 を原則とし、PR を肥大化させない (= 横道にそれた修正は別ブランチを切る)
- `git checkout main` / `git checkout dev` の後にファイル編集してはいけない。merge の操作だけが許される。
- PR マージ完了直後に **元のトピックブランチか、新規トピックブランチを切って** main / dev から離れる。

### 作業開始時のルーティン

```bash
git branch --show-current        # main / dev に居たら止める
git checkout dev
git pull --rebase origin dev     # 最新の dev を取り込む
git checkout -b feature/<topic>  # 新規トピックブランチを切る
# 編集 → commit → push -u origin feature/<topic>
gh pr create --base dev --head feature/<topic>
```

### feature → dev のマージは PR 経由が基本

`git checkout dev && git merge feature/xxx` の直接マージは緊急時のみ。
通常は GitHub の Pull Request で:
1. `gh pr create --base dev --head feature/<topic>`
2. CI 緑を確認
3. **第三者レビュー (§1.5 必須レビュー) を実施し、指摘事項に対応してから承認**
4. **squash merge** ボタン (= feature の commit が dev に 1 コミットで圧縮される)
5. feature ブランチは **削除 OK** (`gh pr merge --squash --delete-branch`)

### dev → main の本番リリース

dev に複数の feature PR が積まれた後、リリース単位で `dev → main` の PR を作成:
1. `gh pr create --base main --head dev`
2. CI 緑 + **第三者レビュー (§1.5) で指摘ゼロ or 全対応済み**
3. オーナー承認
4. squash merge (= 複数 feature が main に 1 コミットで反映、リリースノート的)
5. dev ブランチは残す (= 次の機能開発用)

`main` / `dev` は GitHub の branch protection rule で守る:
- Require pull request before merging
- Require status checks to pass (CI)
- Restrict who can push (admin のみ + force-push 禁止)
- `main` のみ「Required approvals」を 1 に設定するのも可

---

## 1.5 マージ前の必須レビュー

**全ての PR (feature → dev、dev → main の両方) は、マージ前に第三者視点レビューを実施し、指摘事項にすべて対応する** ことを必須とする。

### 必須レビューの実施

PR 作成後、CI 緑になった時点で:
1. **3 つの subagent を並列** で立て、独立に第三者視点レビューを実施
   - **設計レビュー**: 設計判断の妥当性、未解決事項、設計書との整合
   - **実装レビュー**: バグ可能性、型安全、エッジケース、テスト網羅性
   - **UX レビュー**: ユーザー体験、視認性、認知負荷、DESIGN.md 準拠
2. 各 subagent は `claude.ai/code` の管理外で動く独立観点。**ultrareview のような有料ツールは使わない**
3. レビュー結果は ★★★ (致命的) / ★★ (中規模) / ★ (改善余地) の 3 段階で出力させる

### 対応ルール

| 重要度 | マージ前対応 | 対応しない場合 |
|---|---|---|
| **★★★** | **必須対応** | マージ不可 |
| **★★** | **必須対応 or issue 化して別 PR で対応** | issue 番号を PR description にリンク |
| ★ | **対応 or issue 化、どちらでも可** | issue リンクのみで OK |

要するに **「★★★ は PR 内で必ず修正、★★ は対応 or issue 化、★ は柔軟」** が原則。

### 「対応 or issue 化」の判断基準

- PR の本来スコープに含まれる修正 → **PR 内で対応**
- PR の本来スコープを超える別 topic → **issue を切って別 PR**
- 仕様ではなく好みの問題 (= 設計判断の代替案) → **設計者がコメントで判断記録**

### PR description への記録

PR description に **「## Review」セクション** を追加し、以下を記載:
- ★★★ 対応内容 (どの commit で何を直したか)
- ★★ 対応内容 or 別 issue 番号 (例: `#42`)
- ★ 別 issue 番号 (PR 内で対応した場合は対応内容)

これで後から PR 履歴を見ても「どのレビュー指摘がどう処理されたか」が追える。

### 例: PR #25 (依頼クエスト機能) の運用実例

- 3 並列レビューで ★★★ 13 件 + ★★ 多数を検出
- ★★★ をすべて PR 内で修正、★★ も主要分は PR 内で対応、残りを issue #26-#30 に切り出し
- PR description に各 issue 番号を追記してマージ
- これと同じ流儀を以降の全 PR で踏襲する

### 自動レビューを忘れない仕組み

- PR を作ったら、ローカル CLI (claude code) で `「PR #N を第三者視点でレビューして」` と依頼するのが運用ルーチン
- ユーザーは PR レビューを取らずにマージしない (= マージボタンを押すのはレビュー対応完了後)
- レビュー subagent は dev / main の merge 操作を一切しない (= レビュー専用)

---

## 2. コミット前チェック (ローカル)

push する前にローカルで以下を **必ず通す**。CI で気付くのは遅い:

```bash
pnpm --filter @aozoraquest/web typecheck
pnpm --filter @aozoraquest/web build       # env vars 要、ローカル .env で
pnpm --filter @aozoraquest/web test
pnpm --filter @aozoraquest/web test:e2e    # 重要な変更時のみ
```

CI が落ちてる状態で次の作業を始めない。CI 緑 = 次の作業の前提条件。

---

## 3. 動作確認 (ブラウザ)

typecheck / build / test 緑は **十分条件ではない**。実際の UI を触らないと見つからないバグが多い。

- dev 環境で実際にログイン → 該当機能を操作 → 期待通りに動くか
- モバイルで触る場合は実機 (sim だけでは挙動が違うことが過去の事故で判明)
- ユーザーに「動作確認してから push」と言われた時は本気で確認。「typecheck 通ったから大丈夫」は通らない

---

## 4. シークレット & 個人情報

### ソースコードに直書き禁止

- API キー、トークン、URL、handle、DID、メールアドレス → 全部 NG
- 環境変数経由にして、値は外部に置く
- 過去事例: kojira.io を debug コードに直書き → user に怒られた

### 環境変数の置き場所

| 用途 | 置き場所 |
|---|---|
| ローカル開発 | `apps/*/.env.development` (commit する。ローカル defaults 用) |
| ローカル個人設定 | `apps/*/.env.local` (gitignore 済) |
| CI / GitHub Actions | Repository Variables (`${{ vars.X }}`) or Secrets (`${{ secrets.X }}`) |
| Cloudflare 本番/dev deploy | CF Dashboard → Settings → Build → Variables |
| Vitest | `apps/*/.env.test` (commit する) |

CI yaml に値を直書きしない。`${{ vars.VITE_APP_URL }}` のように参照する。

### secrets vs variables の使い分け

- **secrets**: トークン、API キー、パスワード等、漏れたら困るもの
- **variables**: 設定値 (URL、prefix 等)、漏れても困らないが値を変えたいもの

VITE_APP_URL や VITE_NSID_ROOT は variables。

---

## 5. テストは本物のコードで

- 簡易 mock SVG でサイズ計測 → 意味のない数字。本番カードは見た目も内容も全く違う
- e2e は **本番に近いデータ + 本番コンポーネント** で動かす
- API レスポンスを mock するなら少なくとも本物のスキーマ通り
- 「これでテスト書きました」と言う前に、その出力が本番で起きる現象を反映してるか自問する

---

## 6. force-push 禁止

`git push --force` または `--force-with-lease` は **dev / main では絶対禁止**。

- 自分のトピックブランチ (`feature/xxx` 等) では amend → force-push は OK
  (PR レビュー中に rebase + force-push で commit を整理する運用は許容)
- dev / main は共有ブランチなので force-push は履歴が壊れて他人を巻き込む
- 直近のコミットを書き直したい時は新しい commit で「revert」or「fixup」する

例外: ユーザーが明示的に「dev に force-push して」と言った場合のみ。

---

## 7. ハック・workaround の禁止

問題に当たったら **根本原因を調べる**。ぱっと見動くが本質的でない fix を入れない。

- 「`--no-verify` でフックを skip」「ETag 無視で常に再 fetch」「sleep で間に合わせ」 → NG
- 一時しのぎするなら必ずコメントで `// TODO: 本来は X を直すべき` と明記
- 「動いた」よりも「なぜ動いたか説明できる」を優先する

---

## 8. コミットメッセージ

Conventional Commits に従う:
- `feat(scope): ...` 新機能
- `fix(scope): ...` バグ修正
- `refactor(scope): ...` 挙動変えないリファクタ
- `chore(scope): ...` 設定 / 依存関係
- `docs(scope): ...` ドキュメントのみ
- `test(scope): ...` テスト追加 / 修正
- `perf(scope): ...` パフォーマンス改善

本文には **Why** を書く (What はコードを見れば分かる)。閾値変更や設計判断の理由はここに残す。

---

## 9. 作業開始 → push までのチェックリスト

実行前に毎回:

- [ ] `git branch --show-current` で **トピックブランチ** に居ることを確認 (dev / main 直接編集禁止)
- [ ] トピックブランチに居なければ `git checkout dev && git pull --rebase origin dev && git checkout -b feature/<topic>` で切る
- [ ] 修正の意図をユーザーと共有・合意済み
- [ ] ローカルで typecheck / build / test 緑
- [ ] 重要変更ならブラウザで動作確認 (PC + 必要ならモバイル実機)
- [ ] commit message に Why を書いた
- [ ] push 前にユーザーの明示許可を取った (本番に影響する変更は特に)
- [ ] PR 作成は `gh pr create --base dev --head feature/<topic>` で
- [ ] PR 作成後、**§1.5 の必須レビュー (3 並列 subagent) を回す**
- [ ] レビュー指摘の ★★★ をすべて PR 内で修正、★★ は対応 or issue 化、PR description の Review セクションに記録
- [ ] 全対応完了後にマージ承認 (= ここまで来てから merge ボタン)
- [ ] dev → main の本番リリース PR を作るのはオーナーがリリース判断したときだけ

---

## 10. 過去の事故事例 (繰り返さないため)

### 2026-04-25: モバイル LLM の早合点

iPhone Air で TinySwallow / Bonsai / SmolLM2 を試して全部 OOM。
**学び**: 「動くはず」で push せず、実機で必ず確認してから合流させる。

### 2026-04-28: main 直接編集して未検証コードを本番に

merge 後に main に居続けて 5 commits 直接編集 → push。
ユーザーは dev で確認しようとしたが反映されておらず混乱。
**学び**: merge したら即 dev に戻る。

### 2026-04-28: CI 失敗を放置して次作業

build 時必須にした env vars を CI workflow に追加し忘れ、CI 落ちまくった状態で別件作業継続。
**学び**: CI 緑は次の作業の前提。落ちたら即修正、放置しない。

### 2026-04-28: テストを簡易 mock で済ませる

実 JobCard の代わりに簡素な SVG でサイズ計測 → 53KB と報告。本物は 75KB。
**学び**: テスト対象は本物の component / データで。簡略化したら本番と乖離する。

### 2026-04-28: 個人 handle をソースに直書き

debug-card のデフォルトに `kojira.io` を直書き → 個人情報がリポジトリに残る。
**学び**: handle / DID / email 等の固有情報は環境変数か query 経由で。

### 2026-06-10: ブランチ運用を feature ブランチ方式へ移行

PR #25 までは dev に直 push して dev → main の PR でリリースしていたが、
複数人開発に備えて feature/<topic> → dev → main の 3 段運用に変更した。
それ以前の memory や doc に「dev で開発」と書かれている箇所は新ルール
(= トピックブランチで開発) に読み替えること。

### 2026-06-13: マージ前の必須レビューを運用化 (§1.5)

PR #25 で 3 並列レビューが実際に効いた (★★★ 13 件を未然に潰した) ので、
これを全 PR の運用ルールに昇格させた。マージ前に必ず 3 並列 subagent
レビューを回し、★★★ は PR 内で必ず修正、★★ は対応 or issue 化、★ は柔軟
の原則で対応する。PR description の Review セクションにどう処理したかを
記録する。
