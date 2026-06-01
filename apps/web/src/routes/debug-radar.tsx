import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { RadarChart } from '@/components/radar-chart';
import type { StatVector } from '@aozoraquest/core';

/**
 * ヒーロー画像 (README) 用に、kojira (もしくは指定ハンドル) の analysis を
 * Bluesky 公開 API + PDS から読んでレーダーチャートを描画する dev ルート。
 *
 * 必要なのは:
 *  1. handle → DID  (`app.bsky.actor.getProfile`、CORS open)
 *  2. DID → PDS endpoint (`plc.directory/<did>` の JSON)
 *  3. analysis record (`com.atproto.repo.getRecord`、public read)
 *
 * いずれも未ログインで叩ける。capture-hero-radar.ts から playwright で開いて
 * window.__radarReady を待ち、SVG を screenshot する。
 */
export function DebugRadar() {
  const svgWrapRef = useRef<HTMLDivElement>(null);
  const [params] = useSearchParams();
  const handle = params.get('handle') ?? 'kojira.io';
  const [stats, setStats] = useState<StatVector | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // 1) handle → DID
        const profRes = await fetch(`https://api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=${encodeURIComponent(handle)}`);
        if (!profRes.ok) throw new Error(`profile ${profRes.status}`);
        const { did } = await profRes.json();

        // 2) DID → PDS endpoint
        const plcRes = await fetch(`https://plc.directory/${did}`);
        if (!plcRes.ok) throw new Error(`plc ${plcRes.status}`);
        const plcData = await plcRes.json();
        const pds = (plcData.service ?? []).find((s: { id: string; serviceEndpoint: string }) => s.id === '#atproto_pds')?.serviceEndpoint;
        if (!pds) throw new Error('pds endpoint not found in PLC document');

        // 3) analysis record
        const recRes = await fetch(`${pds}/xrpc/com.atproto.repo.getRecord?repo=${encodeURIComponent(did)}&collection=app.aozoraquest.analysis&rkey=self`);
        if (!recRes.ok) throw new Error(`getRecord ${recRes.status}`);
        const recData = await recRes.json();
        const rpgStats = recData.value?.rpgStats;
        if (!rpgStats) throw new Error('rpgStats not present in analysis record');
        if (cancelled) return;
        setStats(rpgStats as StatVector);
      } catch (e) {
        if (cancelled) return;
        setErr(String((e as Error)?.message ?? e));
      }
    })();
    return () => { cancelled = true; };
  }, [handle]);

  useEffect(() => {
    const w = window as unknown as { __radarReady?: boolean };
    w.__radarReady = !!(stats && svgWrapRef.current);
    return () => { w.__radarReady = false; };
  }, [stats]);

  if (err) {
    return (
      <div style={{ padding: '1em' }}>
        <p style={{ color: 'var(--color-danger)' }}>radar fetch failed: {err}</p>
      </div>
    );
  }
  if (!stats) {
    return <div style={{ padding: '1em' }}>loading {handle}...</div>;
  }

  return (
    <div style={{ padding: '1em' }}>
      <p style={{ fontSize: '0.8em', color: 'var(--color-muted)' }}>
        debug radar (handle={handle})
      </p>
      {/* SVG 内の軸ラベル (「攻 23」等) は viewBox 外にはみ出すため、
       *  撮影時に切れないよう外側に十分な余白を付けたラッパを置く。
       *  background は本文 body の青空グラデが透けて草地ラインが混ざるので、
       *  単色 (アプリのウィンドウ色と同じ濃紺) で上書きして README で読みやすく。
       *  data-hero-radar 属性は capture script の locator 用。 */}
      <div
        ref={svgWrapRef}
        data-hero-radar="1"
        style={{
          display: 'inline-block',
          padding: '40px 140px',
          background: '#0a0420',
          borderRadius: '12px',
        }}
      >
        <RadarChart stats={stats} size={320} max={100} showValues />
      </div>
    </div>
  );
}
