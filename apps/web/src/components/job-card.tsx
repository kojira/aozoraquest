/**
 * 診断結果を 1 枚の SVG カード (MTG 風、羊皮紙質感) として描く。
 * 出力は 768×1072 (約 63:88 比、rasterize 時に 2x で 1536×2144 まで引けるよう
 * stroke を太めに設計)。
 *
 * カードは self-contained SVG: 外部 CSS や font に依存せず、そのまま PNG に
 * rasterize できる。背景 art は public/card-art/{archetype}.(png|jpg) から
 * <image> で読む。
 */

import type { CogFunction, DiagnosisResult } from '@aozoraquest/core';
import { COGNITIVE_FUNCTIONS, JOBS_BY_ID, jobDisplayName, jobTagline, playerLevelFromXp } from '@aozoraquest/core';
import { forwardRef } from 'react';

const W = 768;
const H = 1072;

// 余白・区画
const PADX = 40;           // カード外枠の内側余白 (x)
const PADY = 40;           // 同 (y)
const ART_Y = 120;         // art 枠の開始 y
const ART_H = 500;         // art 枠の高さ
const TYPE_Y = ART_Y + ART_H + 24;     // type line 開始 y
const STATS_Y = TYPE_Y + 50;           // stats 開始 y
const FLAVOR_Y = STATS_Y + 240;        // flavor 開始 y

const SEPIA = '#3b2a16';
const SEPIA_SOFT = '#5c4628';
const PAPER_1 = '#efdfb5';
const PAPER_2 = '#d9bf85';
const PAPER_BURN = '#9b7a3d';

const COG_SHORT: Record<CogFunction, string> = {
  Ni: 'Ni', Ne: 'Ne', Si: 'Si', Se: 'Se', Ti: 'Ti', Te: 'Te', Fi: 'Fi', Fe: 'Fe',
};
const COG_JP: Record<CogFunction, string> = {
  Ni: '内向直観', Ne: '外向直観',
  Si: '内向感覚', Se: '外向感覚',
  Ti: '内向思考', Te: '外向思考',
  Fi: '内向感情', Fe: '外向感情',
};

export interface JobCardProps {
  result: DiagnosisResult;
  flavorText: string;
  displayName: string;
  handle: string;
  /** 背景アートのパス (無ければ空の枠のみ)。例: '/card-art/sage.jpg' */
  artSrc?: string | undefined;
  /** ブラウザ表示用に width/height を外から上書きしたい場合 (デフォルトは viewBox 固定) */
  className?: string;
  style?: React.CSSProperties;
}

export const JobCard = forwardRef<SVGSVGElement, JobCardProps>(function JobCard(props, ref) {
  const { result, flavorText, displayName, handle, artSrc, className, style } = props;
  const job = JOBS_BY_ID[result.archetype];
  const jobName = jobDisplayName(result.archetype, 'default');
  const tagline = jobTagline(result.archetype) ?? '';
  const lv = result.playerLevel ? playerLevelFromXp(result.playerLevel.xp) : 1;
  const analyzedDate = formatDate(result.analyzedAt);

  // 上位 4 認知機能
  const topCog = [...COGNITIVE_FUNCTIONS]
    .sort((a, b) => (result.cognitiveScores[b] ?? 0) - (result.cognitiveScores[a] ?? 0))
    .slice(0, 4);

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
        {/* 羊皮紙 filter: turbulence で繊維、color matrix でセピアトーン */}
        <filter id="parchment" x="-5%" y="-5%" width="110%" height="110%">
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="5" result="noise" />
          <feColorMatrix
            in="noise"
            values="0 0 0 0 0.35  0 0 0 0 0.25  0 0 0 0 0.10  0 0 0 0.14 0"
            result="fibers"
          />
          <feComposite in="fibers" in2="SourceGraphic" operator="in" result="tinted" />
          <feBlend in="SourceGraphic" in2="tinted" mode="multiply" />
        </filter>
        {/* art を羊皮紙と馴染ませる filter: セピア寄せ + やや multiply */}
        <filter id="artTint">
          <feColorMatrix values="
            0.50 0.42 0.20 0 0
            0.38 0.38 0.18 0 0
            0.20 0.22 0.12 0 0
            0    0    0    1 0" />
        </filter>
        {/* 四隅の焼けグラデ */}
        <radialGradient id="paper" cx="50%" cy="50%" r="75%">
          <stop offset="0%" stopColor={PAPER_1} />
          <stop offset="75%" stopColor={PAPER_2} />
          <stop offset="100%" stopColor={PAPER_BURN} />
        </radialGradient>
        {/* clip for art (rounded corners) */}
        <clipPath id="artClip">
          <rect x={PADX + 12} y={ART_Y} width={W - 2 * (PADX + 12)} height={ART_H} rx="6" />
        </clipPath>
      </defs>

      {/* === 羊皮紙ベース === */}
      <rect x="0" y="0" width={W} height={H} fill="url(#paper)" />
      <rect x="0" y="0" width={W} height={H} fill={PAPER_1} filter="url(#parchment)" opacity="0.9" />

      {/* 外枠 (インクで引いた 2 重線) */}
      <rect x={PADX - 12} y={PADY - 12} width={W - 2 * (PADX - 12)} height={H - 2 * (PADY - 12)}
            fill="none" stroke={SEPIA} strokeWidth="2.5" />
      <rect x={PADX - 6} y={PADY - 6} width={W - 2 * (PADX - 6)} height={H - 2 * (PADY - 6)}
            fill="none" stroke={SEPIA_SOFT} strokeWidth="1" />

      {/* === タイトル行 === */}
      <g>
        <text x={PADX + 8} y={PADY + 36} fontSize="30" fontWeight="700"
              fontFamily="'Hiragino Mincho ProN', serif" fill={SEPIA}>
          ✦ {displayName}
        </text>
        <text x={W - PADX - 8} y={PADY + 36} fontSize="22" fontWeight="700"
              fontFamily="ui-monospace, 'Courier New', monospace" textAnchor="end" fill={SEPIA}>
          LV {lv}
        </text>
        {/* handle を小さく下段 */}
        <text x={PADX + 8} y={PADY + 62} fontSize="14"
              fontFamily="ui-monospace, 'Courier New', monospace" fill={SEPIA_SOFT}>
          @{handle}
        </text>
      </g>

      {/* セパレータ */}
      <line x1={PADX} y1={ART_Y - 12} x2={W - PADX} y2={ART_Y - 12}
            stroke={SEPIA} strokeWidth="1.5" />

      {/* === art 枠 === */}
      <g>
        <rect x={PADX + 12} y={ART_Y} width={W - 2 * (PADX + 12)} height={ART_H}
              fill="#d6bb85" />
        {artSrc && (
          <image
            href={artSrc}
            xlinkHref={artSrc}
            x={PADX + 12} y={ART_Y}
            width={W - 2 * (PADX + 12)} height={ART_H}
            preserveAspectRatio="xMidYMid slice"
            clipPath="url(#artClip)"
          />
        )}
        {/* art 枠のインク縁 */}
        <rect x={PADX + 12} y={ART_Y} width={W - 2 * (PADX + 12)} height={ART_H}
              fill="none" stroke={SEPIA} strokeWidth="2" rx="4" />
      </g>

      {/* === type 行 === */}
      <g>
        <text x={PADX + 8} y={TYPE_Y + 26} fontSize="22" fontWeight="700"
              fontFamily="'Hiragino Mincho ProN', serif" fill={SEPIA}>
          《 旅人 — {jobName} 》
        </text>
        {tagline && (
          <text x={W - PADX - 8} y={TYPE_Y + 26} fontSize="14"
                fontFamily="'Hiragino Mincho ProN', serif" textAnchor="end" fill={SEPIA_SOFT}>
            {tagline}
          </text>
        )}
      </g>

      <line x1={PADX + 8} y1={STATS_Y - 10} x2={W - PADX - 8} y2={STATS_Y - 10}
            stroke={SEPIA_SOFT} strokeWidth="0.8" strokeDasharray="2 3" />

      {/* === stats 行 === */}
      <g>
        {/* 認知機能 TOP4 */}
        {topCog.map((fn, i) => {
          const score = result.cognitiveScores[fn] ?? 0;
          const x = PADX + 8 + i * ((W - 2 * (PADX + 8)) / 4);
          return (
            <g key={fn}>
              <text x={x} y={STATS_Y + 24} fontSize="18" fontWeight="700"
                    fontFamily="ui-monospace, 'Courier New', monospace" fill={SEPIA}>
                {COG_SHORT[fn]}
              </text>
              <text x={x} y={STATS_Y + 44} fontSize="12"
                    fontFamily="'Hiragino Mincho ProN', serif" fill={SEPIA_SOFT}>
                {COG_JP[fn]}
              </text>
              <text x={x} y={STATS_Y + 74} fontSize="22"
                    fontFamily="ui-monospace, 'Courier New', monospace" fill={SEPIA}>
                {score}
              </text>
            </g>
          );
        })}
        {/* RPG stats 行 */}
        <g transform={`translate(${PADX + 8}, ${STATS_Y + 120})`}>
          {([
            ['攻', result.rpgStats.atk],
            ['守', result.rpgStats.def],
            ['速', result.rpgStats.agi],
            ['知', result.rpgStats.int],
            ['運', result.rpgStats.luk],
          ] as const).map(([label, value], i) => {
            const segW = (W - 2 * (PADX + 8)) / 5;
            const cx = i * segW + segW / 2;
            return (
              <g key={label}>
                <text x={cx} y={0} fontSize="14"
                      fontFamily="'Hiragino Mincho ProN', serif" textAnchor="middle" fill={SEPIA_SOFT}>
                  {label}
                </text>
                <text x={cx} y={28} fontSize="22" fontWeight="700"
                      fontFamily="ui-monospace, 'Courier New', monospace" textAnchor="middle" fill={SEPIA}>
                  {value}
                </text>
              </g>
            );
          })}
        </g>
      </g>

      {/* === flavor === */}
      <g>
        <line x1={PADX + 8} y1={FLAVOR_Y - 6} x2={W - PADX - 8} y2={FLAVOR_Y - 6}
              stroke={SEPIA} strokeWidth="1" />
        <FlavorBlock x={PADX + 12} y={FLAVOR_Y + 22} width={W - 2 * (PADX + 12)} text={flavorText} />
      </g>

      {/* === foot === */}
      <line x1={PADX + 8} y1={H - PADY - 30} x2={W - PADX - 8} y2={H - PADY - 30}
            stroke={SEPIA_SOFT} strokeWidth="0.6" />
      <text x={PADX + 8} y={H - PADY - 8} fontSize="12"
            fontFamily="ui-monospace, 'Courier New', monospace" fill={SEPIA_SOFT}>
        AozoraQuest · {analyzedDate}
      </text>
      <text x={W - PADX - 8} y={H - PADY - 8} fontSize="12"
            fontFamily="ui-monospace, 'Courier New', monospace" textAnchor="end" fill={SEPIA_SOFT}>
        {job.dominantFunction}-{job.auxiliaryFunction}
      </text>
    </svg>
  );
});

/**
 * 折り返し対応のフレーバー描画。SVG の text は wrap しないので、おおよそ
 * 24-26 全角文字ごとに改行する。
 */
function FlavorBlock({ x, y, width, text }: { x: number; y: number; width: number; text: string }) {
  const lines = wrapJa(text, 24);
  return (
    <g>
      {lines.map((line, i) => (
        <text key={i} x={x} y={y + i * 28} fontSize="18" fontStyle="italic"
              fontFamily="'Hiragino Mincho ProN', serif" fill={SEPIA}>
          {line}
        </text>
      ))}
      {/* wrap を超える行数になったら width に収まるスケールを適用する手もあるが、
          sanitize 側で 80 字上限のため通常 3 行で収まる。 */}
      <rect x={x - 8} y={y - 22} width={width} height={(lines.length * 28) + 8}
            fill="none" stroke="none" />
    </g>
  );
}

function wrapJa(text: string, perLine: number): string[] {
  const out: string[] = [];
  let buf = '';
  for (const ch of text) {
    buf += ch;
    if (buf.length >= perLine && /[、。 ・!?!?]/.test(ch)) {
      out.push(buf);
      buf = '';
    } else if (buf.length >= perLine + 4) {
      out.push(buf);
      buf = '';
    }
  }
  if (buf.length > 0) out.push(buf);
  return out.slice(0, 4); // 保険: 最大 4 行
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

