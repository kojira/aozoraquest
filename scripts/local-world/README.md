# ローカルだけで遊ぶあおぞらワールド (D-LOCAL-PLAY-001 / #1018)

このマシンの中だけで PLC・PDS・edge・web を動かし、ふつうの OAuth ログインでワールドを最初から遊ぶ。
**dev / 本番の PDS には書かない**。dev の管理者 repo の `app.aozoraquest.dev.world.*` (と NPC 画像の blob) を
無認証で**読んで**ローカルの管理者 repo に写すだけ。

```sh
pnpm local:world               # 起動。ブラウザで http://127.0.0.1:9999/world
pnpm local:world fresh-player  # プレイヤー (player.test / player2.test) を作り直して起動
pnpm local:world reset         # .state/ を全部消す
```

ログインはハンドル `player.test` (2 人目は `player2.test`)。パスワードは `.state/accounts.json` (ローカル専用)。

## 中身

| もの | 場所 | 備考 |
|---|---|---|
| PLC | http://localhost:2582 | @atproto/dev-env の TestPlc。操作ログを `.state/plc.json` に残す。DID document の鍵を Multikey に直して返す (network.mjs) |
| PDS + OAuth 認可サーバー | http://localhost:2583 | TestPds。sqlite と blob は `.state/pds/` |
| edge | http://127.0.0.1:8788 | `wrangler dev` (edge.wrangler.toml)。KV はローカル。鍵は seed.mjs がローカル用に作る |
| web | http://127.0.0.1:9999 | `vite dev`。つなぎ先は `.state/web.env` |

アカウント: `aqadmin.test` (world.* の持ち主)、`aqserver.test` (gameState の持ち主 = edge のサーバーアカウント)、
`player.test` / `player2.test`。

## ローカルで無いもの

- **AppView** (タイムライン・プロフィール・投稿検索・通知) は立てない。ワールドは PDS と edge だけで動く。
  SNS の画面は「うまく読み込めませんでした」になる。
- **気質診断** は投稿の取得 (AppView) が要るので回せない。seed.mjs が固定の診断 (warrior) を置く。
