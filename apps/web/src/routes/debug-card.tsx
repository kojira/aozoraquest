import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { JobCard } from '@/components/job-card';
import type { Archetype, CardType, DiagnosisResult, ManaCost, Rarity } from '@aozoraquest/core';
import { isRarity } from '@aozoraquest/core';

/** 同 origin の fetch → blob → dataURL で inline。CORS が通れば成功。 */
async function fetchAsDataUrl(url: string): Promise<string | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise<string | null>((resolve) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result));
      fr.onerror = () => resolve(null);
      fr.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

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
  const [avatarDataUrl, setAvatarDataUrl] = useState<string | null>(null);
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
        // 1) Playwright runner が事前注入した dataURL を優先 (CORS 越え)。
        const forced = (window as unknown as { __forcedAvatar?: string }).__forcedAvatar;
        if (forced) {
          if (!cancelled) setAvatarDataUrl(forced);
        } else if (data.avatar) {
          // 2) フォールバック: fetch 経由 (CORS 通る環境のみ)
          const inlined = await fetchAsDataUrl(data.avatar);
          if (!cancelled && inlined) setAvatarDataUrl(inlined);
        }
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

  // URL パラメータで JobCard の全フィールドを上書きできるようにする (README ヒーロー
  // 画像など、特定の見え方を再現したい時用)。
  const archetype = (params.get('archetype') ?? 'sage') as Archetype;
  const rarityParam = params.get('rarity') ?? 'rare';
  const rarity: Rarity = isRarity(rarityParam) ? rarityParam : 'rare';
  const cardName = params.get('cardName') ?? undefined;
  const effectName = params.get('effectName') ?? '星読み';
  const effectDescription = params.get('effectDescription') ?? '対象プレイヤーの手札を 1 枚ランダムに公開する。';
  const flavorText = params.get('flavor') ?? '夜の街並みは、星よりも遠くに灯りを散らす。それでも見上げる者には、必ず一つは見つかる。';
  const flavorAttribution = params.get('flavorAttr') ?? 'アゾラ';
  const cardTypeParam = (params.get('cardType') ?? 'creature') as CardType;
  const manaCost: ManaCost = (() => {
    const raw = params.get('manaCost');
    if (!raw) return { U: 1, generic: 2 };
    try { return JSON.parse(raw) as ManaCost; } catch { return { U: 1, generic: 2 }; }
  })();
  const abilityCostRaw = params.get('abilityCost');
  const abilityCost: ManaCost | null = abilityCostRaw === null
    ? null
    : abilityCostRaw === 'null' || abilityCostRaw === ''
      ? null
      : (() => { try { return JSON.parse(abilityCostRaw) as ManaCost; } catch { return null; } })();
  const abilityTap = params.get('tap') === '1';
  const keywords = (params.get('keywords') ?? '').split(/[,、]/).map((s) => s.trim()).filter(Boolean);
  const powerParam = params.get('power');
  const toughnessParam = params.get('toughness');
  const power = powerParam ? Number(powerParam) : undefined;
  const toughness = toughnessParam ? Number(toughnessParam) : undefined;

  const result: DiagnosisResult = {
    archetype,
    rpgStats: { atk: 30, def: 50, agi: 40, int: 95, luk: 60 },
    cognitiveScores: { Ni: 90, Ne: 60, Si: 50, Se: 30, Ti: 80, Te: 50, Fi: 40, Fe: 55 },
    confidence: 'high',
    analyzedPostCount: 250,
    analyzedAt: '2026-04-15T00:00:00Z',
    playerLevel: { xp: 1200, streakDays: 5 },
    jobLevel: { archetype, xp: 800, joinedAt: '2026-04-01T00:00:00Z' },
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
          effectName={effectName}
          effectCost="このカードをタップする。"
          effectDescription={effectDescription}
          flavorText={flavorText}
          flavorAttribution={flavorAttribution}
          rarity={rarity}
          frameVariant={1}
          cardType={cardTypeParam}
          manaCost={manaCost}
          abilityCost={abilityCost}
          abilityTap={abilityTap}
          {...(cardName ? { cardName } : {})}
          {...(keywords.length > 0 ? { keywords } : {})}
          {...(power !== undefined && Number.isFinite(power) ? { power } : {})}
          {...(toughness !== undefined && Number.isFinite(toughness) ? { toughness } : {})}
          displayName={profile.displayName}
          handle={profile.handle}
          artSrc={`/card-art/${archetype}.jpg`}
          {...((avatarDataUrl ?? profile.avatar) ? { avatarSrc: avatarDataUrl ?? profile.avatar! } : {})}
        />
      </div>
    </div>
  );
}
