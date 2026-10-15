import { useMemo, type CSSProperties, type ReactElement } from 'react';
import { SpiritIcon } from './spirit-icon';

/** 儀式の位相。gathering → forming → awakening → greeting (待ち) → emerging (出現) の順に進む。 */
export type RitualPhase = 'gathering' | 'forming' | 'awakening' | 'greeting' | 'emerging';

interface RitualStageProps {
  phase: RitualPhase;
  /** 下部のナレーション。key が変わるたびにフェードで差し替わる。 */
  narration: string;
  narrationKey: string;
  /** 待ちが長い時の小さな添え書き (「もう少しで姿が現れる」)。 */
  hint?: string | undefined;
  label: string;
}

const STAR_COUNT = 34;
const MOTE_COUNT = 26;
const BURST_COUNT = 14;

/**
 * 召喚の儀式の見た目 (夜明け前の空 → 光の粒が集まる → 魔法陣 → 精霊のシルエットが形になる → 出現)。
 * 動くのは transform と opacity だけ (スマホで 60fps を保つため。filter / box-shadow はアニメーションしない)。
 * 乱数の配置は mount 時に 1 回だけ決める (再描画で粒子が飛ばないように)。
 */
export function RitualStage({ phase, narration, narrationKey, hint, label }: RitualStageProps) {
  const stars = useMemo(() => buildStars(STAR_COUNT), []);
  const motes = useMemo(() => buildMotes(MOTE_COUNT), []);
  const emerging = phase === 'emerging';
  const step = { gathering: 0, forming: 1, awakening: 2, greeting: 3, emerging: 4 }[phase];

  return (
    <div className={`summon-overlay summon-step-${step}`} role="dialog" aria-modal="true" aria-label={label}>
      <div className="summon-sky" aria-hidden />
      <div className="summon-dawn" aria-hidden />
      <div className="summon-stars" aria-hidden>{stars}</div>
      {emerging && <div className="summon-flash" aria-hidden />}

      <div className="summon-stage" aria-hidden>
        <div className="summon-rays" />
        <svg className="summon-circle" viewBox="0 0 200 200">
          <circle cx="100" cy="100" r="92" className="summon-circle-outer" />
          <circle cx="100" cy="100" r="78" className="summon-circle-inner" />
          <polygon points={triangle(100, 100, 70, -90)} className="summon-circle-star" />
          <polygon points={triangle(100, 100, 70, 90)} className="summon-circle-star" />
        </svg>
        <div className="summon-core" />
        {!emerging && <div className="summon-motes">{motes}</div>}

        <div className={`summon-silhouette${emerging ? ' emerging' : ''}`}>
          <div className="summon-figure summon-figure-shadow">
            <SpiritIcon size={180} sleeping />
          </div>
          <div className="summon-figure summon-figure-color">
            <SpiritIcon size={180} sleeping={step < 2} />
          </div>
        </div>

        {(phase === 'awakening' || phase === 'greeting') && (
          <>
            <span className="summon-sparkle" style={{ top: '10%', left: '20%' }} />
            <span className="summon-sparkle" style={{ top: '15%', right: '18%', animationDelay: '0.3s' }} />
            <span className="summon-sparkle" style={{ bottom: '20%', left: '12%', animationDelay: '0.6s' }} />
            <span className="summon-sparkle" style={{ bottom: '15%', right: '22%', animationDelay: '0.9s' }} />
          </>
        )}

        {emerging && Array.from({ length: BURST_COUNT }).map((_, i) => (
          <span
            key={i}
            className="summon-burst"
            style={{ ['--angle' as string]: `${(360 / BURST_COUNT) * i}deg`, animationDelay: `${(i % 3) * 0.05}s` } as CSSProperties}
          />
        ))}
      </div>

      {!emerging && narration && (
        <div key={narrationKey} className="summon-narration">{narration}</div>
      )}
      {emerging && <div className="summon-announce">ブルスコン、あらわれた!</div>}
      {!emerging && hint && <div className="summon-hint">{hint}</div>}
    </div>
  );
}

/** 中心 (cx, cy)・半径 r の正三角形。上向き (-90) と下向き (90) を重ねて六芒星にする。 */
function triangle(cx: number, cy: number, r: number, startDeg: number): string {
  return [0, 1, 2].map((i) => {
    const a = ((startDeg + 120 * i) * Math.PI) / 180;
    return `${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`;
  }).join(' ');
}

function buildStars(n: number): ReactElement[] {
  return Array.from({ length: n }, (_, i) => (
    <span
      key={i}
      className="summon-star"
      style={{
        left: `${Math.random() * 100}%`,
        top: `${Math.random() * 62}%`,
        ['--s' as string]: (0.6 + Math.random() * 1.4).toFixed(2),
        animationDelay: `${(Math.random() * 4).toFixed(2)}s`,
        animationDuration: `${(2.4 + Math.random() * 2.4).toFixed(2)}s`,
      } as CSSProperties}
    />
  ));
}

/** 光の粒: 画面の外周から中心へ、少し回りながら吸い込まれていく。 */
function buildMotes(n: number): ReactElement[] {
  return Array.from({ length: n }, (_, i) => {
    const angle = (360 / n) * i + Math.random() * 12;
    const dist = 150 + Math.random() * 120;
    return (
      <span
        key={i}
        className="summon-mote"
        style={{
          ['--a' as string]: `${angle.toFixed(1)}deg`,
          ['--d' as string]: `${dist.toFixed(0)}px`,
          ['--sz' as string]: `${(2 + Math.random() * 3).toFixed(1)}px`,
          animationDelay: `${(Math.random() * 3).toFixed(2)}s`,
          animationDuration: `${(2.6 + Math.random() * 1.6).toFixed(2)}s`,
        } as CSSProperties}
      />
    );
  });
}
