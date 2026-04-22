/**
 * 診断結果を 1 枚の SVG カード (MTG 風、羊皮紙質感) として描く。
 * 出力は 768×1100 (約 63:88 比)。rasterize 時に 2x = 1536×2200 まで引ける。
 *
 * カードは self-contained SVG: 外部 CSS や font に依存せず、そのまま PNG に
 * rasterize できる。背景 art は public/card-art/{archetype}.(png|jpg) から
 * <image> で読む。parchment も public/card-art/parchment.jpg。
 *
 * レイアウトは MTG の典型に倣った 5 段構成:
 *   1. Title bar  (name + LV)
 *   2. Art frame
 *   3. Type line  ("旅人 — {job}")
 *   4. Rules box  (cog keywords + stats + flavor italic)
 *   5. 右下 P/T 相当 (dom-aux) + footer (handle, date)
 */

import type { DiagnosisResult, Rarity } from '@aozoraquest/core';
import {
  JOBS_BY_ID,
  jobDisplayName,
  playerLevelFromXp,
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
const PANEL_FILL = 'rgba(246, 236, 208, 0.92)';  // クリーム
const PANEL_STROKE = '#4a3416';
const PAPER_FALLBACK_1 = '#efdfb5';
const ACCENT = '#7a5220';         // 金寄り


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
  /** カードレアリティ (6 段階)。badge 色と表示に使う。 */
  rarity: Rarity;
  /** 枠画像の variant (1 or 2)。同じ rarity でも見た目が変わる。 */
  frameVariant: 1 | 2;
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
  const { result, effectName, effectCost, effectDescription, flavorText, rarity, frameVariant, displayName, handle, artSrc, avatarSrc, className, style } = props;
  const rarityColor = RARITY_COLOR[rarity];
  const rarityLabel = RARITY_LABEL[rarity];
  const job = JOBS_BY_ID[result.archetype];
  const jobName = jobDisplayName(result.archetype, 'default');
  const lv = result.playerLevel ? playerLevelFromXp(result.playerLevel.xp) : 1;
  const analyzedDate = formatDate(result.analyzedAt);

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
        {/* 羊皮紙縁の焼け (vignette) */}
        <radialGradient id="vignette" cx="50%" cy="50%" r="75%">
          <stop offset="0%" stopColor="rgba(0,0,0,0)" />
          <stop offset="70%" stopColor="rgba(60,35,10,0)" />
          <stop offset="92%" stopColor="rgba(60,35,10,0.25)" />
          <stop offset="100%" stopColor="rgba(40,22,6,0.55)" />
        </radialGradient>
        <radialGradient id="paper" cx="42%" cy="38%" r="85%">
          <stop offset="0%" stopColor="#f3e4be" />
          <stop offset="45%" stopColor="#e6d2a0" />
          <stop offset="78%" stopColor="#cfb27a" />
          <stop offset="100%" stopColor="#a07c47" />
        </radialGradient>
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

      {/* === カード背景 ===
          Gemini 生成のレアリティ別枠 (羊皮紙 + 装飾枠が 1 枚絵で入っている) を
          全面に敷く。枠画像が未配置の rarity は parchment.jpg で fallback し、
          SVG の細線枠で 2 重線を足す。 */}
      <rect x="0" y="0" width={W} height={H} fill="url(#paper)" />
      <image
        href={`/card-art/frame-${rarity}-${frameVariant}.jpg`}
        xlinkHref={`/card-art/frame-${rarity}-${frameVariant}.jpg`}
        x="0" y="0" width={W} height={H}
        preserveAspectRatio="xMidYMid slice"
      />
      <rect x="0" y="0" width={W} height={H} fill="url(#vignette)" />

      {/* === 1. Title bar === */}
      <g>
        <rect x={PADX} y={TITLE_Y} width={W - 2 * PADX} height={TITLE_H}
              fill={PANEL_FILL} stroke={PANEL_STROKE} strokeWidth="1.4" rx="6" />
        <text x={PADX + 18} y={TITLE_Y + TITLE_H * 0.62} fontSize="38" fontWeight="800"
              fontFamily="'Hiragino Mincho ProN', 'Yu Mincho', serif" fill={INK}>
          {displayName}
        </text>
        {/* LV バッジ (MTG のマナコスト相当)。パネル内に収まるよう中心を調整。 */}
        <g transform={`translate(${W - PADX - 32}, ${TITLE_Y + TITLE_H / 2})`} filter="url(#badgeShadow)">
          {/* 外輪 (暗色リング) */}
          <circle cx="0" cy="0" r="24" fill="#2a1a08" />
          {/* 本体 (グラデでメタリック) */}
          <circle cx="0" cy="0" r="22" fill="url(#badgeGrad)" />
          {/* ハイライト (左上のキラ) */}
          <ellipse cx="-7" cy="-8" rx="7" ry="4" fill="rgba(255,240,200,0.55)" />
          {/* 数値 */}
          <text x="0" y="1" fontSize="22" fontWeight="800"
                fontFamily="'Hiragino Mincho ProN', serif"
                textAnchor="middle" dominantBaseline="middle" fill="#fff8e2"
                style={{ letterSpacing: '-0.02em' }}>
            {lv}
          </text>
        </g>
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
          旅人 — {jobName}
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

        {/* Effect (3 要素): 名前 (bold) + コスト (: 区切で続けて) + 説明 (下段) */}
        <EffectBlock
          x={PADX + 20}
          y={BODY_Y + 44}
          width={W - 2 * (PADX + 20)}
          name={effectName}
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
      <text x={PADX} y={FOOTER_Y} fontSize="13"
            fontFamily="ui-monospace, 'Courier New', monospace" fill={INK_SOFT}>
        AozoraQuest · @{handle}
      </text>
      <text x={W - PADX} y={FOOTER_Y} fontSize="13"
            fontFamily="ui-monospace, 'Courier New', monospace" textAnchor="end" fill={INK_SOFT}>
        {analyzedDate}
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
  name: string; cost: string; description: string;
}) {
  const { x, y, width, name, cost, description } = props;
  const NAME_FONT = 32;
  const BODY_FONT = 24;
  const LINE_H = 34;
  const TEXT_COLOR = '#000';        // 視認性のため純黒
  const LABEL_COLOR = '#2a1a08';    // 「効果:」などのラベルは濃セピア

  const isPassive = !cost || cost === 'なし' || /^\s*なし\s*$/.test(cost);
  const nameLine = (
    <text x={x} y={y} fontSize={NAME_FONT} fontWeight="800"
          fontFamily="'Hiragino Mincho ProN', 'Yu Mincho', serif" fill={TEXT_COLOR}>
      {name}
    </text>
  );

  if (isPassive) {
    const descLines = wrapJa(description, 20, 3);
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

  const costLines = wrapJa(cost, 18, 2);
  const descLines = wrapJa(description, 20, 2);
  let yOff = 0;
  return (
    <g>
      {nameLine}
      {costLines.map((line, i) => {
        yOff = (i + 1) * LINE_H;
        return (
          <text key={`c${i}`} x={x} y={y + yOff + 6} fontSize={BODY_FONT} fontWeight="700"
                fontFamily="'Hiragino Mincho ProN', 'Yu Mincho', serif" fill={TEXT_COLOR}>
            {line}
          </text>
        );
      })}
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
 */
function FlavorBlock(props: { x: number; y: number; width: number; maxHeight: number; text: string }) {
  const { x, y, width, maxHeight, text } = props;
  const FONT_SIZE = 22;
  const LINE_H = 30;
  const maxLines = Math.max(1, Math.floor(maxHeight / LINE_H));
  const lines = wrapJa(text, 22, maxLines);
  return (
    <g>
      {lines.map((line, i) => (
        <text key={i} x={x} y={y + i * LINE_H}
              fontSize={FONT_SIZE} fontStyle="italic" fontWeight="500"
              fontFamily="'Hiragino Mincho ProN', 'Yu Mincho', serif" fill={INK}>
          {line}
        </text>
      ))}
      <rect x={x - 4} y={y - (LINE_H - 8)} width={width} height={lines.length * LINE_H + 8}
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

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
// 未使用の警告回避
void PAPER_FALLBACK_1;
