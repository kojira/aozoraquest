import { useEffect, useRef } from 'react';
import { JobCard } from '@/components/job-card';
import type { DiagnosisResult } from '@aozoraquest/core';

/**
 * 実カードのサイズ計測用 debug ルート (本番では辿る導線なし、Playwright から /debug/card で開く)。
 * 実 JobCard を mock データでマウントして window.__cardSvg に SVG ref を露出する。
 * これによりテストから本物の出力を rasterize → 圧縮できる。
 */
export function DebugCard() {
  const svgRef = useRef<SVGSVGElement>(null);
  useEffect(() => {
    if (svgRef.current) {
      (window as unknown as { __cardSvg?: SVGSVGElement }).__cardSvg = svgRef.current;
    }
  }, []);

  const result: DiagnosisResult = {
    archetype: 'sage',
    rpgStats: { atk: 30, def: 50, agi: 40, int: 95, luk: 60 },
    cognitiveScores: { Ni: 90, Ne: 60, Si: 50, Se: 30, Ti: 80, Te: 50, Fi: 40, Fe: 55 },
    confidence: 'high',
    analyzedPostCount: 250,
    analyzedAt: '2026-04-15T00:00:00Z',
    playerLevel: { xp: 1200, streakDays: 5 },
    jobLevel: { archetype: 'sage', xp: 800, joinedAt: '2026-04-01T00:00:00Z' },
  };

  return (
    <div style={{ padding: '1em' }}>
      <p style={{ fontSize: '0.8em', color: 'var(--color-muted)' }}>
        debug: 実 JobCard のサイズ計測専用ページ。
      </p>
      <div style={{ width: '320px' }}>
        <JobCard
          ref={svgRef}
          result={result}
          effectName="星読み"
          effectCost="このカードをタップする。"
          effectDescription="対象プレイヤーの手札を 1 枚ランダムに公開する。"
          flavorText="夜の街並みは、星よりも遠くに灯りを散らす。それでも見上げる者には、必ず一つは見つかる。"
          flavorAttribution="アゾラ"
          rarity="rare"
          frameVariant={1}
          displayName="テスト太郎"
          handle="test.bsky.social"
          artSrc="/card-art/sage.jpg"
          avatarSrc="https://avatar.cdn.bsky.app/img/avatar/plain/did%3Aplc%3Atest/test%40jpeg"
        />
      </div>
    </div>
  );
}
