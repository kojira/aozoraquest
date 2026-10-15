# #696 リセット後のHUD/戦闘の食い違い + 村人の見た目 + Blueskyちゃんの導入

## 承認と範囲
オーナー承認済みの 1 PR。範囲外: edge・GameState・保存schema・spawnの変更、画像の同梱、main/本番、配備、実PDSへの書込み。

## 1. リセット後の HUD と戦闘の一致
- 原因: 管理ダッシュボードの「はじめから」(`resetOnboarding`) はサーバー状態 (gameState の jobXp、analysis の XP) を消すが、
  `use-job-xp` / `use-self-diagnosis` のモジュールキャッシュは同じ DID のまま残る。HUD は古い jobXp (例 Lv14) で最大 HP/MP を出し、
  戦闘はサーバー (Lv2) で始まるので食い違う。
- 修正: `resetOnboarding` の最後 (サーバーリセット成功後) で `refreshJobXp()` と `refreshSelfDiagnosis()` を呼び、
  キャッシュを捨ててサーバー/PDS から読み直す (購読中の画面にも伝わる。読み直しの失敗は各 hook 内で握る。jobXp は次の読み込みで取り直す。診断はページを読み直すと取り直す)。
  途中のステップで失敗した場合はキャッシュを残す (サーバー状態も旧のまま)。
- 固定するテスト (`onboarding-reset-caches.test.ts`): Lv の高い jobXp をキャッシュした状態でリセット → キャッシュが
  リセット後のサーバー state を読み直し、そこから出す HUD の Lv/最大HP/MP が同じ state から作る戦闘 (`startBattle`) の Lv/HP/MP と一致する。

## 2. 村人の標準の絵
`starterTownNpcs()` に `spritePreset` を付ける: むらおさ・おじいさん=`old-man`、やどやの おかみ=`middle-aged-woman`、
なんでも屋の むすめ=`young-woman`、こども=`boy`。Blueskyちゃんは `bluesky` のまま。
staging への反映は従来どおり `/admin/npcs`「ふたばの村の村人を入れる」→ 保存。

## 3. 目覚めの導入 (Blueskyちゃん)
`ONBOARDING_LINES` を 語り 2 行 (既存) → 駆け寄った Blueskyちゃん (話者は Blueskyちゃんのみ。ブルスコンは出ない) の 4 窓:
1. だいじょうぶ？ 村の まえで たおれてたんだよ。
2. マップを おしたまま ゆびを うごかすと あるけるよ。
3. じぶんを ちょんと おすと コマンドが ひらくの。村の ひとに ぶつかると おはなし できるよ。
4. 村に はいって、いどのそばの むらおさに あって。わたしも あとで いくね。
ひらがな主体・分かち書き。兄や正体の示唆は入れない。

会話イラスト: NPC 会話と同じ `DialogueWindow` の `portrait`。管理データの NPC `futaba-bluesky` の `portraitImage` を
`npcImageUrl(id, 'portrait', portraitImage)` で出す。未保存なら portrait なし、読込失敗は既存 `NpcPortrait` の onError で画像なし。
どちらでも会話は続く。画像は同梱しない。語りの 2 窓は portrait なし (話者なし)。

やどやの おかみの最初の一言を「Blueskyちゃんが みつけた たびびとだね。よそから きたんだろう？」に最小修正 (Blueskyちゃんが見つけた流れと整合)。

## 検証
- web vitest: リセット後キャッシュ破棄と HUD/戦闘一致。
- core vitest: 既存の村人配置/セリフ長テスト + 村人の標準の絵。
- E2E (隔離 fixture、390px): opening-story (語り→Blueskyちゃん4窓、portrait あり/読込失敗)、tutorial (6窓)、admin-npc-placement。
  スクリーンショットは repo 外 `pi-work/assets/aozora-fix-695/`。
- 実devログイン・実機は未実施 (PRまで)。
