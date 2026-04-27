# aozoraquest プロジェクト 開発ルール

プロとして守るべき最低限のルールを以下に記す。違反したらすぐ止めて修正する。

(プロジェクトの現状や公開範囲はオーナー (kojira) のみが定義する。Claude が
勝手に「本番運用中」「友人が使ってる」等と性質を決めつけない。確認が必要なら聞く)

---

## 1. ブランチ運用

### 厳守事項

- **`main` ブランチは本番デプロイ専用** (Cloudflare Workers Builds が main push で `aozoraquest.app` に自動 deploy)。
  直接 commit / push / 編集してはいけない。
- すべての修正は **`dev` ブランチで行う**。`dev` push で `dev.aozoraquest.app` に自動 deploy されるので、
  そこで動作確認してから main にマージする。
- `git checkout main` の後にファイル編集してはいけない。merge の操作だけが許される。
- merge 完了直後に **必ず `git checkout dev` で戻る**。main に居続けない。

### 作業開始時のルーティン

```bash
git branch --show-current   # main だったら止める
git status                   # uncommitted を確認
git pull --rebase origin dev # 最新を取り込んでから着手
```

### main へのマージは PR 経由が基本

`git checkout main && git merge dev && git push origin main` の直接マージは緊急時のみ。
通常は GitHub の Pull Request で:
1. dev → main の PR を作成 (`gh pr create --base main --head dev`)
2. CI 緑を確認
3. ユーザー (オーナー) のレビューと承認
4. squash or merge ボタン

`main` ブランチは GitHub の branch protection rule で守る:
- Require pull request before merging
- Require status checks to pass (CI)
- Restrict who can push (admin のみ + force-push 禁止)

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

`git push --force` または `--force-with-lease` は dev/main では原則禁止。

- 自分の作業ブランチ (feature branch) では amend → force-push は OK
- dev はチームで共有しているとみなす (将来複数人になる時のため)
- 直近のコミットを書き直したい時は新しい commit で「revert」or「fixup」する

例外: ユーザーが明示的に「amend して force-push して」と言った場合のみ。

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

- [ ] `git branch --show-current` で `dev` か確認
- [ ] `git pull --rebase origin dev` で最新を取り込んだ
- [ ] 修正の意図をユーザーと共有・合意済み
- [ ] ローカルで typecheck / build / test 緑
- [ ] 重要変更ならブラウザで動作確認 (PC + 必要ならモバイル実機)
- [ ] commit message に Why を書いた
- [ ] push 前にユーザーの明示許可を取った (本番に影響する変更は特に)

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
