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

import type { CardType, DiagnosisResult, ManaCost, Rarity } from '@aozoraquest/core';
import {
  CARD_TYPE_LABEL,
  frameColorOf,
  JOBS_BY_ID,
  jobDisplayName,
  RARITY_COLOR,
  RARITY_LABEL,
} from '@aozoraquest/core';
import { forwardRef } from 'react';
import {
  ACCENT, ART_H, ART_Y, BODY_H, BODY_Y, COLOR_FRAME_STYLES, FOOTER_Y, FRAME_OUTER, FRAME_STYLES,
  H, INK, INK_SOFT, PADX, PANEL_FILL, PANEL_STROKE, PT_H, PT_W, TITLE_H, TITLE_Y, TYPE_H, TYPE_Y, W,
} from './job-card-layout';
import { ManaCostSvgRow } from './job-card-mana';
import { CenterFlourish, CornerOrnament, hashRarity, SparkleField } from './job-card-ornaments';
import { EffectBlock, FlavorBlock, titleFontSizeOf } from './job-card-text';

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
  /** タップして起動するか (creature / artifact の起動型能力に多い)。abilityCost と独立、両方併用可。 */
  abilityTap?: boolean;
  /** カード名 (LLM 生成、例: 「忍び寄る混沌」)。タイトル位置に表示。未指定なら displayName へ fallback。 */
  cardName?: string;
  /** クリーチャーのキーワード能力 (例: ['飛行','警戒'])。クリーチャー以外は無視。 */
  keywords?: ReadonlyArray<string>;
  /** クリーチャーのパワー (攻撃力)。指定があれば右下バッジを P/T 表示にする。 */
  power?: number;
  /** クリーチャーのタフネス (防御力)。 */
  toughness?: number;
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
  const { result, effectName, effectCost, effectDescription, flavorText, flavorAttribution, rarity, cardType, manaCost, cardName, keywords, power, toughness, displayName, handle, artSrc, avatarSrc, className, style } = props;
  const isCreature = cardType === 'creature' || cardType === undefined;
  const hasPT = isCreature && typeof power === 'number' && typeof toughness === 'number';
  const keywordLine = isCreature && keywords && keywords.length > 0 ? keywords.join('、') : '';
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
          {cardType === 'creature' ? `${cardTypeLabel} — ${jobName}` : cardTypeLabel}
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
          {...(props.abilityTap ? { abilityTap: true } : {})}
          cost={effectCost}
          description={effectDescription}
          keywordLine={keywordLine}
        />

        {/* 区切り (ルール / フレーバーの間) — 効果ブロックとの間隔を取るため 1 行分下げる */}
        <line x1={PADX + 40} y1={BODY_Y + BODY_H * 0.58 + 28}
              x2={W - PADX - 40} y2={BODY_Y + BODY_H * 0.58 + 28}
              stroke={INK_SOFT} strokeWidth="0.6" strokeDasharray="3 3" />

        {/* Flavor italic */}
        <FlavorBlock
          x={PADX + 20}
          y={BODY_Y + BODY_H * 0.58 + 28 + 36}
          width={W - 2 * (PADX + 20)}
          maxHeight={BODY_H * 0.42 - 50 - 28}
          text={flavorText}
          attribution={flavorAttribution}
        />
      </g>

      {/* === 5. 右下バッジ: creature は P/T、それ以外は dominant/auxiliary === */}
      <g>
        <rect x={W - PADX - PT_W - 4} y={BODY_Y + BODY_H - PT_H / 2}
              width={PT_W} height={PT_H}
              fill="#fff8e2" stroke={INK} strokeWidth="2" rx="4" />
        <text x={W - PADX - PT_W / 2 - 4} y={BODY_Y + BODY_H - PT_H / 2 + PT_H * 0.66}
              fontSize="30" fontWeight="800"
              fontFamily="'Hiragino Mincho ProN', 'Yu Mincho', serif"
              textAnchor="middle" fill={INK}>
          {hasPT ? `${power}/${toughness}` : `${job.dominantFunction}/${job.auxiliaryFunction}`}
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
