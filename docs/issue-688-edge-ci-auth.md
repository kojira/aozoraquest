# #688: dev の edge 配備を手動運用に揃え、CI の型検査・テストを残す

## 原因・最新承認

報告run [35282500629](https://github.com/kojira/aozoraquest/actions/runs/35282500629) は dev の型検査・unit test に成功し、Deploy だけが `CLOUDFLARE_API_TOKEN` 未設定で失敗した。手動配備で補っても CI の失敗は残り、繰り返し届く失敗メールでユーザーが困っている。

当初の「専用tokenを登録して自動配備を修復する」案は撤回。ユーザーが **dev の edge 自動配備を外してよい** と明示承認した。今回のための API token 登録は不要であり、ローカル認証を GitHub へコピーしない。

## 実装前設計

- `.github/workflows/edge-deploy.yml` の **Deploy step だけ**に `github.ref == 'refs/heads/main'` 条件を付ける。dev push / dev workflow_dispatch では型検査と unit test を実行し、配備はしない。
- main では従来どおり同じ Environment / secrets / Wrangler action の `deploy` を実行する。main/prod の設定・認証・配備には手を触れない。
- workflow 全体の無効化、テスト skip、continue-on-error、通知設定変更は行わない。実際の型検査・テスト失敗は引き続き失敗として通知される。
- 既存の trigger / paths / concurrency / job / Environment は保持。web の Cloudflare Workers Builds も変更しない。
- アプリ、API、保存データ、権限、依存ライブラリの変更はない。UI/スキーマ移行/実データ復旧は対象外。

## dev の手動配備

1. 対象commitと配備先を確認し、対象の CI（web と edge の型検査・テスト）が成功してから配備する。失敗中の gate を手動配備で成功扱いにしない。
2. 最新の配備対象コードを使い、既存のローカル Wrangler ログイン認証と対象accountの明示指定を用いる。既存手順は [環境分離runbook](22-edge-env-separation.md) を参照する。`apps/edge` でのコマンドは次のとおり。

   ```sh
   pnpm exec wrangler deploy --env dev --keep-vars
   ```

   出力先 `aozoraquest-edge-dev` と dev 用 KV binding を確認する。`--keep-vars` は既存dashboard varsを保持するためで、秘密の値をログへ出さない。prodへのコマンド置換や認証の転用はしない。
3. edge/core と web を同時変更し、新しいwebが新しいedgeに依存するときは、レビューと対象headのCI成功後に **edge-devを先行手動配備してからdevへmerge** し、web自動配備につなぐ。順序が逆でも互換性を保つ変更なら通常のmerge後に必要なedge手動配備を行う。webの配備完了だけでedge反映済みと報告しない。
4. 配備commit、Worker名、稼働version、実施した確認を記録する。CI成功と手動配備成功は分けて報告する。このCI設定変更自体にedge実配備は不要。

## 検証・受入

- YAMLをparseし、元のdev workflowと比較する。Deploy以外のtrigger/job/steps/Environment/concurrencyが同じであること。
- devでは型検査とunit testが無条件で残り、Deploy条件がfalseになること。mainではDeploy条件がtrueで、実行コマンド・action・secrets等が元と同じこと。featureからのdispatchは元のjob条件どおり対象外。
- 独立レビューと最新PR headのCI成功後にdevへmergeする（本担当はPR更新まで）。変更されたworkflowによる **新しいdev run** で型検査・unit test成功、Deploy skipped、job successを確認するまで運用反映完了とは報告しない。
- 旧失敗runの再実行は古いworkflowを使い同じ認証失敗を招くため行わない。過去の失敗履歴・既に送られたメールは消さない。
- main/prod、GitHub Secrets、メール設定、実PDSを変更しない。mainの認証状態は今回の修復対象ではなく、本番CI成功を保証しない。

## 変更方針の履歴

最初のcommitはdev自動配備への`--keep-vars`追加とSecret登録手順だった。上記のユーザー承認に従い、本書を実装前に更新し、PR #689 / Issue #688を同じ問題の新しい解決方針へ揃える。元の認証不足という事実は保持するが、Secret登録を作業のブロッカーにはしない。
