import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { JobCard } from '@/components/job-card';
import type { DiagnosisResult } from '@aozoraquest/core';

/**
 * 実カードのサイズ計測用 debug ルート (本番では辿る導線なし、Playwright から /debug/card で開く)。
 *
 * `?handle=xxx.bsky.social` で表示するアバター/displayName を Bluesky 公開 API から取得する。
 * 未指定なら kojira.io をデフォルトに使う。
 *
 * window.__cardSvg に SVG ref を露出するので、テスト側で本物の cardToShareBlob で
 * 圧縮 + サイズ計測ができる。
 */
export function DebugCard() {
  const svgRef = useRef<SVGSVGElement>(null);
  const [params] = useSearchParams();
  const handle = params.get('handle');
  const [profile, setProfile] = useState<{ displayName: string; handle: string; avatar: string | null } | null>(null);
  const [profileErr, setProfileErr] = useState<string | null>(null);

  useEffect(() => {
    if (!handle) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`https://api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=${encodeURIComponent(handle)}`);
        if (!res.ok) throw new Error(`profile fetch ${res.status}`);
        const data = await res.json();
        if (cancelled) return;
        setProfile({
          displayName: data.displayName || data.handle,
          handle: data.handle,
          avatar: data.avatar ?? null,
        });
      } catch (e) {
        if (cancelled) return;
        setProfileErr(String((e as Error)?.message ?? e));
      }
    })();
    return () => { cancelled = true; };
  }, [handle]);

  useEffect(() => {
    if (svgRef.current) {
      (window as unknown as { __cardSvg?: SVGSVGElement }).__cardSvg = svgRef.current;
    }
  }, [profile]);

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

  if (!handle) {
    return (
      <div style={{ padding: '1em' }}>
        <p>?handle=&lt;bluesky-handle&gt; が必要です。</p>
      </div>
    );
  }
  if (profileErr) {
    return (
      <div style={{ padding: '1em' }}>
        <p style={{ color: 'var(--color-danger)' }}>profile fetch failed: {profileErr}</p>
      </div>
    );
  }
  if (!profile) {
    return <div style={{ padding: '1em' }}>loading {handle}...</div>;
  }

  return (
    <div style={{ padding: '1em' }}>
      <p style={{ fontSize: '0.8em', color: 'var(--color-muted)' }}>
        debug: 実 JobCard のサイズ計測専用 (handle={profile.handle})
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
          displayName={profile.displayName}
          handle={profile.handle}
          artSrc="/card-art/sage.jpg"
          {...(profile.avatar ? { avatarSrc: profile.avatar } : {})}
        />
      </div>
    </div>
  );
}
