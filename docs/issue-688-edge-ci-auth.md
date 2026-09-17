# #688: edge-dev 自動配備の認証設定を完了する

## 原因と対象

ユーザー報告の Actions run `35282500629` (`dev`, `c08b4f149fbd0e114afb659339bd26d6a37747a2`) は edge の型検査・unit test に成功し、Deploy だけが `CLOUDFLARE_API_TOKEN` 未設定で失敗した。

調査時点では repository secrets と Environment `dev` / `main` の secrets はすべて空。所有者は個人アカウントなので organization secrets の継承はない。workflow の Environment 選択と secret 名は正しく、名前変更や Environment 追加では直らない。手動配備の成功は Actions 修復の代用にしない。

本件は dev の認証設定・配備確認のみ。本番/main、Wrangler の更新、他の CI、アプリ/API/保存データ/権限モデルは変更しない。失敗を skip・continue-on-error で隠さない。

## 実装前方針と承認

1. 既存の `environment: dev` と `secrets.CLOUDFLARE_API_TOKEN` / `secrets.CLOUDFLARE_ACCOUNT_ID` を使う。コードに token や account ID を追加しない。
2. ユーザーが専用 token を GitHub の **Environment `dev`** に直接登録する。取得・作成・権限拡張の自動実行、個人ブラウザや Wrangler OAuth token の流用は禁止。
3. 初回自動配備で、これまでの手動配備が `--keep-vars` で保持していた dashboard の稼働 vars を失わないよう、**dev のコマンドだけ** `deploy --env dev --keep-vars` にする。`main` の `deploy` は変更しない。親が実装前にこの限定変更を承認済み。
4. 未設定の間に再実行しても同じ認証エラーになるため、設定を待つ。レビュー前に merge しない。

## ユーザーによる一度だけの設定

### Cloudflare

Cloudflare dashboard の API Tokens で、この配備専用の custom token を用意する。

- Permissions: **Account / Workers Scripts / Edit**（API 名では Workers Scripts Write）。
- Account Resources: **Include / Specific account** で、現在 `aozoraquest-edge-dev` がある account だけを指定する。
- 全 account、全 zone、Global API Key は使わない。この Worker は既存の `workers.dev` と既存 KV binding を使い、zone route や KV namespace を新規作成しない。従って今回の設定に zone 編集・KV データ編集・API token 作成権限を足さない。
- account ID は Cloudflare dashboard で同じ account の ID を確認する。

この token は **Worker 単位の制限ではなく account 内の Workers を編集できる**。GitHub の Environment を `dev` に限定することは main ジョブへの配布を防ぐが、Cloudflare の token 自体を dev Worker 専用権限にはしない。その権限範囲を確認して作成する。後で権限エラーが出た場合も広い template を丸ごと付与せず、失敗した API と必要権限を確認して判断する。

権限の根拠: Cloudflare の script upload API は Workers Scripts Write を要求する。現在固定された Wrangler 3.114.17 の deploy は、設定済み KV namespace ID を binding として渡す。既存 ID は provision 不要として扱われ、今回 KV 作成・値の読み書きは行わない。account ID を明示するため account 探索用の権限も追加しない。実 token による Actions 成功は登録後に確認する。

### GitHub

[Repository settings → Environments](https://github.com/kojira/aozoraquest/settings/environments) → **dev** → **Environment secrets** に以下を追加する。

| 名前 | 登録するもの |
|---|---|
| `CLOUDFLARE_API_TOKEN` | 上記の専用 API token |
| `CLOUDFLARE_ACCOUNT_ID` | 対象 Cloudflare account の ID |

値をチャット、Issue、PR、ソース、ログへ貼らない。登録後は「dev の2項目を登録した」とだけ伝える。repository 全体や `main` に複製せず、既存 Worker secrets / OAuth / KV は変更しない。

## 検証・受入

- 変更差分が dev の `--keep-vars` と本件の手順だけであること、main コマンド・既存 test gate・secret 参照が不変であることを確認する。
- 独立レビュー後、設定完了を **名前と更新日時だけ** で確認する。token 値を検査ログへ出さない。
- PR merge 時点の最新 `dev` SHA を確認する。workflow 変更による dev push の自動 run を使い、既存失敗 run を無条件に再実行しない。
- 設定だけの再検証が必要なら最新 `dev` に対して `gh workflow run edge-deploy.yml --ref dev`。実行前に `gh api repos/kojira/aozoraquest/commits/dev --jq .sha` を確認し、run の head SHA が一致することを確認する。他の配備が進んでいたら古い run で巻き戻さない。
- Actions の Typecheck・Unit tests・Deploy がすべて成功し、出力対象が `aozoraquest-edge-dev`、dev 専用 KV binding であることを確認する。稼働 version/deployment を読取確認する。
- `--keep-vars` は dashboard の既存 vars を保持する。明示した wrangler vars は引き続き設定値が適用される。Worker secrets は deploy で削除されない。秘密の値を表示せず、必要な binding 名と対象だけを確認する。
- main SHA と本番 deployment が不変であることを確認する。新 token の権限を試すための本番操作は行わない。
- 成功するまで「CI修復完了」としない。認証エラーなら token/Environment、権限エラーなら失敗した API を切り分ける。手動配備による緑扱いや失敗ジョブの削除は禁止。

## 参考

- [報告された失敗run](https://github.com/kojira/aozoraquest/actions/runs/35282500629)
- [Cloudflare GitHub Actions authentication](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/)
- [Script upload API permissions](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/methods/update/)
- [Wrangler configuration / keep_vars](https://developers.cloudflare.com/workers/wrangler/configuration/)
- [既存環境分離runbook](22-edge-env-separation.md)
