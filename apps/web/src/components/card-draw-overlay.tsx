import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { Rarity } from '@aozoraquest/core';

/**
 * カード抽選演出のフルスクリーンオーバーレイ。
 *
 * 3 段階で展開:
 *   drawing  - 暗闇に光るカード裏面が回転。汎用 (rarity 不明 or 初期)
 *   sensing  - rarity が判明したら色付きのオーラ・粒子・(上位レアは) 光線/
 *              shockwave/虹色 conic がフェードイン。シェイク (SSR/UR のみ)
 *   reveal   - LLM が完了 + 最低 PRE_REVEAL_MS 経過したらフィナーレ。
 *              フラッシュ + カードが消える → onComplete で呼び出し側が state を
 *              コミットしオーバーレイを閉じる
 *
 * 演出の役割: LLM 生成の待ち時間 (1-5 秒) を「カードを引いている儀式の時間」
 * に見立てて隠す。レアリティが演出の途中で変わるので、上位レアを引いた瞬間に
 * 感情的なピークが来る。
 */
export interface CardDrawOverlayProps {
  /** 抽選結果のレアリティ。drawing 中も即セット (sensing で色出すため)。 */
  rarity: Rarity;
  /** LLM 生成が終わったか。true になったら reveal へ移行できる。 */
  llmDone: boolean;
  /** reveal アニメーションが終わって閉じてよくなった時点で呼ぶ。 */
  onComplete: () => void;
}

type Stage = 'drawing' | 'sensing' | 'reveal';

/** drawing → sensing への切替 (rarity の色が出るタイミング)。 */
const DRAWING_MS = 900;
/** click 〜 reveal までの最低時間 (LLM が早く終わっても演出を見せる)。 */
const PRE_REVEAL_MS = 2400;
/** reveal アニメーションが完了して onComplete を呼ぶまで。 */
const REVEAL_MS = 1300;

export function CardDrawOverlay({ rarity, llmDone, onComplete }: CardDrawOverlayProps) {
  const [stage, setStage] = useState<Stage>('drawing');
  const startedAtRef = useRef<number>(performance.now());

  // drawing → sensing
  useEffect(() => {
    if (stage !== 'drawing') return;
    const elapsed = performance.now() - startedAtRef.current;
    const wait = Math.max(0, DRAWING_MS - elapsed);
    const t = setTimeout(() => setStage('sensing'), wait);
    return () => clearTimeout(t);
  }, [stage]);

  // sensing → reveal (LLM 完了 AND 最低時間経過)
  useEffect(() => {
    if (stage !== 'sensing' || !llmDone) return;
    const elapsed = performance.now() - startedAtRef.current;
    const wait = Math.max(0, PRE_REVEAL_MS - elapsed);
    const t = setTimeout(() => setStage('reveal'), wait);
    return () => clearTimeout(t);
  }, [stage, llmDone]);

  // reveal → onComplete
  useEffect(() => {
    if (stage !== 'reveal') return;
    const t = setTimeout(onComplete, REVEAL_MS);
    return () => clearTimeout(t);
  }, [stage, onComplete]);

  return (
    <div
      className="cd-overlay"
      data-stage={stage}
      data-rarity={rarity}
      aria-live="polite"
      aria-label="カードを抽選中"
    >
      <div className="cd-aura" />
      <div className="cd-stage">
        <div className="cd-rays">
          {RAY_ANGLES.map((a) => (
            <span key={a} style={{ ['--a' as string]: a } as CSSProperties} />
          ))}
        </div>
        <div className="cd-rings">
          <span /><span /><span />
        </div>
        <div className="cd-particles">
          {Array.from({ length: 13 }).map((_, i) => (
            <span key={i} style={{ ['--i' as string]: i } as CSSProperties} />
          ))}
        </div>
        <div className="cd-card-wrap">
          <div className="cd-card" />
        </div>
        <div className="cd-big-sparkles">
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
        {/* レアリティはテキストで明示しない。色 / 粒子 / 光線 / シェイク の強度差で
         *  ユーザーが視覚的に察するのが TCG 抽選演出の作法。 */}
      </div>
      <div className="cd-flash" />
    </div>
  );
}

const RAY_ANGLES = [0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330];

const BIG_SPARKLE_POS: Array<{ x: string; y: string; delay: number }> = [
  { x: '12%',  y: '20%', delay: 0.0  },
  { x: '78%',  y: '12%', delay: 0.25 },
  { x: '85%',  y: '60%', delay: 0.5  },
  { x: '8%',   y: '70%', delay: 0.75 },
  { x: '50%',  y: '8%',  delay: 0.35 },
  { x: '50%',  y: '88%', delay: 0.6  },
  { x: '22%',  y: '45%', delay: 0.9  },
  { x: '72%',  y: '35%', delay: 0.15 },
];
