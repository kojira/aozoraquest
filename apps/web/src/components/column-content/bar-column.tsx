/**
 * bar カラム: BAR ブルスコ (= 共鳴 TL を「aozoraquest 利用者が集う酒場」の
 * メタファーで独立カラム化。旧 routes/home.tsx の「共鳴」タブを移設)。
 *
 * directory に opt-in した利用者の投稿が、自分の気質との共鳴順で流れる。
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Archetype, DiagnosisResult } from '@aozoraquest/core';
import { JOBS_BY_ID, resonanceLabel } from '@aozoraquest/core';
import { useSession } from '@/lib/session';
import { getRecord } from '@/lib/atproto';
import { COL } from '@/lib/collections';
import { buildResonanceTimeline, type ResonanceEntry } from '@/lib/resonance-flow';
import { useRuntimeConfig } from '@/components/config-provider';
import { VirtualFeed } from '@/components/virtual-feed';
import { PostArticle } from '@/components/post-article';
import { seedArchetype } from '@/lib/archetype-cache';
import { useColumnScrollEl } from '@/components/workspace';

export function BarColumn() {
  const session = useSession();
  const config = useRuntimeConfig();
  const scrollEl = useColumnScrollEl();
  const agent = session.agent;

  const [selfDiag, setSelfDiag] = useState<DiagnosisResult | null>(null);
  const [feed, setFeed] = useState<ResonanceEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (session.status !== 'signed-in' || !agent || !session.did) return;
    const did = session.did;
    getRecord<DiagnosisResult>(agent, did, COL.analysis, 'self')
      .then((r) => {
        setSelfDiag(r);
        const a = r?.archetype && r.archetype in JOBS_BY_ID ? (r.archetype as Archetype) : null;
        seedArchetype(did, a);
      })
      .catch((e) => console.warn('self analysis load failed', e));
  }, [session.status, agent, session.did]);

  useEffect(() => {
    if (session.status !== 'signed-in' || !agent) return;
    setLoading(true);
    setErr(null);
    const dids = config.directory.map((u) => u.did);
    buildResonanceTimeline(agent, {
      selfDiagnosis: selfDiag,
      selfDid: session.did,
      directoryDids: dids,
    })
      .then((list) => setFeed(list))
      .catch((e) => setErr(String((e as Error)?.message ?? e)))
      .finally(() => setLoading(false));
  }, [session.status, agent, session.did, selfDiag, config.directory]);

  if (session.status !== 'signed-in') {
    return <p style={{ fontSize: '0.85em', color: 'var(--color-muted)' }}>サインインすると酒場の様子が見えます。</p>;
  }

  return (
    <div>
      <p style={{ margin: '0 0 0.6em', fontSize: '0.8em', color: 'var(--color-muted)', lineHeight: 1.5 }}>
        aozoraquest の冒険者が集う酒場。あなたの気質と響きあう人の声から順に流れます。
      </p>
      {!selfDiag && (
        <p style={{ fontSize: '0.85em', color: 'var(--color-muted)' }}>
          あなたの気質がまだ分からないので、新しい順に並べています。
          <Link to="/me">自分のページ</Link> で気質を調べると、あなたに近い人の投稿が先に来るようになります。
        </p>
      )}
      {config.directory.length === 0 && (
        <p style={{ color: 'var(--color-muted)' }}>
          まだ誰も酒場に来ていません。
          <Link to="/settings">設定</Link> から参加すると、似た気質の人たちの投稿が少しずつ集まってきます。
        </p>
      )}
      {loading && <p>読み込み中...</p>}
      {err && <p style={{ color: 'var(--color-danger)' }}>うまく読み込めませんでした: {err}</p>}
      {!loading && feed.length === 0 && !err && config.directory.length > 0 && (
        <p style={{ color: 'var(--color-muted)' }}>
          まだあなたと響きあう投稿が見つかりません。参加者が増えると少しずつ流れてきます。
        </p>
      )}
      <VirtualFeed
        items={feed}
        keyOf={(x) => x.item.post.uri}
        scrollParent={scrollEl}
        renderItem={(entry) => <ResonancePostCard entry={entry} />}
      />
    </div>
  );
}

function ResonancePostCard({ entry }: { entry: ResonanceEntry }) {
  const score = entry.score;
  const resonanceBadge =
    score != null ? (
      <span
        title={`近さ ${((entry.similarity ?? 0) * 100).toFixed(0)} / 補い ${((entry.complementarity ?? 0) * 100).toFixed(0)}`}
        style={{ marginLeft: 'auto', fontSize: '0.75em', color: 'var(--color-accent)' }}
      >
        {resonanceLabel(score)}
      </span>
    ) : null;
  return (
    <PostArticle
      post={entry.item.post}
      archetype={entry.theirArchetype}
      expandable
      {...(resonanceBadge ? { headerExtra: resonanceBadge } : {})}
    />
  );
}
