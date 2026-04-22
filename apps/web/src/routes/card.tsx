import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { Agent, AppBskyActorDefs } from '@atproto/api';
import type { DiagnosisResult } from '@aozoraquest/core';
import { useSession } from '@/lib/session';
import { getRecord, putRecord } from '@/lib/atproto';
import type { Rarity } from '@aozoraquest/core';
import { isRarity, rollRarity } from '@aozoraquest/core';
import { loadPointsState, type PointsState } from '@/lib/points';
import { recordCardDraw } from '@/lib/card-power';
import { generateCardText, getFallbackCardText, stripMarkdown, type CardText } from '@/lib/flavor-text';
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
  const [rarity, setRarity] = useState<Rarity>('common');
  const [flavorBusy, setFlavorBusy] = useState(false);
  const [power, setPower] = useState<PointsState | null>(null);
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
        setPower(points as PointsState);
        const pb: ProfileBrief = {
          did,
          handle: profile?.handle ?? session.handle ?? 'you',
          displayName: profile?.displayName || profile?.handle || session.handle || 'あなた',
          ...(profile?.avatar ? { avatar: profile.avatar } : {}),
        };
        setLoad({ status: 'ready', result: analysis, profile: pb });
        // PDS に既存のカード情報があればそのまま表示 (引き直しまで同じ)
        const hasSaved = analysis.flavorText || analysis.cardEffect || analysis.cardRarity;
        if (hasSaved) {
          const savedRarity: Rarity = isRarity(analysis.cardRarity) ? analysis.cardRarity : 'common';
          setRarity(savedRarity);
          setCard({
            effect: analysis.cardEffect
              ? stripMarkdown(analysis.cardEffect)
              : getFallbackCardText(analysis.archetype, Date.now()).effect,
            flavor: analysis.flavorText
              ? stripMarkdown(analysis.flavorText)
              : getFallbackCardText(analysis.archetype, Date.now()).flavor,
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

  // 診断読み込みが終わったら、PDS にカードが無いときだけ初回生成 (コスト 0)
  useEffect(() => {
    if (load.status !== 'ready') return;
    // 既に PDS にカード情報があればそれを見せる (引き直すまで変わらない)
    const hasSaved = load.result.flavorText || load.result.cardEffect || load.result.cardRarity;
    if (hasSaved) return;
    // 初回生成: rarity を抽選して生成 + 保存
    void regenerateCard({ initial: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load.status]);

  const regenerateCard = useCallback(async (opts: { initial?: boolean }) => {
    if (load.status !== 'ready') return;
    if (session.status !== 'signed-in' || !session.agent) return;
    const agent = session.agent;

    // 明示的な引き直し (initial でない) は 1 あおぞらパワーを消費する
    if (!opts.initial) {
      if (!power || power.balance < 1) {
        console.warn('[card] power insufficient');
        return;
      }
      try {
        await recordCardDraw(agent, 'flavor-reroll');
      } catch (e) {
        console.warn('[card] recordCardDraw failed', e);
        return;
      }
      setPower((p) => p ? { ...p, cardDraws: p.cardDraws + 1, balance: Math.max(0, p.balance - 1) } : p);
    }

    setFlavorBusy(true);
    try {
      // レアリティ抽選 (初回も引き直しも毎回)
      const nextRarity = rollRarity();
      setRarity(nextRarity);
      const r = await generateCardText(load.result, nextRarity, { seed: Date.now() });
      setCard(r);
      // PDS に一式保存 (effect + flavor + rarity)
      try {
        const now = new Date().toISOString();
        await putRecord(agent, 'app.aozoraquest.analysis', 'self', {
          ...load.result,
          cardEffect: r.effect,
          flavorText: r.flavor,
          cardRarity: nextRarity,
          cardDrawnAt: now,
          // 後方互換
          flavorGeneratedAt: now,
        });
      } catch (e) {
        console.warn('[card] save card to PDS failed', e);
      }
    } catch (e) {
      console.warn('[card] regenerate card failed', e);
      setCard(getFallbackCardText(load.result.archetype, Date.now()));
    } finally {
      setFlavorBusy(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load.status, session.status, session.agent, power]);

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
          rarity={rarity}
          displayName={profile!.displayName}
          handle={profile!.handle}
          artSrc={artSrc}
          avatarSrc={profile!.avatar}
          style={{ width: '100%', height: 'auto', display: 'block' }}
        />
      </div>

      {power && (
        <p style={{ fontSize: '0.85em', color: 'var(--color-muted)', marginTop: '0.4em' }}>
          あおぞらパワー: <span style={{ color: 'var(--color-accent)', fontFamily: 'ui-monospace, monospace' }}>{power.balance}</span>
          <span style={{ opacity: 0.6, marginLeft: '0.5em' }}>(引き直しで 1 消費)</span>
        </p>
      )}

      <div style={{ display: 'flex', gap: '0.6em', justifyContent: 'center', flexWrap: 'wrap', marginTop: '1em' }}>
        <button
          disabled={flavorBusy || !power || power.balance < 1}
          onClick={() => void regenerateCard({ initial: false })}
        >
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35em' }}>
            <CasinoIcon size={16} />
            {flavorBusy ? '詩を探している…' : (power && power.balance < 1) ? '引き直せない' : '引き直す (−1)'}
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
