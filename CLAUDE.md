# aozoraquest プロジェクト ローカルルール

## 絶対に守るべきルール

### ブランチ運用 (最優先)

このリポジトリは Cloudflare Workers Builds 経由で **`main` ブランチが本番 (aozoraquest.app) に自動デプロイされる**。
未検証コードを main に乗せると、友人が日常的に使っている本番サービスを破壊する。

**ルール:**

1. **`main` ブランチを直接編集してはいけない**
   - `git checkout main` した後にファイル編集しない
   - main は merge を受け取るだけのブランチ
2. **すべての修正は `dev` ブランチで行う**
   - `dev` ブランチで commit / push
   - `dev.aozoraquest.app` で動作確認 (Cloudflare Workers Builds が `dev` 専用 project に自動 deploy)
3. **main へのマージは確認後のみ**
   - dev で動作 OK + ユーザーの明示的な許可があったときだけ
   - 手順: `git checkout main && git merge dev && git push origin main`
4. **merge 後は必ず dev に戻る**
   - `git checkout main` の作業が終わったら直ちに `git checkout dev`
   - main に居続けてファイル編集する状況を作らない

#### 過去の事故事例 (2026-04-28)

「mainにpushして」の指示で merge したあと、main に居続けたまま 5 commits を直接編集 → push して **未検証コードを本番デプロイ** した。
ユーザーは dev.aozoraquest.app で動作確認しようとしていたが、dev には何もマージされていなかったため変化が見えず混乱を招いた。

#### 作業開始時の確認

修正を始める前に必ず:
```bash
git branch --show-current
```
を確認し、`main` だったら `git checkout dev` してから着手する。

---

## 本番に関わる操作の前に確認

- `git push origin main`
- Cloudflare deploy 設定の変更
- 環境変数 (VITE_NSID_ROOT, VITE_APP_URL 等) の変更

これらは本番に直接影響するため、ユーザーの明示的な「OK」を得てから実行する。
