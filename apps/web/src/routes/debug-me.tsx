/**
 * README ヒーロー画像 用に、handle 指定で me ページ相当の画面を public API
 * だけでレンダリングする dev only ルート。実 me ページは認証必須なので
 * playwright で撮れない。
 *
 *  1. handle → DID (`app.bsky.actor.getProfile`)
 *  2. DID → PDS endpoint (`plc.directory/<did>`)
 *  3. analysis レコード (`com.atproto.repo.getRecord`、public read)
 *  4. profile レコード (targetArchetype 取得用)
 *
 * 取得した analysis を `<ResultView>` (me.tsx から export) に渡して、ヘッダー
 * 部分は debug-me 内で簡易再現する。
 */
import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { Archetype, DiagnosisResult } from '@aozoraquest/core';
import { JOBS_BY_ID, jobDisplayName, jobLevelFromXp, jobTagline, playerLevelFromXp } from '@aozoraquest/core';
import { Avatar } from '@/components/avatar';
import { ResultView } from './me';

interface BskyProfile {
  did: string;
  handle: string;
  displayName?: string;
  avatar?: string;
}

interface AozoraProfile {
  targetArchetype?: string;
}

export function DebugMe() {
  const [params] = useSearchParams();
  const handle = params.get('handle') ?? 'kojira.io';
  const [profile, setProfile] = useState<BskyProfile | null>(null);
  const [analysis, setAnalysis] = useState<DiagnosisResult | null>(null);
  const [aozoraProfile, setAozoraProfile] = useState<AozoraProfile | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // 1) handle → DID + Bluesky プロフィール
        const profRes = await fetch(`https://api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=${encodeURIComponent(handle)}`);
        if (!profRes.ok) throw new Error(`profile ${profRes.status}`);
        const profData = await profRes.json();

        // 2) DID → PDS endpoint
        const plcRes = await fetch(`https://plc.directory/${profData.did}`);
        if (!plcRes.ok) throw new Error(`plc ${plcRes.status}`);
        const plcData = await plcRes.json();
        const pds = (plcData.service ?? []).find((s: { id: string; serviceEndpoint: string }) => s.id === '#atproto_pds')?.serviceEndpoint;
        if (!pds) throw new Error('pds endpoint not found in PLC document');

        // 3) analysis レコード
        const recRes = await fetch(`${pds}/xrpc/com.atproto.repo.getRecord?repo=${encodeURIComponent(profData.did)}&collection=app.aozoraquest.analysis&rkey=self`);
        if (!recRes.ok) throw new Error(`analysis ${recRes.status}`);
        const recData = await recRes.json();
        if (!recData.value) throw new Error('analysis record empty');

        // 4) profile レコード (targetArchetype 任意)
        let aozoraVal: AozoraProfile = {};
        try {
          const pRes = await fetch(`${pds}/xrpc/com.atproto.repo.getRecord?repo=${encodeURIComponent(profData.did)}&collection=app.aozoraquest.profile&rkey=self`);
          if (pRes.ok) {
            const pData = await pRes.json();
            aozoraVal = pData.value ?? {};
          }
        } catch {/* optional */}

        if (cancelled) return;
        setProfile(profData);
        setAnalysis(recData.value as DiagnosisResult);
        setAozoraProfile(aozoraVal);
      } catch (e) {
        if (cancelled) return;
        setErr(String((e as Error)?.message ?? e));
      }
    })();
    return () => { cancelled = true; };
  }, [handle]);

  useEffect(() => {
    const w = window as unknown as { __meReady?: boolean };
    w.__meReady = !!(profile && analysis && wrapRef.current);
    return () => { w.__meReady = false; };
  }, [profile, analysis]);

  if (err) return <div style={{ padding: '1em' }}><p style={{ color: 'var(--color-danger)' }}>me fetch failed: {err}</p></div>;
  if (!profile || !analysis) return <div style={{ padding: '1em' }}>loading {handle}...</div>;

  const myArchetype: Archetype | null =
    analysis.archetype && analysis.archetype in JOBS_BY_ID ? (analysis.archetype as Archetype) : null;
  const targetArchetype: Archetype | null =
    aozoraProfile?.targetArchetype && aozoraProfile.targetArchetype in JOBS_BY_ID
      ? (aozoraProfile.targetArchetype as Archetype)
      : null;
  const myJobXp = analysis.jobLevel?.xp ?? 0;
  const myJobLv = jobLevelFromXp(myJobXp);
  const myPlayerXp = analysis.playerLevel?.xp ?? 0;
  const myPlayerLv = playerLevelFromXp(myPlayerXp);

  return (
    // README 用のヒーロー画像なので、本物の AppShell + 背景なしで content だけ
    // 撮りやすいよう独立した dq-window 風コンテナで包む。
    <div
      ref={wrapRef}
      data-hero-me="1"
      style={{
        display: 'inline-block',
        width: '480px',
        padding: '20px 24px',
        background: 'rgba(0, 0, 0, 0.78)',
        border: '3px solid #ffffff',
        borderRadius: '4px',
        color: '#ffffff',
        fontFamily: "'Hiragino Maru Gothic ProN', 'Hiragino Maru Gothic Pro', 'Noto Sans JP', sans-serif",
      }}
    >
      <div style={{ textAlign: 'center' }}>
        {/* ヘッダー (me.tsx と同等) */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.8em' }}>
          <Avatar src={profile.avatar} size={72} archetype={myArchetype} />
          <div>
            <h2 style={{ margin: 0 }}>{profile.handle}</h2>
            {myArchetype && (
              <p style={{ margin: 0, fontSize: '0.85em', color: 'var(--color-muted)' }}>
                <span style={{ color: 'var(--color-muted)' }}>今:</span>{' '}
                {jobDisplayName(myArchetype, 'default')}
                <span style={{ marginLeft: '0.4em', fontFamily: 'ui-monospace, monospace', color: 'var(--color-accent)' }}>
                  LV{myJobLv}
                </span>
                <span style={{ marginLeft: '0.5em', fontSize: '0.9em' }}>{jobTagline(myArchetype)}</span>
              </p>
            )}
            <p style={{ margin: '0.15em 0 0', fontSize: '0.8em', color: 'var(--color-muted)' }}>
              <span>全体:</span>{' '}
              <span style={{ fontFamily: 'ui-monospace, monospace' }}>LV{myPlayerLv}</span>
              <span style={{ marginLeft: '0.5em', opacity: 0.8 }}>(累計 {myPlayerXp} XP)</span>
            </p>
            <p style={{ margin: '0.15em 0 0', fontSize: '0.85em', color: 'var(--color-muted)' }}>
              <span style={{ color: 'var(--color-muted)' }}>目指す:</span>{' '}
              {targetArchetype ? (
                <>
                  <span style={{ color: 'var(--color-fg)' }}>{jobDisplayName(targetArchetype, 'default')}</span>
                  <span style={{ marginLeft: '0.5em', fontSize: '0.9em' }}>{jobTagline(targetArchetype)}</span>
                </>
              ) : (
                <span>未設定</span>
              )}
            </p>
          </div>
        </div>

        {/* 本体 (レーダー + 認知機能 + 相性) */}
        <ResultView result={analysis} onRerun={() => undefined} />
      </div>
    </div>
  );
}
