---
version: alpha
name: Aozora Quest
description: ドラクエ風の半透明ウィンドウと青空グラデを核にした、Bluesky 投稿を RPG 化する Web クライアントの視覚アイデンティティ。
colors:
  primary: "#ffffff"
  accent: "#9fd7ff"
  accent-deep: "#5ea8d8"
  fg: "#ffffff"
  muted: "#c9d4e0"
  border: "#ffffff"
  window-bg: "#000000c7"
  window-bg-alt: "#000000e0"
  window-bg-content: "#000000b8"
  window-inner-border: "#ffffff59"
  danger: "#ff7272"
  stat-atk: "#ff6b3d"
  stat-def: "#3fa0ff"
  stat-agi: "#ffb83c"
  stat-int: "#b08cff"
  stat-luk: "#ff78aa"
  sky-top: "#4aa6e2"
  sky-mid: "#bee3f1"
  ground-top: "#9dd07f"
  ground-bottom: "#3f7a32"
typography:
  font-main:
    fontFamily: "'Hiragino Maru Gothic ProN', 'Hiragino Maru Gothic Pro', 'Noto Sans JP', sans-serif"
    fontSize: 1rem
    lineHeight: 1.6
    letterSpacing: 0.02em
  body:
    fontFamily: "{typography.font-main.fontFamily}"
    fontSize: 1em
    lineHeight: 1.6
    letterSpacing: 0.02em
  body-sm:
    fontFamily: "{typography.font-main.fontFamily}"
    fontSize: 0.85em
    lineHeight: 1.5
  body-xs:
    fontFamily: "{typography.font-main.fontFamily}"
    fontSize: 0.75em
    lineHeight: 1.4
  header:
    fontFamily: "{typography.font-main.fontFamily}"
    fontSize: 0.92em
    fontWeight: 700
    lineHeight: 1.2
  code:
    fontFamily: "ui-monospace, 'Courier New', monospace"
    fontSize: 0.9em
rounded:
  none: 0
  sm: 2px
  md: 3px
  full: 9999px
spacing:
  xs: 0.3em
  sm: 0.5em
  md: 0.8em
  lg: 1em
  xl: 1.6em
  shell-mobile: 420px
  shell-desktop: 680px
components:
  button:
    backgroundColor: "{colors.window-bg}"
    textColor: "{colors.fg}"
    rounded: "{rounded.sm}"
    padding: "0.35em 0.9em"
  button-hover:
    backgroundColor: "{colors.window-bg-alt}"
  button-active:
    backgroundColor: "{colors.window-bg-alt}"
  button-secondary:
    backgroundColor: "transparent"
    textColor: "{colors.fg}"
  dq-window:
    backgroundColor: "{colors.window-bg}"
    textColor: "{colors.fg}"
    rounded: "{rounded.md}"
    padding: "0.8em 1em"
  dq-window-compact:
    padding: "0.6em 0.8em"
  content-frame:
    backgroundColor: "{colors.window-bg-content}"
    textColor: "{colors.fg}"
    rounded: "{rounded.md}"
    padding: "1em"
  input:
    backgroundColor: "{colors.window-bg-alt}"
    textColor: "{colors.fg}"
    rounded: "{rounded.sm}"
    padding: "0.35em 0.6em"
    typography: "{typography.body-sm}"
  tab-active:
    backgroundColor: "#000000d9"
    textColor: "{colors.primary}"
    rounded: "{rounded.sm}"
  tab-inactive:
    backgroundColor: "#00000073"
    textColor: "#ffffffb3"
    rounded: "{rounded.sm}"
  link:
    textColor: "{colors.accent}"
  link-hover:
    textColor: "{colors.primary}"
---

## Overview

ドラクエ風の **冒険ログ感** が核。青空と草原のグラデを背景に、半透明の黒ウィンドウに白い太枠と四隅装飾を載せて、「広い世界に旅人の手帳が浮かんでいる」絵を作る。投稿は「冒険の記録」、フォロー相手は「パーティ仲間」、診断結果は「ステータス画面」というメタファーで、Bluesky の機能を RPG 文脈に翻訳する。

性格付け:
- **温かい・親しみ**: 角丸の太枠 + Maru Gothic の柔らかい字面。ピクセルアートではなく丸ゴシック RPG。
- **読みやすさ最優先**: 投稿テキストが主役。装飾は枠と背景に閉じ込め、本文領域には極力ノイズを入れない。
- **動きは短く**: ボタン押下は 60-80ms の極短アニメで「効いた」を即座に返す。ロード演出 (召喚の儀式・カードパック) のみ長尺で許容する。
- **ローカル完結の誇り**: AI 推論は端末内で動く。ユーザーに「外部に送られていない」と視覚的に伝えるためのバッジや色は使わず、UI 全体の落ち着きと一貫性で信頼感を出す。

## Colors

色は「空・大地・夜の手帳」の 3 系統で構成する。

- **空 (背景上部)**: `#4aa6e2` → `#bee3f1` のグラデで爽やかさ。雲を radial-gradient で薄く散らす。
- **大地 (背景下部)**: `#9dd07f` → `#3f7a32` のグラデで地に足が着いた印象。
- **手帳 (前景ウィンドウ)**: 黒半透明 `#000000c7` (= rgba 0,0,0,0.78) + 白枠。文字は基本 **白 (`#ffffff`)** で最大コントラスト。
- **強調 (accent)**: 淡い水色 `#9fd7ff`。リンクやフォーカスリングに使う。深い水色 `#5ea8d8` は accent の hover/visited 系で。
- **抑えた情報 (muted)**: `#c9d4e0` を timestamp / メタデータ / 補助テキストに。
- **危険 (danger)**: `#ff7272`。削除確認・エラー文言のみ。

### ステータス色

レーダーチャートとステータス表示専用の 5 色。**この用途以外で使わない**:

- 攻 (`#ff6b3d`) / 守 (`#3fa0ff`) / 速 (`#ffb83c`) / 知 (`#b08cff`) / 運 (`#ff78aa`)

## Typography

**Hiragino Maru Gothic ProN** を最優先、Mac/iOS 不在環境では Google Fonts の **Noto Sans JP** にフォールバックする。日本語の丸み + 漢字の安定感を両立させる狙い。

- **本文**: 1em (= ブラウザデフォルト 16px)、line-height 1.6、letter-spacing 0.02em
- **メタデータ・キャプション**: 0.85em (`body-sm`)
- **タグ・メトリクス**: 0.75em (`body-xs`)
- **見出し (ヘッダー)**: 0.92em、font-weight 700、影付き (上部 sticky バーは薄め)

font-size は **em ベース** で書く。html/body には絶対サイズを指定せず、ブラウザのユーザー設定とアクセシビリティを尊重する。「文字サイズ設定」(設定ページ → 表示設定) で `html { font-size: <50-150>% }` を動的に書き換えることで、すべての em が比例して伸縮する。スライダーは 1% で動かせて離した時に 5% 単位にスナップ、デフォルトは 100%。

例外: モバイル (max-width 767px) の `input/textarea/select` だけは `font-size: max(16px, 1rem)` を下限とする。iOS Safari は入力欄の実効フォントが 16px 未満だとフォーカス時に画面を自動ズームして `position:fixed`/`100dvh` レイアウトを壊すため。これは比例伸縮思想とのトレードオフで、文字サイズを縮小設定 (<100%) したユーザーでも入力欄は 16px に床貼りされる (拡大設定時は 1rem を尊重)。

## Layout

縦長のモバイル中心レイアウト。

- **app-shell**: 中央寄せ。`max-width: 420px` を基本、`@media (min-width: 768px)` で `680px` に拡張。それ以上には広げない (1 列の冒険ログという読み心地を保つため)。
- **header**: 上部 sticky。半透明グラデ + backdrop-blur。
- **content**: app-shell の中身を 1 枚の大きな DQ ウィンドウで包む。内側に置く個別ウィンドウは `.dq-window` でさらに二重枠にする (DQ で「持ち物」の中に「やくそう ×3」が表示される入れ子構造)。
  - *例外*: workspace のカラムはモバイル (<=767px) では本文幅を優先し、太枠・四隅装飾・peek を省いて全幅化する (横幅が枠に食われる問題への対処)。**カラム内のフィード投稿 (`.feed-post`) も枠を撤去して全幅のタイムライン行にし、区切りは下辺ヘアラインで示す** (背景同色で枠なしだと埋もれるため)。ただし board のクエストカード等、枠の色で状態 (承認待ち=accent / 期限切れ=muted) を示すカードは対象外 (枠を残す)。カラム送りは ▶/◀ のスワイプヒント。PC では従来どおり太枠カラム。詳細は `docs/16-multicolumn.md`。
  - *モバイル workspace は全面ダーク*: 上記に加え `.content` の余白と footer-nav の中央寄せピルを撤去し、header + タイムライン + footer をダークで画面いっぱいに敷き詰める (青空/草原の背景余白を出さない = 情報密度優先のオーナー判断)。footer は全幅フラッシュ + `env(safe-area-inset-bottom)` でホームインジケータを回避。**青空+草原に手帳が浮かぶ世界観は PC のみ** (モバイルで背景を出すよう差し戻さないこと)。
- **footer-nav**: 下部 sticky。`min(340px, 80%)` で中央寄せ。タブで「ホーム/通知/検索/自分」など主要 route を切替。

spacing は em ベースの 0.3 / 0.5 / 0.8 / 1.0 / 1.6em を主軸に。px 直書きは枠線・装飾 (3px border, 6px 四隅装飾) のみ。

## Elevation & Depth

シャドウは控えめ。**Tonal Layers** (透明度の重ね合わせ) で奥行きを出す:

- 背景: 不透明な空グラデ
- 中間: 半透明黒ウィンドウ (`#000000b8` ~ `#000000e0` = α 0.72 ~ 0.88)
- 前景: 白枠 + 4px のドロップシャドウ `0 4px 0 #00000059` (オフセットのみ、blur なしの「印刷物」風)
- 内側に `inset 0 0 0 1px #ffffff59` で内枠を入れて DQ の「二重枠」を再現

`blur` 系の影は header の backdrop-blur(2px) のみで他では使わない。RPG UI は「紙とインク」の世界観を維持する。

## Shapes

**ほぼ角張った RPG ウィンドウ**。

- 基本コンテナ (`dq-window`, `content`): border-radius **3px**
- 小要素 (button, tab, input, code): border-radius **2px**
- 角は装飾用に `::before` / `::after` で **6×6px の白い小四角** を四隅 (左上 + 右下) に貼ってドラクエの止め金具を再現
- 角丸を 8px 以上に上げない。やわらかく見えすぎるとブランドの「冒険感」が消える

## Components

### Button (`button`)

- 背景: `window-bg` (半透明黒)、枠: 白 3px、rounded 2px
- padding: `0.35em 0.9em`
- hover で `window-bg-alt` (より濃い黒) に
- **active 時**: `transform: translateY(1px) scale(0.985)` + 内側に深いシャドウ。タップしたら 60-80ms で必ず視覚反応を返す
- `button.secondary`: 背景透明、枠だけ白。並列ボタン群で副次アクションに

### DQ Window (`dq-window`)

主要コンテナ。3px 白枠 + 内側 1px の半透明白枠 + 4px の硬いドロップシャドウ。`compact` バリアントで padding と margin を 0.6em / 0.6em に詰める (タイムラインの投稿リスト等の高密度表示用)。

### Tab (`dq-tab` / `dq-tab.active`)

active = 濃い黒背景 + 白文字。inactive = 薄い黒背景 + 70% 白文字。押下時 `scale(0.985)` の沈み込み。

### Input (`input`, `textarea`, `select`)

背景: `window-bg-alt`、枠: 白 2px、rounded 2px。focus で枠が `primary` (純白) に。

### Link

下線は **dotted の 1px**、色は `accent`。hover で純白に切り替わる。本文中のクリッカブル要素を装飾的に主張しすぎない。

### Footer Nav

下部 sticky で常に手元に。`min(340px, 80%)` の幅で画面の親指届く範囲に主要 4 タブを置く。active 時は背景が `rgba(255,255,255,0.12)` に切替、押下時に `scale(0.94)` の即時フィードバック。

## Do's and Don'ts

- **Do** 装飾の色は基本 white + accent (淡水色) で完結させる。文字色に色を増やしたいときは muted (`#c9d4e0`) で調整する。
- **Don't** 黄色 (純粋な `#ffd700` 系) を装飾やアクションに使わない。RPG の世界観で黄色は **状態異常 (混乱・毒)** を連想させ、UX 上のアラートと干渉する。例外: `--color-agi` (`#ffb83c`) は「速さステータス」のレーダー色専用で、それ以外には流用しない。
- **Do** タップ・クリックの初動を 60-80ms 以内に視覚化する (transform + 色変化)。ロード演出は別物、ここは **絶対に短く**。
- **Don't** 角丸を 8px 以上に上げない。やわらかすぎる UI は世界観を壊す。
- **Do** 文字サイズは em / rem の相対単位で書く。`html` の font-size を将来ユーザー設定で変えても全体が比例して伸縮するようにする。
- **Don't** 投稿本文 (post body) の中に装飾色を混ぜない。引用 / リンク以外は読みやすさ最優先で純白テキスト + line-height 1.6 を維持。
- **Do** ステータス色 (`stat-atk` 〜 `stat-luk`) はレーダーチャート + ステータスバー以外で使わない。色の意味が拡散すると診断結果の認識性が落ちる。
- **Don't** drop shadow の blur を大きく取らない。「印刷物・紙」の硬い影 (`0 4px 0`) を維持する。マテリアル風のふわっとした影は使わない。
- **Do** ヘッダーには text-shadow を付ける (`2px 2px 0 rgba(0,0,0,0.5)`)。背景に空グラデが透けるので、文字の輪郭を出すことで可読性を確保。
- **Don't** 個人情報 (handle / DID / email) を CSS や component に直書きしない。デモ・テストデータは環境変数経由で。
