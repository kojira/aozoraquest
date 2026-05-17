/**
 * 診断結果を 1 枚の SVG カード (MTG 風) として描く。
 * 出力は 768×1100 (約 63:88 比)。rasterize 時に 2x = 1536×2200 まで引ける。
 *
 * カードは self-contained SVG: 外部 CSS や font に依存せず、そのまま PNG に
 * rasterize できる。ジョブ別の art だけ public/card-art/{archetype}.(png|jpg)
 * から <image> で読む (任意)。枠装飾は全て SVG で描画。
 *
 * レイアウトは MTG の典型に倣った 5 段構成:
 *   1. Title bar  (name + LV)
 *   2. Art frame
 *   3. Type line  ("旅人 — {job}")
 *   4. Rules box  (cog keywords + stats + flavor italic)
 *   5. 右下 P/T 相当 (dom-aux) + footer (handle, date)
 *
 * カード枠は rarity 色 + 金縁 + 4 隅装飾でプログラマティックに生成。
 * 旧 AI 生成枠画像 (/card-art/frame-{rarity}-*.jpg) は使わない。
 */

import type { CardType, Color, DiagnosisResult, ManaCost, Rarity } from '@aozoraquest/core';
import {
  CARD_TYPE_LABEL,
  COLORS,
  frameColorOf,
  JOBS_BY_ID,
  jobDisplayName,
  manaCostTotal,
  RARITY_COLOR,
  RARITY_LABEL,
} from '@aozoraquest/core';
import { forwardRef } from 'react';

const W = 768;
const H = 1100;

const PADX = 36;
const PADY = 36;

// 各セクションの height / y 座標
const TITLE_Y = PADY;                  // 36
const TITLE_H = 72;
const ART_Y = TITLE_Y + TITLE_H + 8;   // 116
const ART_H = 456;
const TYPE_Y = ART_Y + ART_H + 10;     // 582
const TYPE_H = 56;
const BODY_Y = TYPE_Y + TYPE_H + 10;   // 648
const BODY_H = H - BODY_Y - PADY - 20; // 20 は footer 分
const FOOTER_Y = H - PADY - 4;
const PT_W = 100;
const PT_H = 60;

// 配色
const INK = '#2a1a08';            // 主要なインク色 (強め)
const INK_SOFT = '#5a3f1d';
const PANEL_FILL = 'rgba(246, 236, 208, 0.94)';  // クリーム (rarity 色がうっすら透けるバランス)
const PANEL_STROKE = '#4a3416';
const FRAME_OUTER = '#0e0600';    // カード最外周の縁 (純黒に近い深い焦げ茶)
const ACCENT = '#7a5220';         // 金寄り

/**
 * rarity 別の枠スタイル。
 * - bodyGradId: 枠の主色 (multi-stop メタリック)
 * - shimmer: 上に重ねるシマー層 (複数可、UR/SSR は 2 重で深みを出す)
 * - trimId: 外側ダブルラインの色 (silver / gold / rainbow)
 * - sparkleCount: 枠帯にちりばめる星の数 (上位レアほど多い)
 * - bigSparkles: 大粒の + 字型スパークルを混ぜるか (SSR/UR のみ)
 */
type RarityFrameStyle = {
  bodyGradId: string;
  shimmer: Array<{ id: string; opacity: number }>;
  trimId: 'silverTrim' | 'goldTrim' | 'rainbowTrim';
  sparkleCount: number;
  bigSparkles: boolean;
};

/** frameColor (manaCost から派生) ごとの body gradient id。
 *  単色 → その色の枠、複数色 → gold、無色 → silver (colorless)。 */
const COLOR_FRAME_STYLES: Record<'colorless' | Color | 'gold', { bodyGradId: string }> = {
  colorless: { bodyGradId: 'frameColorless' },
  W: { bodyGradId: 'frameW' },
  U: { bodyGradId: 'frameU' },
  B: { bodyGradId: 'frameB' },
  R: { bodyGradId: 'frameR' },
  G: { bodyGradId: 'frameG' },
  gold: { bodyGradId: 'frameGold' },
};

const FRAME_STYLES: Record<Rarity, RarityFrameStyle> = {
  common:   { bodyGradId: 'commonGrad',   shimmer: [],                                              trimId: 'silverTrim', sparkleCount: 0,  bigSparkles: false },
  uncommon: { bodyGradId: 'uncommonGrad', shimmer: [],                                              trimId: 'silverTrim', sparkleCount: 0,  bigSparkles: false },
  rare:     { bodyGradId: 'rareGrad',     shimmer: [{ id: 'rareShimmer',  opacity: 0.22 }],         trimId: 'goldTrim',   sparkleCount: 0,  bigSparkles: false },
  srare:    { bodyGradId: 'srareGrad',    shimmer: [{ id: 'srareShimmer', opacity: 0.32 }],         trimId: 'goldTrim',   sparkleCount: 8,  bigSparkles: false },
  ssr:      { bodyGradId: 'ssrGrad',      shimmer: [{ id: 'ssrShimmer',   opacity: 0.45 },
                                                    { id: 'ssrShimmer2',  opacity: 0.30 }],         trimId: 'goldTrim',   sparkleCount: 20, bigSparkles: true  },
  ur:       { bodyGradId: 'urGrad',       shimmer: [{ id: 'urShimmer',    opacity: 0.55 },
                                                    { id: 'urShimmer2',   opacity: 0.40 }],         trimId: 'rainbowTrim', sparkleCount: 36, bigSparkles: true  },
};


export interface JobCardProps {
  result: DiagnosisResult;
  /** 能力キーワード名 (例: 潜影) */
  effectName: string;
  /** 能力の発動コスト (例: このカードをタップする。) 空文字または "なし" でパッシブ扱い */
  effectCost: string;
  /** 能力の説明文 */
  effectDescription: string;
  /** italic の詩文 */
  flavorText: string;
  /** フレーバーの発言者 (フォロイーの表示名など、"— {名前}" で右下寄せ)。 */
  flavorAttribution?: string | undefined;
  /** カードレアリティ (6 段階)。シマー強度・スパークル個数に使う。 */
  rarity: Rarity;
  /** @deprecated プログラマティック枠に置き換えたので未使用。PDS 互換のため残置。 */
  frameVariant?: 1 | 2;
  /** カードタイプ (creature/artifact/instant/sorcery)。type line に和訳ラベルを表示。 */
  cardType?: CardType;
  /** 召喚マナコスト (右上に表示)。 */
  manaCost?: ManaCost;
  /** アビリティ起動コスト (description の前にマナアイコンで表示)。null = passive。 */
  abilityCost?: ManaCost | null;
  /** カード名 (LLM 生成、例: 「忍び寄る混沌」)。タイトル位置に表示。未指定なら displayName へ fallback。 */
  cardName?: string;
  /** ユーザー表示名。cardName が無いときの fallback と、a11y/footer 用に保持。 */
  displayName: string;
  handle: string;
  /** ジョブ固有の背景イラスト (例: '/card-art/sage.jpg') */
  artSrc?: string | undefined;
  /** 本人の Bluesky アバター画像 (円形クロップで中央に配置) */
  avatarSrc?: string | undefined;
  className?: string;
  style?: React.CSSProperties;
}

export const JobCard = forwardRef<SVGSVGElement, JobCardProps>(function JobCard(props, ref) {
  const { result, effectName, effectCost, effectDescription, flavorText, flavorAttribution, rarity, cardType, manaCost, cardName, displayName, handle, artSrc, avatarSrc, className, style } = props;
  const titleText = cardName ?? displayName;
  const rarityColor = RARITY_COLOR[rarity];
  const rarityLabel = RARITY_LABEL[rarity];
  const frameStyle = FRAME_STYLES[rarity];
  const job = JOBS_BY_ID[result.archetype];
  const jobName = jobDisplayName(result.archetype, 'default');
  // Type line 表示用ラベル (creature/instant/sorcery/artifact の和訳)。指定無しは「クリーチャー」。
  const cardTypeLabel = cardType ? CARD_TYPE_LABEL[cardType] : CARD_TYPE_LABEL.creature;
  // 色アイデンティティ。manaCost から派生して枠主色に反映する。
  // 単色 → その色の枠 / 複数色 → gold / 無色 → silver。
  const frameColor = manaCost ? frameColorOf(manaCost) : 'colorless';
  const colorStyle = COLOR_FRAME_STYLES[frameColor];

  // 円形アバターの配置 (art frame 中央)
  const AVATAR_CX = W / 2;
  const AVATAR_CY = ART_Y + ART_H / 2;
  const AVATAR_R = Math.min(ART_H, W - 2 * (PADX + 14)) * 0.32;

  return (
    <svg
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      xmlnsXlink="http://www.w3.org/1999/xlink"
      viewBox={`0 0 ${W} ${H}`}
      className={className}
      style={style}
    >
      <defs>
        {/* === Card frame の defs ===
            - bodyGrad-*: rarity 別の枠主色 (multi-stop メタリック)
            - shimmer-*: rarity 別のシマー層 (光沢の色味と方向を変える)
            - silverTrim/goldTrim/rainbowTrim: 外側ダブルラインの色
            - frameLight: 上から光が当たって下が落ちる擬似 3D
        */}
        <linearGradient id="frameLight" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgba(255,255,255,0.22)" />
          <stop offset="35%" stopColor="rgba(255,255,255,0)" />
          <stop offset="100%" stopColor="rgba(0,0,0,0.4)" />
        </linearGradient>

        {/* ─── 枠主色 (rarity 別 multi-stop) ─── */}
        <linearGradient id="commonGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#9a8e80" />
          <stop offset="50%" stopColor="#7a7066" />
          <stop offset="100%" stopColor="#3a3028" />
        </linearGradient>
        <linearGradient id="uncommonGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#7aaa88" />
          <stop offset="50%" stopColor="#4c7a5a" />
          <stop offset="100%" stopColor="#1c3024" />
        </linearGradient>
        <linearGradient id="rareGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#7ea2d4" />
          <stop offset="50%" stopColor="#5c7aa8" />
          <stop offset="100%" stopColor="#1e3a64" />
        </linearGradient>
        <linearGradient id="srareGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#c388e4" />
          <stop offset="50%" stopColor="#9e60c0" />
          <stop offset="100%" stopColor="#4a1a70" />
        </linearGradient>
        <linearGradient id="ssrGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#f9d670" />
          <stop offset="40%" stopColor="#c49833" />
          <stop offset="100%" stopColor="#5a3a08" />
        </linearGradient>
        <linearGradient id="urGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ff96b6" />
          <stop offset="40%" stopColor="#c93c6a" />
          <stop offset="100%" stopColor="#4a0818" />
        </linearGradient>

        {/* ─── color identity 別の枠主色 (manaCost から派生)。
              rarity 別の grad と並列で、frameColor 駆動で使い分け。 ─── */}
        <linearGradient id="frameColorless" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#d8d4cc" />
          <stop offset="50%" stopColor="#807a72" />
          <stop offset="100%" stopColor="#2a2520" />
        </linearGradient>
        <linearGradient id="frameW" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#f8efce" />
          <stop offset="50%" stopColor="#bca870" />
          <stop offset="100%" stopColor="#5a4810" />
        </linearGradient>
        <linearGradient id="frameU" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#86b8e4" />
          <stop offset="50%" stopColor="#3a5e98" />
          <stop offset="100%" stopColor="#0c1c40" />
        </linearGradient>
        <linearGradient id="frameB" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#6e5078" />
          <stop offset="50%" stopColor="#2c1838" />
          <stop offset="100%" stopColor="#080208" />
        </linearGradient>
        <linearGradient id="frameR" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#e88060" />
          <stop offset="50%" stopColor="#a02818" />
          <stop offset="100%" stopColor="#280408" />
        </linearGradient>
        <linearGradient id="frameG" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#7eb88a" />
          <stop offset="50%" stopColor="#2e6a3e" />
          <stop offset="100%" stopColor="#0a2412" />
        </linearGradient>
        <linearGradient id="frameGold" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#fbe488" />
          <stop offset="50%" stopColor="#c89940" />
          <stop offset="100%" stopColor="#603810" />
        </linearGradient>

        {/* ─── シマー層 (上に重ねる光沢) ─── */}
        <linearGradient id="rareShimmer" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#a8d4ff" />
          <stop offset="50%" stopColor="#ffffff" />
          <stop offset="100%" stopColor="#7eb5e8" />
        </linearGradient>
        <linearGradient id="srareShimmer" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#ffa8e8" />
          <stop offset="50%" stopColor="#ffe0ff" />
          <stop offset="100%" stopColor="#a880ff" />
        </linearGradient>
        {/* SSR: 金スイープ (水平、中央に強い白ハイライト) */}
        <linearGradient id="ssrShimmer" x1="0" y1="0" x2="1" y2="0.3">
          <stop offset="0%" stopColor="#fff8d0" stopOpacity="0" />
          <stop offset="35%" stopColor="#fff8d0" stopOpacity="0.55" />
          <stop offset="50%" stopColor="#ffffff" stopOpacity="0.95" />
          <stop offset="65%" stopColor="#fff8d0" stopOpacity="0.55" />
          <stop offset="100%" stopColor="#fff8d0" stopOpacity="0" />
        </linearGradient>
        {/* SSR 第 2 層: 縦方向の暖色グロー */}
        <linearGradient id="ssrShimmer2" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ffd87a" stopOpacity="0.5" />
          <stop offset="50%" stopColor="#ffa854" stopOpacity="0.1" />
          <stop offset="100%" stopColor="#a86510" stopOpacity="0.4" />
        </linearGradient>
        {/* UR: 完全プリズム虹 (対角) */}
        <linearGradient id="urShimmer" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%"   stopColor="#ff80c0" />
          <stop offset="20%"  stopColor="#ffd57a" />
          <stop offset="40%"  stopColor="#a5ff8a" />
          <stop offset="60%"  stopColor="#80e8ff" />
          <stop offset="80%"  stopColor="#c080ff" />
          <stop offset="100%" stopColor="#ff80c0" />
        </linearGradient>
        {/* UR 第 2 層: 反対方向の白ハイライト (ホログラフィック干渉) */}
        <linearGradient id="urShimmer2" x1="1" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor="#ffffff" stopOpacity="0.7" />
          <stop offset="35%"  stopColor="#ffffff" stopOpacity="0.05" />
          <stop offset="65%"  stopColor="#ffffff" stopOpacity="0.05" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0.7" />
        </linearGradient>

        {/* ─── トリム (外側ダブルライン用) ─── */}
        <linearGradient id="silverTrim" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor="#f4f6fa" />
          <stop offset="40%"  stopColor="#c0c4ca" />
          <stop offset="70%"  stopColor="#7a7e84" />
          <stop offset="100%" stopColor="#3a3e44" />
        </linearGradient>
        <linearGradient id="goldTrim" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor="#f8e493" />
          <stop offset="40%"  stopColor="#e1b04a" />
          <stop offset="70%"  stopColor="#a87420" />
          <stop offset="100%" stopColor="#6a4310" />
        </linearGradient>
        <linearGradient id="goldTrimHoriz" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%"   stopColor="#a87420" />
          <stop offset="50%"  stopColor="#f8e493" />
          <stop offset="100%" stopColor="#a87420" />
        </linearGradient>
        <linearGradient id="rainbowTrim" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%"   stopColor="#ff6aa8" />
          <stop offset="20%"  stopColor="#ffd54f" />
          <stop offset="40%"  stopColor="#85ff7e" />
          <stop offset="60%"  stopColor="#7eebff" />
          <stop offset="80%"  stopColor="#c47eff" />
          <stop offset="100%" stopColor="#ff6aa8" />
        </linearGradient>
        <clipPath id="artClip">
          <rect x={PADX + 14} y={ART_Y} width={W - 2 * (PADX + 14)} height={ART_H} rx="4" />
        </clipPath>
        {/* ジョブ背景を薄くする filter (彩度↓ + 明度↑、Gaussian blur) */}
        <filter id="jobFade" x="-5%" y="-5%" width="110%" height="110%">
          <feGaussianBlur stdDeviation="3" edgeMode="duplicate" />
          <feColorMatrix values="
            0.60 0.25 0.05 0 0.18
            0.25 0.55 0.10 0 0.16
            0.15 0.20 0.35 0 0.12
            0    0    0    1 0" />
        </filter>
        {/* アバターの周囲をフェザリング (縁取りなし、中央濃く → 外側 0 へ) */}
        <radialGradient id="avatarFeather" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="white" stopOpacity="1" />
          <stop offset="65%" stopColor="white" stopOpacity="1" />
          <stop offset="85%" stopColor="white" stopOpacity="0.7" />
          <stop offset="100%" stopColor="white" stopOpacity="0" />
        </radialGradient>
        <mask id="avatarMask">
          <rect x={AVATAR_CX - AVATAR_R}
                y={AVATAR_CY - AVATAR_R}
                width={AVATAR_R * 2}
                height={AVATAR_R * 2}
                fill="url(#avatarFeather)" />
        </mask>
        {/* LV バッジ用の立体感グラデ */}
        <radialGradient id="badgeGrad" cx="35%" cy="30%" r="70%">
          <stop offset="0%" stopColor="#d9a94e" />
          <stop offset="55%" stopColor={ACCENT} />
          <stop offset="100%" stopColor="#4a2f12" />
        </radialGradient>
        {/* rarity pill 用のメタル風グラデ (rarity 色から派生) */}
        <linearGradient id="rarityGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={rarityColor} stopOpacity="1" />
          <stop offset="100%" stopColor={rarityColor} stopOpacity="0.75" />
        </linearGradient>
        {/* バッジの影 */}
        <filter id="badgeShadow" x="-30%" y="-30%" width="160%" height="160%">
          <feDropShadow dx="0" dy="1.5" stdDeviation="1.5" floodOpacity="0.45" />
        </filter>
      </defs>

      {/* === カード背景 (プログラマティック frame) ===
          層構成 (下→上):
          1. 最外周の濃焦げ茶リム (silhouette を決める)
          2. rarity 別の枠主色 multi-stop メタリック
          3. シマー層 (rarity 別、UR/SSR は 2 重で深みを出す)
          4. frameLight (上ハイライト→下シャドウで 3D 感)
          5. スパークル (srare 以上で枠帯に星をちりばめる、UR は最多)
          6. トリム ダブルライン (silver / gold / rainbow を rarity で切替)
          7. 4 隅オーナメント + 上下中央装飾
      */}
      <rect x="0" y="0" width={W} height={H} fill={FRAME_OUTER} rx="18" />
      {/* 枠主色は color identity 駆動 (frameColor)。rarity-別の bodyGrad は使わず、
       *  rarity は上に乗るシマー/スパークル/トリムの強度差で表現する。 */}
      <rect x="6" y="6" width={W - 12} height={H - 12} fill={`url(#${colorStyle.bodyGradId})`} rx="14" />
      {frameStyle.shimmer.map((sh) => (
        <rect key={sh.id} x="6" y="6" width={W - 12} height={H - 12}
              fill={`url(#${sh.id})`} opacity={sh.opacity} rx="14" />
      ))}
      <rect x="6" y="6" width={W - 12} height={H - 12} fill="url(#frameLight)" rx="14" />
      {/* トリム ダブルライン (silver/gold/rainbow) */}
      <rect x="13" y="13" width={W - 26} height={H - 26} fill="none"
            stroke={`url(#${frameStyle.trimId})`} strokeWidth="2.2" rx="11" />
      <rect x="18" y="18" width={W - 36} height={H - 36} fill="none"
            stroke="rgba(0,0,0,0.55)" strokeWidth="0.7" rx="9" />
      {/* 4 隅のオーナメント */}
      <CornerOrnament cx={18} cy={18} rotation={0} trimId={frameStyle.trimId} />
      <CornerOrnament cx={W - 18} cy={18} rotation={90} trimId={frameStyle.trimId} />
      <CornerOrnament cx={W - 18} cy={H - 18} rotation={180} trimId={frameStyle.trimId} />
      <CornerOrnament cx={18} cy={H - 18} rotation={270} trimId={frameStyle.trimId} />
      {/* 上下中央の装飾 (沈黙の baroque な仕切り) */}
      <CenterFlourish cx={W / 2} cy={14} trimId={frameStyle.trimId} />
      <CenterFlourish cx={W / 2} cy={H - 14} rotation={180} trimId={frameStyle.trimId} />
      {/* スパークル (枠帯のみ、パネル上には載せない / トリムと装飾の上に光らせる) */}
      {frameStyle.sparkleCount > 0 && (
        <SparkleField count={frameStyle.sparkleCount} seed={hashRarity(rarity)} bigSparkles={frameStyle.bigSparkles} />
      )}

      {/* === 1. Title bar === */}
      <g>
        <rect x={PADX} y={TITLE_Y} width={W - 2 * PADX} height={TITLE_H}
              fill={PANEL_FILL} stroke={PANEL_STROKE} strokeWidth="1.4" rx="6" />
        <text x={PADX + 18} y={TITLE_Y + TITLE_H * 0.62} fontSize={titleFontSizeOf(titleText)} fontWeight="800"
              fontFamily="'Hiragino Mincho ProN', 'Yu Mincho', serif" fill={INK}>
          {titleText}
        </text>
        {/* マナコスト (MTG 右上)。色マナ + generic を WUBRG + 数字で並べる。
         *  manaCost 未指定なら何も表示しない (旧データ互換)。 */}
        {manaCost && (
          <ManaCostSvgRow
            cost={manaCost}
            rightX={W - PADX - 10}
            cy={TITLE_Y + TITLE_H / 2}
            symbolSize={32}
          />
        )}
      </g>

      {/* === 2. Art frame ===
          層構成:
          1. 羊皮紙に馴染む淡いクリーム枠
          2. ジョブ背景画像 (blur + 彩度↓で「薄い背景」化)
          3. 中央に円形クロップしたユーザーアバター (フェザーで縁取りなし + 透過)
      */}
      <g clipPath="url(#artClip)">
        <rect x={PADX + 14} y={ART_Y} width={W - 2 * (PADX + 14)} height={ART_H}
              fill="#efdfb5" />
        {artSrc && (
          <image
            href={artSrc}
            xlinkHref={artSrc}
            x={PADX + 14} y={ART_Y}
            width={W - 2 * (PADX + 14)} height={ART_H}
            preserveAspectRatio="xMidYMid slice"
            filter="url(#jobFade)"
            opacity="0.55"
          />
        )}
        {avatarSrc && (
          <image
            href={avatarSrc}
            xlinkHref={avatarSrc}
            x={AVATAR_CX - AVATAR_R}
            y={AVATAR_CY - AVATAR_R}
            width={AVATAR_R * 2}
            height={AVATAR_R * 2}
            preserveAspectRatio="xMidYMid slice"
            mask="url(#avatarMask)"
            opacity="0.92"
          />
        )}
      </g>
      {/* art 枠外縁 (clip の外に描いてシャープな線を保つ) */}
      <rect x={PADX + 14} y={ART_Y} width={W - 2 * (PADX + 14)} height={ART_H}
            fill="none" stroke={INK} strokeWidth="1.4" rx="4" />

      {/* === 3. Type line === */}
      <g>
        <rect x={PADX} y={TYPE_Y} width={W - 2 * PADX} height={TYPE_H}
              fill={PANEL_FILL} stroke={PANEL_STROKE} strokeWidth="1.4" rx="6" />
        <text x={PADX + 18} y={TYPE_Y + TYPE_H * 0.66} fontSize="28" fontWeight="800"
              fontFamily="'Hiragino Mincho ProN', 'Yu Mincho', serif" fill={INK}>
          {cardType === 'artifact' ? cardTypeLabel : `${cardTypeLabel} — ${jobName}`}
        </text>
        {/* rarity pill (右端、パネル内に収める) */}
        <g transform={`translate(${W - PADX - 12}, ${TYPE_Y + TYPE_H / 2})`} filter="url(#badgeShadow)">
          <rect x={-92} y={-16} width="86" height="32" rx="16"
                fill="url(#rarityGrad)" stroke={INK} strokeWidth="1.4" />
          {/* 内側の細い白縁 */}
          <rect x={-89} y={-13} width="80" height="26" rx="13"
                fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth="0.8" />
          <text x={-49} y="5" fontSize="15" fontWeight="800"
                fontFamily="'Hiragino Mincho ProN', 'Yu Mincho', serif"
                textAnchor="middle" fill="#fff8e2"
                style={{ letterSpacing: '0.03em' }}>
            {rarityLabel}
          </text>
        </g>
      </g>

      {/* === 4. Rules / Body box === */}
      <g>
        <rect x={PADX} y={BODY_Y} width={W - 2 * PADX} height={BODY_H}
              fill={PANEL_FILL} stroke={PANEL_STROKE} strokeWidth="1.4" rx="6" />

        {/* Effect (3 要素): 名前 (bold) + 起動コスト (マナアイコン + : 区切) + 説明
         *  abilityCost (structured ManaCost) があればそちらをアイコンで表示、
         *  なければ effectCost (string、interim) を後方互換で使う。 */}
        <EffectBlock
          x={PADX + 20}
          y={BODY_Y + 44}
          width={W - 2 * (PADX + 20)}
          name={effectName}
          {...(props.abilityCost !== undefined ? { abilityManaCost: props.abilityCost } : {})}
          cost={effectCost}
          description={effectDescription}
        />

        {/* 区切り (ルール / フレーバーの間) */}
        <line x1={PADX + 40} y1={BODY_Y + BODY_H * 0.58}
              x2={W - PADX - 40} y2={BODY_Y + BODY_H * 0.58}
              stroke={INK_SOFT} strokeWidth="0.6" strokeDasharray="3 3" />

        {/* Flavor italic */}
        <FlavorBlock
          x={PADX + 20}
          y={BODY_Y + BODY_H * 0.58 + 36}
          width={W - 2 * (PADX + 20)}
          maxHeight={BODY_H * 0.42 - 50}
          text={flavorText}
          attribution={flavorAttribution}
        />
      </g>

      {/* === 5. P/T 相当 (dom-aux 表示、右下に重ねる) === */}
      <g>
        <rect x={W - PADX - PT_W - 4} y={BODY_Y + BODY_H - PT_H / 2}
              width={PT_W} height={PT_H}
              fill="#fff8e2" stroke={INK} strokeWidth="2" rx="4" />
        <text x={W - PADX - PT_W / 2 - 4} y={BODY_Y + BODY_H - PT_H / 2 + PT_H * 0.66}
              fontSize="30" fontWeight="800"
              fontFamily="'Hiragino Mincho ProN', 'Yu Mincho', serif"
              textAnchor="middle" fill={INK}>
          {job.dominantFunction}/{job.auxiliaryFunction}
        </text>
      </g>

      {/* === Footer (tiny) === */}
      {/* 右下の日付は dominantFunction バッジと重なって見苦しいので非表示。
       *  必要なら別位置に出す。左下の handle はそのまま。 */}
      <text x={PADX} y={FOOTER_Y} fontSize="13"
            fontFamily="ui-monospace, 'Courier New', monospace" fill={INK_SOFT}>
        AozoraQuest · @{handle}
      </text>
    </svg>
  );
});

/**
 * 能力テキスト: 名前 (bold) + コスト行 (MTG の ":" 前に太字で来る発動コスト) + 説明文。
 *
 * 表示フォーマット (MTG 能力の典型):
 *   <名前>
 *   <コスト>: <説明>
 * ただしコストが「なし」「空」ならパッシブ扱いで "<名前> — <説明>" の 1 行短縮版。
 */
function EffectBlock(props: {
  x: number; y: number; width: number;
  name: string;
  /** 構造化マナコスト。abilityManaCost === undefined なら旧 cost: string で fallback。
   *  null または total=0 は passive 扱い。 */
  abilityManaCost?: ManaCost | null;
  /** 後方互換: interim 文字列コスト。abilityManaCost が無いときに使う。 */
  cost: string;
  description: string;
}) {
  const { x, y, width, name, abilityManaCost, cost, description } = props;
  const NAME_FONT = 32;
  const BODY_FONT = 24;
  const LINE_H = 34;
  const TEXT_COLOR = '#000';
  const LABEL_COLOR = '#2a1a08';

  // passive 判定: 構造化マナがあれば total で判断、無ければ文字列の「なし」を見る
  const isPassive = abilityManaCost !== undefined
    ? (abilityManaCost === null || manaCostTotal(abilityManaCost) === 0)
    : (!cost || cost === 'なし' || /^\s*なし\s*$/.test(cost));

  const nameLine = (
    <text x={x} y={y} fontSize={NAME_FONT} fontWeight="800"
          fontFamily="'Hiragino Mincho ProN', 'Yu Mincho', serif" fill={TEXT_COLOR}>
      {name}
    </text>
  );

  if (isPassive) {
    const descLines = wrapJa(description, 21, 5);
    return (
      <g>
        {nameLine}
        {descLines.map((line, i) => (
          <text key={i} x={x} y={y + (i + 1) * LINE_H + 6} fontSize={BODY_FONT}
                fontFamily="'Hiragino Mincho ProN', 'Yu Mincho', serif" fill={TEXT_COLOR}>
            {line}
          </text>
        ))}
        <rect x={x} y={y - 28} width={width} height={LINE_H * (descLines.length + 1) + 14}
              fill="none" stroke="none" />
      </g>
    );
  }

  const MAX_TOTAL = 6;
  // 構造化マナがあるならコスト行はマナアイコン 1 行で済む (折り返し不要)
  const useManaIcons = abilityManaCost !== undefined && abilityManaCost !== null;
  const costLineCount = useManaIcons ? 1 : Math.min(2, Math.max(1, Math.ceil(cost.length / 21)));
  const descBudget = Math.max(1, MAX_TOTAL - 1 - costLineCount);
  const descLines = wrapJa(description, 21, descBudget);
  const costLines = useManaIcons ? [] : wrapJa(cost, 21, 2);
  const COST_ICON_SIZE = 26;
  const yOff = LINE_H; // コスト行は常に 1 段下に配置

  return (
    <g>
      {nameLine}
      {/* コスト行: マナアイコン (構造化) or 文字列 (interim) */}
      {useManaIcons ? (
        <>
          <ManaCostSvgRow cost={abilityManaCost!} leftX={x} cy={y + yOff - 4} symbolSize={COST_ICON_SIZE} />
          {/* マナ列の後ろに「:」を置いて、効果説明への橋渡し (MTG の活性化コスト表記) */}
          <text x={x + (manaCostTotal(abilityManaCost!) * (COST_ICON_SIZE + 4)) + 2}
                y={y + yOff + 6} fontSize={BODY_FONT} fontWeight="700"
                fontFamily="'Hiragino Mincho ProN', 'Yu Mincho', serif" fill={TEXT_COLOR}>
            :
          </text>
        </>
      ) : (
        costLines.map((line, i) => (
          <text key={`c${i}`} x={x} y={y + (i + 1) * LINE_H + 6} fontSize={BODY_FONT} fontWeight="700"
                fontFamily="'Hiragino Mincho ProN', 'Yu Mincho', serif" fill={TEXT_COLOR}>
            {line}
          </text>
        ))
      )}
      {/* 説明行 (コスト下) */}
      {descLines.map((line, i) => {
        const yy = y + yOff + (i + 1) * LINE_H + 12;
        return (
          <text key={`d${i}`} x={x} y={yy} fontSize={BODY_FONT}
                fontFamily="'Hiragino Mincho ProN', 'Yu Mincho', serif" fill={TEXT_COLOR}>
            {i === 0 ? <tspan fontWeight="700" fill={LABEL_COLOR}>効果: </tspan> : null}
            {line}
          </text>
        );
      })}
      <rect x={x} y={y - 28} width={width}
            height={yOff + LINE_H * descLines.length + 24}
            fill="none" stroke="none" />
    </g>
  );
}

/**
 * flavor text を折り返して italic で描画。maxHeight を超える行はカットし、
 * 末尾を 「…」 に丸める。
 * attribution があれば最終行の下に MTG 風の "— {名前}" を右寄せ小字で添える。
 */
function FlavorBlock(props: { x: number; y: number; width: number; maxHeight: number; text: string; attribution?: string | undefined }) {
  const { x, y, width, maxHeight, text, attribution } = props;
  const FONT_SIZE = 22;
  const LINE_H = 30;
  const ATTR_FONT = 16;
  const ATTR_GAP = 6;
  const reserveForAttr = attribution ? ATTR_FONT + ATTR_GAP : 0;
  const maxLines = Math.max(1, Math.floor((maxHeight - reserveForAttr) / LINE_H));
  const lines = wrapJa(text, 21, maxLines);
  const lastY = y + (lines.length - 1) * LINE_H;
  return (
    <g>
      {lines.map((line, i) => (
        <text key={i} x={x} y={y + i * LINE_H}
              fontSize={FONT_SIZE} fontStyle="italic" fontWeight="500"
              fontFamily="'Hiragino Mincho ProN', 'Yu Mincho', serif" fill={INK}>
          {line}
        </text>
      ))}
      {attribution && (
        <text x={x + width - 6} y={lastY + ATTR_FONT + ATTR_GAP}
              fontSize={ATTR_FONT} fontStyle="italic" fontWeight="500"
              fontFamily="'Hiragino Mincho ProN', 'Yu Mincho', serif"
              textAnchor="end" fill={INK_SOFT}>
          — {attribution}
        </text>
      )}
      <rect x={x - 4} y={y - (LINE_H - 8)} width={width} height={lines.length * LINE_H + 8 + reserveForAttr}
            fill="none" stroke="none" />
    </g>
  );
}

// 行頭禁則 (この文字で行が始まってはいけない)
const KINSOKU_HEAD_NG = '、。，．・）」』】〕｝〉》！？!?,.:;：；)]｝〉》';
// 行末禁則 (この文字で行が終わってはいけない)
const KINSOKU_TAIL_NG = '（「『【〔｛〈《([{';
// 自然な改行候補 (行末に来ると気持ちいい記号)
const WRAP_DELIMS = '、。 ・!?!?';

function wrapJa(text: string, perLine: number, maxLines: number): string[] {
  const out: string[] = [];
  let buf = '';
  const chars = Array.from(text);
  let i = 0;
  let consumed = 0;

  while (i < chars.length && out.length < maxLines) {
    const ch = chars[i]!;
    buf += ch;
    i++;
    consumed++;

    const atDelim = buf.length >= perLine && WRAP_DELIMS.includes(ch);
    const overLong = buf.length >= perLine + 3;
    if (!(atDelim || overLong)) continue;

    // 行末禁則: 行末が開き括弧なら切らずに続行
    if (KINSOKU_TAIL_NG.includes(ch)) continue;

    // 行頭禁則: 次の文字が禁則なら吸収してから切る (追い出し)
    while (i < chars.length && KINSOKU_HEAD_NG.includes(chars[i]!)) {
      buf += chars[i]!;
      i++;
      consumed++;
    }

    out.push(buf);
    buf = '';
  }
  if (buf.length > 0 && out.length < maxLines) {
    out.push(buf);
  }
  if (out.length >= maxLines && consumed < chars.length) {
    const last = out[maxLines - 1]!.replace(/[、。 ]*$/, '');
    out[maxLines - 1] = last + '…';
  }
  return out.slice(0, maxLines);
}

/** タイトル (cardName または displayName) の長さに応じてフォントサイズを縮める。
 *  Title bar 内の幅は W - 2*PADX - マナコスト幅 ≈ 540px。
 *  日本語フォントの幅は font-size の ~0.95 倍なので、概ね N 字 × size = 540 を解く。 */
function titleFontSizeOf(text: string): number {
  const len = Array.from(text).length;
  if (len <= 8) return 38;
  if (len <= 10) return 34;
  if (len <= 12) return 30;
  if (len <= 14) return 26;
  return 22;
}

/**
 * カードに表示するマナコスト列。SVG ネイティブ (rasterize 対応)。
 * cost に含まれる generic を先頭、色マナを WUBRG 順で並べる。
 * rightX (右端) または leftX (左端) のどちらかを指定して整列。 */
function ManaCostSvgRow({ cost, rightX, leftX, cy, symbolSize }: {
  cost: ManaCost;
  rightX?: number;
  leftX?: number;
  cy: number;
  symbolSize: number;
}) {
  const items: Array<{ key: string; color: Color | 'generic'; value?: number }> = [];
  if (cost.generic && cost.generic > 0) {
    items.push({ key: 'g', color: 'generic', value: cost.generic });
  }
  for (const c of COLORS) {
    const n = cost[c] ?? 0;
    for (let i = 0; i < n; i++) items.push({ key: `${c}${i}`, color: c });
  }
  if (items.length === 0) return null;
  const gap = 4;
  const totalWidth = items.length * symbolSize + (items.length - 1) * gap;
  const startX = leftX !== undefined ? leftX : (rightX !== undefined ? rightX - totalWidth : 0);
  return (
    <g>
      {items.map((item, idx) => (
        <ManaSymbolSvg
          key={item.key}
          color={item.color}
          {...(item.value !== undefined ? { value: item.value } : {})}
          x={startX + idx * (symbolSize + gap)}
          y={cy - symbolSize / 2}
          size={symbolSize}
        />
      ))}
    </g>
  );
}

/** マナシンボル 1 個を SVG <g> として描く。color 別の背景色 + シンボル glyph。 */
function ManaSymbolSvg({ color, value, x, y, size }: {
  color: Color | 'generic';
  value?: number;
  x: number;
  y: number;
  size: number;
}) {
  const bg: Record<Color | 'generic', string> = {
    W: '#f4ead0', U: '#7fb6e0', B: '#2a1f2a', R: '#c84a36', G: '#3f7a4a', generic: '#a8a298',
  };
  const ring: Record<Color | 'generic', string> = {
    W: '#8c7a40', U: '#234a70', B: '#0a0a0a', R: '#5a1a10', G: '#1c3a22', generic: '#3a3530',
  };
  const ic: Record<Color | 'generic', string> = {
    W: '#5a4810', U: '#0e2a4a', B: '#e0c8c8', R: '#fff0c0', G: '#e8f0d0', generic: '#1a1a1a',
  };
  const r = size / 2;
  return (
    <g transform={`translate(${x},${y})`}>
      <circle cx={r} cy={r} r={r * 0.97} fill={ring[color]} />
      <circle cx={r} cy={r} r={r * 0.84} fill={bg[color]} />
      <ellipse cx={r * 0.78} cy={r * 0.68} rx={r * 0.32} ry={r * 0.18} fill="rgba(255,255,255,0.35)" />
      <ManaGlyph color={color} value={value} fg={ic[color]} bg={bg[color]} cx={r} cy={r} r={r} />
    </g>
  );
}

function ManaGlyph({ color, value, fg, bg, cx, cy, r }: {
  color: Color | 'generic';
  value: number | undefined;
  fg: string;
  bg: string;
  cx: number;
  cy: number;
  r: number;
}) {
  const s = r / 12; // scale (viewBox 24×24 → 実 size)
  const tx = (n: number) => cx + (n - 12) * s;
  const ty = (n: number) => cy + (n - 12) * s;
  switch (color) {
    case 'W':
      return (
        <g fill={fg}>
          <circle cx={tx(12)} cy={ty(12)} r={2.8 * s} />
          {[0, 45, 90, 135, 180, 225, 270, 315].map((deg) => (
            <rect key={deg}
              x={tx(11.2)} y={ty(3.6)} width={1.6 * s} height={3.6 * s}
              transform={`rotate(${deg} ${cx} ${cy})`} rx={0.6 * s} />
          ))}
        </g>
      );
    case 'U':
      return (
        <path
          d={`M ${tx(12)} ${ty(4.5)} C ${tx(12)} ${ty(4.5)}, ${tx(6)} ${ty(11)}, ${tx(6)} ${ty(14.8)} C ${tx(6)} ${ty(17.8)}, ${tx(8.7)} ${ty(19.8)}, ${tx(12)} ${ty(19.8)} C ${tx(15.3)} ${ty(19.8)}, ${tx(18)} ${ty(17.8)}, ${tx(18)} ${ty(14.8)} C ${tx(18)} ${ty(11)}, ${tx(12)} ${ty(4.5)}, ${tx(12)} ${ty(4.5)} Z`}
          fill={fg}
        />
      );
    case 'B':
      return (
        <g fill={fg}>
          <path d={`M ${tx(12)} ${ty(5)} C ${tx(8)} ${ty(5)}, ${tx(5.5)} ${ty(8)}, ${tx(5.5)} ${ty(11.5)} C ${tx(5.5)} ${ty(13.6)}, ${tx(6.6)} ${ty(15.4)}, ${tx(8.3)} ${ty(16.4)} L ${tx(8.3)} ${ty(18.5)} L ${tx(10)} ${ty(18.5)} L ${tx(10)} ${ty(17.2)} L ${tx(11.2)} ${ty(17.2)} L ${tx(11.2)} ${ty(18.5)} L ${tx(12.8)} ${ty(18.5)} L ${tx(12.8)} ${ty(17.2)} L ${tx(14)} ${ty(17.2)} L ${tx(14)} ${ty(18.5)} L ${tx(15.7)} ${ty(18.5)} L ${tx(15.7)} ${ty(16.4)} C ${tx(17.4)} ${ty(15.4)}, ${tx(18.5)} ${ty(13.6)}, ${tx(18.5)} ${ty(11.5)} C ${tx(18.5)} ${ty(8)}, ${tx(16)} ${ty(5)}, ${tx(12)} ${ty(5)} Z`} />
          <circle cx={tx(9.3)} cy={ty(11.5)} r={1.6 * s} fill={bg} />
          <circle cx={tx(14.7)} cy={ty(11.5)} r={1.6 * s} fill={bg} />
        </g>
      );
    case 'R':
      return (
        <path
          d={`M ${tx(12)} ${ty(4)} C ${tx(13)} ${ty(7)}, ${tx(15)} ${ty(9)}, ${tx(15)} ${ty(11.5)} C ${tx(15)} ${ty(13)}, ${tx(14)} ${ty(13.6)}, ${tx(13.6)} ${ty(13.4)} C ${tx(13.8)} ${ty(12)}, ${tx(13.2)} ${ty(10.5)}, ${tx(11.8)} ${ty(10)} C ${tx(12)} ${ty(12)}, ${tx(10.5)} ${ty(13)}, ${tx(9)} ${ty(14.5)} C ${tx(7.8)} ${ty(15.8)}, ${tx(7.5)} ${ty(17.4)}, ${tx(8.4)} ${ty(18.6)} C ${tx(9.3)} ${ty(19.6)}, ${tx(11)} ${ty(20)}, ${tx(12.5)} ${ty(20)} C ${tx(16)} ${ty(20)}, ${tx(17.6)} ${ty(16.8)}, ${tx(17)} ${ty(14)} C ${tx(16.3)} ${ty(10.7)}, ${tx(13.8)} ${ty(7.5)}, ${tx(12)} ${ty(4)} Z`}
          fill={fg}
        />
      );
    case 'G':
      return (
        <path
          d={`M ${tx(12)} ${ty(4.5)} C ${tx(17)} ${ty(6)}, ${tx(19)} ${ty(10)}, ${tx(18)} ${ty(15)} C ${tx(17.2)} ${ty(18.5)}, ${tx(14)} ${ty(19.8)}, ${tx(11)} ${ty(19.5)} C ${tx(7.5)} ${ty(19)}, ${tx(5.4)} ${ty(16)}, ${tx(5.8)} ${ty(12.5)} C ${tx(6.2)} ${ty(9)}, ${tx(8)} ${ty(6)}, ${tx(12)} ${ty(4.5)} Z`}
          fill={fg}
        />
      );
    case 'generic':
      return (
        <text x={cx} y={cy + r * 0.05}
              fontSize={r * 1.1} fontWeight="800"
              fontFamily="'Hiragino Mincho ProN', 'Yu Mincho', serif"
              textAnchor="middle" dominantBaseline="central" fill={fg}>
          {value ?? '?'}
        </text>
      );
  }
}

/**
 * 4 隅のオーナメント。L 字の二重線 + コーナーの宝石風ダイヤ + 沿線のドット。
 * cx,cy は L の内角 (= 内側トリムの角)。rotation で 4 隅に向きを合わせる。
 * trimId は silver/gold/rainbow から選び、宝石とダイヤの色味が rarity と合う。
 */
function CornerOrnament({ cx, cy, rotation, trimId }: { cx: number; cy: number; rotation: number; trimId: string }) {
  const stroke = `url(#${trimId})`;
  return (
    <g transform={`translate(${cx},${cy}) rotate(${rotation})`}>
      <path d="M 4 38 L 4 4 L 38 4" fill="none"
            stroke="rgba(0,0,0,0.55)" strokeWidth="0.6" />
      <path d="M 0 40 L 0 0 L 40 0" fill="none"
            stroke={stroke} strokeWidth="1.8" strokeLinecap="round" />
      <path d="M 0 0 L 9 -9 L 18 0 L 9 9 Z"
            fill={stroke} stroke="#1a0e02" strokeWidth="0.7" />
      <path d="M 9 -5.5 L 14 0 L 9 5.5 L 4 0 Z"
            fill="rgba(255,255,255,0.7)" />
      <circle cx="24" cy="0" r="1.8" fill={stroke} />
      <circle cx="32" cy="0" r="1.2" fill={stroke} opacity="0.7" />
      <circle cx="0" cy="24" r="1.8" fill={stroke} />
      <circle cx="0" cy="32" r="1.2" fill={stroke} opacity="0.7" />
    </g>
  );
}

/**
 * 上下中央の小さな baroque 装飾。シンメトリな菱形 + 横線。
 * trimId は CornerOrnament と同じ色味系を共有させる。
 */
function CenterFlourish({ cx, cy, rotation = 0, trimId }: { cx: number; cy: number; rotation?: number; trimId: string }) {
  const stroke = `url(#${trimId})`;
  return (
    <g transform={`translate(${cx},${cy}) rotate(${rotation})`}>
      <path d="M -28 0 L -8 0" stroke={stroke} strokeWidth="1.4" />
      <path d="M 28 0 L 8 0" stroke={stroke} strokeWidth="1.4" />
      <path d="M -8 0 L 0 -5 L 8 0 L 0 5 Z"
            fill={stroke} stroke="#1a0e02" strokeWidth="0.5" />
      <circle cx="-32" cy="0" r="1.4" fill={stroke} />
      <circle cx="32" cy="0" r="1.4" fill={stroke} />
    </g>
  );
}

/**
 * 枠帯にちりばめるスパークル星。
 *
 * 配置はパネル外 (x < PADX, x > W - PADX, y < PADY, y > H - PADY) の枠帯のみ。
 * 角オーナメント / 中央装飾 と被らないようにバッファを取って rejection sampling。
 * seed (rarity から導出) で決定的に位置決め → 同じ rarity は毎回同じ模様。
 *
 * bigSparkles=true なら 1/4 を + 字型の大粒に置き換える (SSR/UR で輝きを強める)。
 */
function SparkleField({ count, seed, bigSparkles }: { count: number; seed: number; bigSparkles: boolean }) {
  const stars = generateSparkles(seed, count);
  return (
    <g>
      {stars.map((s, i) => {
        if (bigSparkles && i % 4 === 0) {
          // + 字型の大粒 (4-point star)
          const r = s.r * 1.4;
          const inner = r * 0.28;
          return (
            <path
              key={i}
              transform={`translate(${s.x},${s.y})`}
              d={`M 0 ${-r} L ${inner} ${-inner} L ${r} 0 L ${inner} ${inner} L 0 ${r} L ${-inner} ${inner} L ${-r} 0 L ${-inner} ${-inner} Z`}
              fill="#fffce8"
              opacity={s.op}
            />
          );
        }
        return (
          <circle key={i} cx={s.x} cy={s.y} r={s.r} fill="#fffce8" opacity={s.op} />
        );
      })}
    </g>
  );
}

/** rarity 文字列を deterministic な seed に潰す (FNV-1a 簡易版)。 */
function hashRarity(r: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < r.length; i++) {
    h ^= r.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  return h;
}

/**
 * 枠帯 (パネルの外側) にスパークル星の座標を count 個生成。
 * - 上下のストリップ: y < 32 / y > H - 32
 * - 左右のストリップ: x < 32 / x > W - 32
 * - 角オーナメント (±50px) と中央装飾 (±36px) を避ける rejection sampling
 */
function generateSparkles(seed: number, count: number): Array<{ x: number; y: number; r: number; op: number }> {
  const stars: Array<{ x: number; y: number; r: number; op: number }> = [];
  let h = seed >>> 0;
  const rand = () => {
    h = (h * 1664525 + 1013904223) >>> 0;
    return h / 0x100000000;
  };
  const corners: Array<[number, number]> = [[18, 18], [W - 18, 18], [W - 18, H - 18], [18, H - 18]];
  const flourishes: Array<[number, number]> = [[W / 2, 14], [W / 2, H - 14]];
  let attempts = 0;
  while (stars.length < count && attempts < count * 12) {
    attempts++;
    const side = Math.floor(rand() * 4);
    let x: number;
    let y: number;
    if (side === 0) {        // top strip
      x = 30 + rand() * (W - 60);
      y = 3 + rand() * 28;
    } else if (side === 1) { // bottom strip
      x = 30 + rand() * (W - 60);
      y = H - 31 + rand() * 28;
    } else if (side === 2) { // left strip
      x = 3 + rand() * 28;
      y = 50 + rand() * (H - 100);
    } else {                 // right strip
      x = W - 31 + rand() * 28;
      y = 50 + rand() * (H - 100);
    }
    // reject if too close to corner ornaments or center flourishes
    let bad = false;
    for (const [cx, cy] of corners) {
      if (Math.hypot(x - cx, y - cy) < 50) { bad = true; break; }
    }
    if (!bad) {
      for (const [cx, cy] of flourishes) {
        if (Math.hypot(x - cx, y - cy) < 36) { bad = true; break; }
      }
    }
    if (bad) continue;
    const r = 1.5 + rand() * 2.2;
    const op = 0.55 + rand() * 0.4;
    stars.push({ x, y, r, op });
  }
  return stars;
}

