import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { Rarity } from '@aozoraquest/core';

/**
 * カードパック開封演出のフルスクリーンオーバーレイ。
 *
 * 4 段階:
 *   package  - パックが中央に登場 (~700ms)
 *   tearing  - シールが剥がれ、紙片が飛び散り、破れ線が走る (~900ms)
 *   emerge   - パックの口から光が漏れ、カードの端が覗いて呼吸する (loop)
 *              llmDone を待つ。最低 MIN_EMERGE_MS は見せる。
 *   reveal   - カードがパックから飛び出してフラッシュ → onComplete
 *
 * 役割: LLM 生成 (Gemini Nano の初回ロードは特に長い) を「パック開封の儀式」で
 * 隠す。emerge ループは無限なので、推論が長引いてもユーザーは「もうすぐ出る」
 * 感を維持できる。MAX_TOTAL_MS で tail safety。
 */
export interface CardPackOverlayProps {
  /** 抽選結果のレアリティ。演出の派手さに連動。 */
  rarity: Rarity;
  /** LLM 生成が終わったか。true になったら emerge → reveal へ進める。 */
  llmDone: boolean;
  /** reveal アニメーションが終わって閉じてよくなった時点で呼ぶ。 */
  onComplete: () => void;
}

type Stage = 'package' | 'tearing' | 'emerge' | 'reveal';

const PACKAGE_MS = 700;
const TEARING_MS = 900;
const MIN_EMERGE_MS = 700;
const REVEAL_MS = 1100;
const MAX_TOTAL_MS = 30000;

const SHRED_COUNT: Record<Rarity, number> = {
  common: 8,
  uncommon: 12,
  rare: 16,
  srare: 22,
  ssr: 30,
  ur: 40,
};

export function CardPackOverlay({ rarity, llmDone, onComplete }: CardPackOverlayProps) {
  const [stage, setStage] = useState<Stage>('package');
  const startedAt = useRef<number>(performance.now());
  const emergeStartedAt = useRef<number | null>(null);

  useEffect(() => {
    if (stage !== 'package') return;
    const t = setTimeout(() => setStage('tearing'), PACKAGE_MS);
    return () => clearTimeout(t);
  }, [stage]);

  useEffect(() => {
    if (stage !== 'tearing') return;
    const t = setTimeout(() => {
      emergeStartedAt.current = performance.now();
      setStage('emerge');
    }, TEARING_MS);
    return () => clearTimeout(t);
  }, [stage]);

  useEffect(() => {
    if (stage !== 'emerge') return;
    if (!llmDone) {
      const elapsedTotal = performance.now() - startedAt.current;
      const wait = Math.max(0, MAX_TOTAL_MS - elapsedTotal);
      const t = setTimeout(() => setStage('reveal'), wait);
      return () => clearTimeout(t);
    }
    const since = performance.now() - (emergeStartedAt.current ?? performance.now());
    const wait = Math.max(0, MIN_EMERGE_MS - since);
    const t = setTimeout(() => setStage('reveal'), wait);
    return () => clearTimeout(t);
  }, [stage, llmDone]);

  useEffect(() => {
    if (stage !== 'reveal') return;
    const t = setTimeout(onComplete, REVEAL_MS);
    return () => clearTimeout(t);
  }, [stage, onComplete]);

  const shredCount = SHRED_COUNT[rarity];

  return (
    <div
      className="cp-overlay"
      data-stage={stage}
      data-rarity={rarity}
      aria-live="polite"
      aria-label="カードパックを開封中"
    >
      <div className="cp-aura" />
      <div className="cp-stage">
        <div className="cp-rays">
          {RAY_ANGLES.map((a) => (
            <span key={a} style={{ ['--a' as string]: a } as CSSProperties} />
          ))}
        </div>
        <div className="cp-rings">
          <span /><span /><span />
        </div>

        <div className="cp-pack">
          <div className="cp-pack-shake">
            <div className="cp-card-peek">
              <div className="cp-card-edge" />
              <div className="cp-card-glow" />
            </div>
            <div className="cp-pack-body">
              <div className="cp-pack-foil" />
              <div className="cp-pack-shine" />
              <div className="cp-pack-tear" />
              <div className="cp-pack-seal" />
            </div>
          </div>
        </div>

        <div className="cp-shreds">
          {Array.from({ length: shredCount }).map((_, i) => {
            const angDeg = (i * 360) / shredCount + ((i * 37) % 60) - 30;
            const dist = 80 + ((i * 41) % 140);
            const rot = ((i * 73) % 720) - 360;
            const delay = (i % 10) * 0.04;
            return (
              <span
                key={i}
                style={{
                  ['--tx' as string]: `${Math.cos((angDeg * Math.PI) / 180) * dist}px`,
                  ['--ty' as string]: `${Math.sin((angDeg * Math.PI) / 180) * dist}px`,
                  ['--rot' as string]: `${rot}deg`,
                  ['--d' as string]: `${delay}s`,
                  ['--i' as string]: i,
                } as CSSProperties}
              />
            );
          })}
        </div>

        <div className="cp-big-sparkles">
          {BIG_SPARKLE_POS.map((p, i) => (
            <span
              key={i}
              style={{
                ['--x' as string]: p.x,
                ['--y' as string]: p.y,
                ['--d' as string]: `${p.delay}s`,
              } as CSSProperties}
            />
          ))}
        </div>
      </div>
      <div className="cp-flash" />
    </div>
  );
}

const RAY_ANGLES = [0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330];

const BIG_SPARKLE_POS: Array<{ x: string; y: string; delay: number }> = [
  { x: '12%', y: '20%', delay: 0.0 },
  { x: '78%', y: '12%', delay: 0.25 },
  { x: '85%', y: '60%', delay: 0.5 },
  { x: '8%',  y: '70%', delay: 0.75 },
  { x: '50%', y: '8%',  delay: 0.35 },
  { x: '50%', y: '88%', delay: 0.6 },
  { x: '22%', y: '45%', delay: 0.9 },
  { x: '72%', y: '35%', delay: 0.15 },
];
