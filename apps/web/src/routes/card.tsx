import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { Agent, AppBskyActorDefs } from '@atproto/api';
import type { DiagnosisResult } from '@aozoraquest/core';
import { useSession } from '@/lib/session';
import { getRecord, putRecord } from '@/lib/atproto';
import { loadPointsState } from '@/lib/points';
import { generateCardText, getFallbackCardText, type CardText } from '@/lib/flavor-text';
import { cardToPngBlob, downloadBlob, postCardToBluesky } from '@/lib/card-export';
import { JobCard } from '@/components/job-card';
import { CasinoIcon, DownloadIcon, ShareIcon } from '@/components/icons';

type LoadState =
  | { status: 'checking' }
  | { status: 'no-diagnosis' }
  | { status: 'not-summoned' }
  | { status: 'ready'; result: DiagnosisResult; profile: ProfileBrief }
  | { status: 'error'; error: string };

interface ProfileBrief {
  did: string;
  handle: string;
  displayName: string;
  avatar?: string;
}

export function Card() {
  const session = useSession();
  const navigate = useNavigate();
  const [load, setLoad] = useState<LoadState>({ status: 'checking' });
  const [card, setCard] = useState<CardText | null>(null);
  const [flavorBusy, setFlavorBusy] = useState(false);
  const [shareBusy, setShareBusy] = useState<'idle' | 'downloading' | 'posting' | 'posted'>('idle');
  const [shareErr, setShareErr] = useState<string | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  // 初回: session 確認 → 診断 + points ロード
  useEffect(() => {
    if (session.status !== 'signed-in' || !session.agent || !session.did) return;
    const agent = session.agent;
    const did = session.did;
    let cancelled = false;
    (async () => {
      try {
        const [analysis, points, profile] = await Promise.all([
          getRecord<DiagnosisResult>(agent, did, 'app.aozoraquest.analysis', 'self').catch(() => null),
          loadPointsState(agent, did).catch(() => ({ summoned: false } as { summoned: boolean })),
          fetchProfile(agent, did).catch(() => null),
        ]);
        if (cancelled) return;
        if (!analysis) { setLoad({ status: 'no-diagnosis' }); return; }
        if (!points.summoned) { setLoad({ status: 'not-summoned' }); return; }
        const pb: ProfileBrief = {
          did,
          handle: profile?.handle ?? session.handle ?? 'you',
          displayName: profile?.displayName || profile?.handle || session.handle || 'あなた',
          ...(profile?.avatar ? { avatar: profile.avatar } : {}),
        };
        setLoad({ status: 'ready', result: analysis, profile: pb });
        // 既存 flavor text があれば暫定で表示 (effect は新規扱いで再生成)
        if (analysis.flavorText) {
          setCard({
            effect: getFallbackCardText(analysis.archetype, Date.now()).effect,
            flavor: analysis.flavorText,
            source: { kind: 'fallback' },
          });
        }
      } catch (e) {
        if (cancelled) return;
        setLoad({ status: 'error', error: String((e as Error)?.message ?? e) });
      }
    })();
    return () => { cancelled = true; };
  }, [session.status, session.agent, session.did, session.handle]);

  const result = load.status === 'ready' ? load.result : null;
  const profile = load.status === 'ready' ? load.profile : null;
  const artSrc = useMemo(() => (result ? `/card-art/${result.archetype}.jpg` : undefined), [result]);

  // 診断読み込みが終わったら、既存 card が無ければ自動生成
  useEffect(() => {
    if (load.status !== 'ready' || card) return;
    void regenerateCard(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load.status]);

  const regenerateCard = useCallback(async (persist: boolean) => {
    if (load.status !== 'ready') return;
    setFlavorBusy(true);
    try {
      const r = await generateCardText(load.result, { seed: Date.now() });
      setCard(r);
      if (persist || !load.result.flavorText) {
        if (session.status === 'signed-in' && session.agent) {
          try {
            await putRecord(session.agent, 'app.aozoraquest.analysis', 'self', {
              ...load.result,
              flavorText: r.flavor,
              flavorGeneratedAt: new Date().toISOString(),
            });
          } catch (e) {
            console.warn('[card] save flavor failed', e);
          }
        }
      }
    } catch (e) {
      console.warn('[card] regenerate card failed', e);
      setCard(getFallbackCardText(load.result.archetype, Date.now()));
    } finally {
      setFlavorBusy(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load.status, session.status, session.agent]);

  const onDownload = useCallback(async () => {
    if (!svgRef.current || !result) return;
    setShareBusy('downloading');
    setShareErr(null);
    try {
      const blob = await cardToPngBlob(svgRef.current);
      downloadBlob(blob, `aozoraquest-${result.archetype}.png`);
    } catch (e) {
      setShareErr(String((e as Error)?.message ?? e));
    } finally {
      setShareBusy('idle');
    }
  }, [result]);

  const onPost = useCallback(async () => {
    if (!svgRef.current || !result || !profile) return;
    if (session.status !== 'signed-in' || !session.agent) return;
    setShareBusy('posting');
    setShareErr(null);
    try {
      const blob = await cardToPngBlob(svgRef.current);
      const text = `${displayArchetype(result.archetype)} の気質が出ました。 #AozoraQuest`;
      const alt = `${profile.displayName} の診断カード。職業は${displayArchetype(result.archetype)}。`;
      await postCardToBluesky(session.agent, blob, text, alt);
      setShareBusy('posted');
    } catch (e) {
      setShareErr(String((e as Error)?.message ?? e));
      setShareBusy('idle');
    }
  }, [result, profile, session.status, session.agent]);

  if (session.status !== 'signed-in') {
    return (
      <div>
        <h2>カード</h2>
        <p>まずはログインしてください。</p>
      </div>
    );
  }

  if (load.status === 'checking') return <p>読み込み中…</p>;

  if (load.status === 'no-diagnosis') {
    return (
      <div style={{ textAlign: 'center', marginTop: '1em' }}>
        <p>まだ気質が調べられていません。</p>
        <Link to="/me"><button>気質を調べる</button></Link>
      </div>
    );
  }

  if (load.status === 'not-summoned') {
    return (
      <div style={{ textAlign: 'center', marginTop: '1em' }}>
        <p>ブルスコンを召喚してからカードを作れる。</p>
        <p style={{ fontSize: '0.85em', color: 'var(--color-muted)' }}>
          アプリから投稿を重ね、精霊ブルスコンを呼び出そう。
        </p>
        <Link to="/spirit"><button>精霊の社へ</button></Link>
      </div>
    );
  }

  if (load.status === 'error') {
    return <p style={{ color: 'var(--color-danger)' }}>エラー: {load.error}</p>;
  }

  // ready
  return (
    <div style={{ textAlign: 'center' }}>
      <h2 style={{ marginTop: 0 }}>登録証</h2>
      <p style={{ fontSize: '0.85em', color: 'var(--color-muted)' }}>
        ブルスコンが羊皮紙にしたためた、今のあなたの姿。
      </p>

      <div style={{ margin: '1em auto', maxWidth: 420, width: '100%' }}>
        <JobCard
          ref={svgRef}
          result={result!}
          effectText={card?.effect ?? '…'}
          flavorText={card?.flavor ?? '…'}
          displayName={profile!.displayName}
          handle={profile!.handle}
          artSrc={artSrc}
          avatarSrc={profile!.avatar}
          style={{ width: '100%', height: 'auto', display: 'block' }}
        />
      </div>

      <div style={{ display: 'flex', gap: '0.6em', justifyContent: 'center', flexWrap: 'wrap', marginTop: '1em' }}>
        <button disabled={flavorBusy} onClick={() => void regenerateCard(true)}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35em' }}>
            <CasinoIcon size={16} />
            {flavorBusy ? '詩を探している…' : '引き直す'}
          </span>
        </button>
        <button disabled={shareBusy !== 'idle' || !card} onClick={() => void onDownload()}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35em' }}>
            <DownloadIcon size={16} />
            {shareBusy === 'downloading' ? '書き出し中…' : '画像として保存'}
          </span>
        </button>
        <button disabled={shareBusy !== 'idle' || !card} onClick={() => void onPost()}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35em' }}>
            <ShareIcon size={16} />
            {shareBusy === 'posting' ? '投稿中…' : shareBusy === 'posted' ? '投稿しました' : 'Bluesky に投稿'}
          </span>
        </button>
      </div>

      {shareErr && (
        <p style={{ color: 'var(--color-danger)', fontSize: '0.85em', marginTop: '0.6em' }}>
          うまくいきませんでした: {shareErr}
        </p>
      )}

      {shareBusy === 'posted' && (
        <p style={{ marginTop: '0.6em', fontSize: '0.9em' }}>
          投稿しました。<button className="secondary" onClick={() => navigate('/me')}>戻る</button>
        </p>
      )}

      <div style={{ marginTop: '2em' }}>
        <Link to="/me">← 自分の気質に戻る</Link>
      </div>
    </div>
  );
}

async function fetchProfile(agent: Agent, did: string): Promise<AppBskyActorDefs.ProfileViewDetailed | null> {
  try {
    const res = await agent.getProfile({ actor: did });
    return res.data;
  } catch {
    return null;
  }
}

function displayArchetype(id: string): string {
  // jobDisplayName を使わずここで軽く寄せる (import を増やしたくない程度の都合)
  const map: Record<string, string> = {
    sage: '賢者', mage: '魔法使い', shogun: '将軍', bard: '吟遊詩人',
    seer: '予言者', poet: '詩人', paladin: '聖騎士', explorer: '冒険者',
    warrior: '戦士', guardian: '守護者', fighter: '武闘家', artist: '芸術家',
    captain: '隊長', miko: '巫女', ninja: '忍者', performer: '遊び人',
  };
  return map[id] ?? '旅人';
}
