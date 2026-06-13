/**
 * bar カラム: BAR ブルスコ (= 共鳴 TL を「aozoraquest 利用者が集う酒場」の
 * メタファーで独立カラム化。旧 routes/home.tsx の「共鳴」タブを移設)。
 *
 * directory に opt-in した利用者の投稿が、自分の気質との共鳴順で流れる。
 *
 * buildResonanceTimeline は directory 全 DID の feed + analysis を引く
 * 重い処理 (最大 30 DID × 2 req)。自分の診断が settle するのを待ってから
 * 1 回だけ実行し、epoch ガードで古い結果の後着上書き (race) を防ぐ。
 */
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { resonanceLabel } from '@aozoraquest/core';
import { useSession } from '@/lib/session';
import { buildResonanceTimeline, type ResonanceEntry } from '@/lib/resonance-flow';
import { useRuntimeConfig } from '@/components/config-provider';
import { useSelfDiagnosis } from '@/lib/use-self-diagnosis';
import { VirtualFeed } from '@/components/virtual-feed';
import { PostArticle } from '@/components/post-article';
import { useColumnScrollEl } from '@/components/column-scroll-context';

export function BarColumn() {
  const session = useSession();
  const config = useRuntimeConfig();
  const scrollEl = useColumnScrollEl();
  const agent = session.agent;
  // 共有キャッシュから取る (home と重複 fetch しない)。loaded = settle 済み。
  const { diag: selfDiag, loaded: diagLoaded } = useSelfDiagnosis();

  const [feed, setFeed] = useState<ResonanceEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  /** 実行世代。古い実行の後着結果を捨てる (= race 防止)。 */
  const epochRef = useRef(0);

  useEffect(() => {
    // 診断が settle するまで待つ。settle 前に走らせると「診断なし順序」で
    // 一度構築 → 診断到着で全量再構築、の二重実行になる (レビュー指摘 ★★★)。
    if (session.status !== 'signed-in' || !agent || !diagLoaded) return;
    const epoch = ++epochRef.current;
    setLoading(true);
    setErr(null);
    const dids = config.directory.map((u) => u.did);
    buildResonanceTimeline(agent, {
      selfDiagnosis: selfDiag,
      selfDid: session.did,
      directoryDids: dids,
    })
      .then((list) => {
        if (epochRef.current === epoch) setFeed(list);
      })
      .catch((e) => {
        if (epochRef.current === epoch) setErr(String((e as Error)?.message ?? e));
      })
      .finally(() => {
        if (epochRef.current === epoch) setLoading(false);
      });
  }, [session.status, agent, session.did, diagLoaded, selfDiag, config.directory]);

  if (session.status !== 'signed-in') {
    return <p style={{ fontSize: '0.85em', color: 'var(--color-muted)' }}>サインインすると酒場の様子が見えます。</p>;
  }

  return (
    <div>
      <p style={{ margin: '0 0 0.6em', fontSize: '0.8em', color: 'var(--color-muted)', lineHeight: 1.5 }}>
        aozoraquest の冒険者が集う酒場。あなたの気質と響きあう人の声から順に流れます。
      </p>
      {diagLoaded && !selfDiag && (
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
      {(loading || !diagLoaded) && <p>読み込み中...</p>}
      {err && <p style={{ color: 'var(--color-danger)' }}>うまく読み込めませんでした: {err}</p>}
      {diagLoaded && !loading && feed.length === 0 && !err && config.directory.length > 0 && (
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
