import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { Agent, AppBskyActorDefs, AppBskyFeedDefs } from '@atproto/api';
import type { DiagnosisResult, ResonanceDetail, StatArray } from '@aozoraquest/core';
import { DIAGNOSIS_MIN_POST_COUNT, jobDisplayName, jobTagline, resonance, resonanceBreakdown, resonanceLabel, statVectorToArray } from '@aozoraquest/core';
import { useSession } from '@/lib/session';
import { getRecord } from '@/lib/atproto';
import { runDiagnosisForOther } from '@/lib/diagnosis-flow';
import { Avatar } from '@/components/avatar';
import { RadarChart } from '@/components/radar-chart';
import { PostArticle } from '@/components/post-article';
import { PostText } from '@/components/post-text';
import { VirtualFeed } from '@/components/virtual-feed';
import { useInfiniteFeed } from '@/lib/use-infinite-feed';

interface LoadState {
  kind: 'loading' | 'not-found' | 'ok' | 'error';
  profile?: AppBskyActorDefs.ProfileViewDetailed;
  did?: string;
  theirDiag?: DiagnosisResult | null;
  myDiag?: DiagnosisResult | null;
  error?: string;
}

export function Profile() {
  const { handle } = useParams<{ handle: string }>();
  const session = useSession();
  const [state, setState] = useState<LoadState>({ kind: 'loading' });

  useEffect(() => {
    if (session.status !== 'signed-in' || !session.agent || !handle) return;
    const agent = session.agent;
    const myDid = session.did;
    let cancelled = false;
    (async () => {
      try {
        const pRes = await agent.getProfile({ actor: handle });
        if (cancelled) return;
        const profile = pRes.data;
        const theirDid = profile.did;

        const [theirDiag, myDiag] = await Promise.all([
          getRecord<DiagnosisResult>(agent, theirDid, 'app.aozoraquest.analysis', 'self').catch(() => null),
          myDid ? getRecord<DiagnosisResult>(agent, myDid, 'app.aozoraquest.analysis', 'self').catch(() => null) : Promise.resolve(null),
        ]);
        if (cancelled) return;
        setState({ kind: 'ok', profile, did: theirDid, theirDiag, myDiag });
      } catch (e) {
        if (cancelled) return;
        const msg = String((e as Error)?.message ?? e);
        if (/Profile not found|not found/i.test(msg)) {
          setState({ kind: 'not-found' });
        } else {
          setState({ kind: 'error', error: msg });
        }
      }
    })();
    return () => { cancelled = true; };
  }, [session.status, session.agent, session.did, handle]);

  if (session.status !== 'signed-in' || !session.agent) {
    return (
      <div>
        <h2>@{handle}</h2>
        <p>まずはログインしてください。</p>
      </div>
    );
  }

  if (state.kind === 'loading') return <p>読み込み中...</p>;
  if (state.kind === 'not-found') return (
    <div>
      <h2>@{handle}</h2>
      <p style={{ color: 'var(--color-muted)' }}>このユーザーは見つかりませんでした。</p>
    </div>
  );
  if (state.kind === 'error') return (
    <div>
      <h2>@{handle}</h2>
      <p style={{ color: 'var(--color-danger)' }}>うまく読み込めませんでした: {state.error}</p>
    </div>
  );

  const { profile, theirDiag, myDiag } = state;
  if (!profile) return null;

  const isSelf = profile.did === session.did;
  const both = theirDiag && myDiag;
  const detail: ResonanceDetail | null = both
    ? resonance(
        statVectorToArray(myDiag.rpgStats),
        statVectorToArray(theirDiag.rpgStats),
        myDiag.archetype,
        theirDiag.archetype,
      )
    : null;

  return (
    <div>
      <section className="dq-window">
        <div style={{ display: 'flex', gap: '0.8em', alignItems: 'center' }}>
          <Avatar src={profile.avatar} size={56} archetype={theirDiag?.archetype ?? null} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: '1.1em', fontWeight: 700 }}>{profile.displayName || profile.handle}</div>
            <div style={{ fontSize: '0.85em', color: 'var(--color-muted)' }}>@{profile.handle}</div>
          </div>
          {!isSelf && session.agent && (
            <FollowButton
              agent={session.agent}
              did={profile.did}
              initialFollowingUri={profile.viewer?.following}
            />
          )}
        </div>
        {profile.description && (
          <PostText text={profile.description} style={{ marginTop: '0.6em', fontSize: '0.9em' }} />
        )}
        <div style={{ marginTop: '0.6em', fontSize: '0.8em', color: 'var(--color-muted)' }}>
          フォロー {profile.followsCount ?? 0} · フォロワー {profile.followersCount ?? 0} · 投稿 {profile.postsCount ?? 0}
        </div>
      </section>

      {!isSelf && (
        <section className="dq-window" style={{ marginTop: '0.8em' }}>
          <h3 style={{ fontSize: '0.95em', margin: '0 0 0.5em' }}>このユーザーとの相性</h3>
          {!theirDiag ? (
            <EstimateOtherPanel
              agent={session.agent}
              actor={profile.did}
              displayName={profile.displayName || profile.handle}
              onEstimated={(r) =>
                setState((prev) => (prev.kind === 'ok' ? { ...prev, theirDiag: r } : prev))
              }
            />
          ) : !myDiag ? (
            <p style={{ fontSize: '0.85em', color: 'var(--color-muted)', margin: 0 }}>
              あなた自身の気質がまだ調べられていません。<Link to="/me">自分のページ</Link> で調べてみてください。
            </p>
          ) : detail ? (
            <CompatView
              detail={detail}
              myStats={statVectorToArray(myDiag.rpgStats)}
              theirStats={statVectorToArray(theirDiag.rpgStats)}
              theirJob={jobDisplayName(theirDiag.archetype, 'default')}
              myJob={jobDisplayName(myDiag.archetype, 'default')}
            />
          ) : null}
        </section>
      )}

      {isSelf && theirDiag && (
        <section className="dq-window" style={{ marginTop: '0.8em' }}>
          <p style={{ margin: 0, fontSize: '0.9em' }}>
            今の姿: <strong>{jobDisplayName(theirDiag.archetype, 'default')}</strong>
            <span style={{ marginLeft: '0.5em', fontSize: '0.85em', color: 'var(--color-muted)' }}>
              {jobTagline(theirDiag.archetype)}
            </span>
          </p>
        </section>
      )}

      <div style={{ marginTop: '1em' }}>
        <RecentPosts agent={session.agent} did={profile.did} />
      </div>
    </div>
  );
}

function CompatView({
  detail,
  myStats,
  theirStats,
  myJob,
  theirJob,
}: {
  detail: ResonanceDetail;
  myStats: StatArray;
  theirStats: StatArray;
  myJob: string;
  theirJob: string;
}) {
  const pct = (x: number) => `${Math.round(x * 100)}`;
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '1em', flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: '2em', fontWeight: 700, lineHeight: 1 }}>{pct(detail.score)}<span style={{ fontSize: '0.5em', color: 'var(--color-muted)', marginLeft: '0.2em' }}>/ 100</span></div>
          <div style={{ fontSize: '0.9em', color: 'var(--color-accent)' }}>{resonanceLabel(detail.score)}</div>
        </div>
        <div style={{ flex: 1, minWidth: '10em', fontSize: '0.85em' }}>
          {(() => {
            const bd = resonanceBreakdown(detail);
            return (
              <>
                {detail.pairRelation && (
                  <MiniBar
                    label={`気質: ${detail.pairRelation.label}`}
                    hint={detail.pairRelation.description}
                    points={bd.pair.pts}
                    max={bd.pair.max}
                  />
                )}
                <MiniBar
                  label="共鳴"
                  hint="同じ波長で盛り上がれる度合い"
                  points={bd.similarity.pts}
                  max={bd.similarity.max}
                />
                <MiniBar
                  label="連携"
                  hint="互いの欠けを補って戦える度合い"
                  points={bd.complementarity.pts}
                  max={bd.complementarity.max}
                />
                <div style={{
                  marginTop: '0.4em',
                  display: 'flex',
                  justifyContent: 'space-between',
                  fontSize: '0.9em',
                  fontWeight: 700,
                  color: 'var(--color-fg)',
                  borderTop: '1px dashed rgba(255,255,255,0.25)',
                  paddingTop: '0.3em',
                }}>
                  <span>合計</span>
                  <span style={{ fontFamily: 'ui-monospace, monospace' }}>
                    {bd.totalPts} / 100
                  </span>
                </div>
              </>
            );
          })()}
        </div>
      </div>

      <div style={{ marginTop: '0.8em', display: 'flex', gap: '0.6em', flexWrap: 'wrap', fontSize: '0.85em' }}>
        <div style={{ flex: 1, minWidth: '7em', textAlign: 'center' }}>
          <RadarChart stats={toVec(myStats)} size={110} normalize showValues={false} />
          <div style={{ color: 'var(--color-muted)', marginTop: '0.2em' }}>あなた ({myJob})</div>
        </div>
        <div style={{ flex: 1, minWidth: '7em', textAlign: 'center' }}>
          <RadarChart stats={toVec(theirStats)} size={110} normalize showValues={false} />
          <div style={{ color: 'var(--color-muted)', marginTop: '0.2em' }}>相手 ({theirJob})</div>
        </div>
      </div>
    </div>
  );
}

function MiniBar({ label, hint, points, max }: { label: string; hint?: string; points: number; max: number }) {
  const pct = max > 0 ? Math.max(0, Math.min(1, points / max)) * 100 : 0;
  return (
    <div style={{ margin: '0.3em 0' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', color: 'var(--color-muted)' }}>
        <span>
          <span style={{ fontWeight: 700, color: 'var(--color-fg)' }}>{label}</span>
          {hint && (
            <span style={{ marginLeft: '0.5em', fontSize: '0.85em' }}>— {hint}</span>
          )}
        </span>
        <span style={{ fontFamily: 'ui-monospace, monospace' }}>
          {points} / {max}
        </span>
      </div>
      <div style={{ height: 4, background: 'rgba(255,255,255,0.15)', borderRadius: 2, overflow: 'hidden', marginTop: '0.15em' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: 'var(--color-accent)' }} />
      </div>
    </div>
  );
}

function toVec(s: StatArray) {
  return { atk: s[0], def: s[1], agi: s[2], int: s[3], luk: s[4] };
}

function RecentPosts({ agent, did }: { agent: Agent; did: string }) {
  const feed = useInfiniteFeed<AppBskyFeedDefs.FeedViewPost>({
    enabled: !!agent && !!did,
    keyOf: (x) => x.post.uri,
    deps: [agent, did],
    fetchPage: async (cursor) => {
      const res = await agent.getAuthorFeed({
        actor: did,
        limit: 20,
        filter: 'posts_no_replies',
        ...(cursor !== undefined ? { cursor } : {}),
      });
      return {
        items: res.data.feed,
        ...(res.data.cursor !== undefined ? { cursor: res.data.cursor } : {}),
      };
    },
  });

  return (
    <>
      <h3 style={{ fontSize: '0.95em' }}>投稿</h3>
      {feed.err && (
        <p style={{ color: 'var(--color-danger)' }}>うまく読み込めませんでした: {feed.err}</p>
      )}
      {!feed.loading && feed.items.length === 0 && !feed.err && (
        <p style={{ color: 'var(--color-muted)' }}>投稿がありません。</p>
      )}
      <VirtualFeed
        items={feed.items}
        keyOf={(x) => x.post.uri}
        renderItem={(item) => <PostArticle post={item.post} expandable />}
        onEndReached={feed.done ? undefined : feed.loadMore}
        footer={
          <>
            {feed.loading && <p style={{ textAlign: 'center' }}>読み込み中…</p>}
            {feed.done && feed.items.length > 0 && (
              <p style={{ textAlign: 'center', fontSize: '0.8em', color: 'var(--color-muted)' }}>
                これ以上はありません。
              </p>
            )}
          </>
        }
      />
    </>
  );
}

/**
 * 相手が AozoraQuest を使っていなくても、閲覧側のブラウザで気質を推定して
 * その場で表示する。PDS には一切書き込まず、推定結果は local state 止まり。
 */
function EstimateOtherPanel({
  agent,
  actor,
  displayName,
  onEstimated,
}: {
  agent: Agent;
  actor: string;
  displayName: string;
  onEstimated: (r: DiagnosisResult) => void;
}) {
  const [phase, setPhase] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [insufficient, setInsufficient] = useState<number | null>(null);

  const run = async () => {
    setErr(null);
    setInsufficient(null);
    setPhase('starting');
    try {
      const r = await runDiagnosisForOther(agent, actor, (p, done, total) => {
        setPhase(p);
        if (done !== undefined && total !== undefined) setProgress({ done, total });
      });
      if ('insufficient' in r) {
        setInsufficient(r.postCount);
      } else {
        onEstimated(r);
      }
    } catch (e) {
      setErr(String((e as Error)?.message ?? e));
    } finally {
      setPhase(null);
      setProgress(null);
    }
  };

  if (phase) {
    return (
      <div>
        <p style={{ fontSize: '0.85em', margin: 0 }}>{displayName} の気質を推し量っています ({phase})</p>
        {progress && (
          <div style={{ height: 5, background: 'var(--color-border)', borderRadius: 3, overflow: 'hidden', marginTop: '0.3em' }}>
            <div style={{ width: `${(progress.done / progress.total) * 100}%`, height: '100%', background: 'var(--color-accent)' }} />
          </div>
        )}
      </div>
    );
  }

  if (insufficient !== null) {
    return (
      <p style={{ fontSize: '0.85em', color: 'var(--color-muted)', margin: 0 }}>
        投稿が少なくて推定できませんでした ({insufficient} 件、{DIAGNOSIS_MIN_POST_COUNT} 件以上必要)。
      </p>
    );
  }

  return (
    <div>
      <p style={{ fontSize: '0.85em', color: 'var(--color-muted)', margin: 0 }}>
        相手はまだ気質を公開していません。公開投稿から推し量ってみますか？ (結果はこの画面だけに表示され、保存されません)
      </p>
      <button onClick={() => void run()} style={{ marginTop: '0.5em' }}>
        {displayName} の気質を推し量る
      </button>
      {err && <p style={{ color: 'var(--color-danger)', fontSize: '0.85em', marginTop: '0.4em' }}>{err}</p>}
    </div>
  );
}

/** Bluesky のフォロー状態トグル。viewer.following が URI なら解除、なければ作成。 */
function FollowButton({
  agent,
  did,
  initialFollowingUri,
}: {
  agent: Agent;
  did: string;
  initialFollowingUri: string | undefined;
}) {
  const [followUri, setFollowUri] = useState<string | undefined>(initialFollowingUri);
  const [busy, setBusy] = useState(false);
  const following = !!followUri;

  async function toggle() {
    if (busy) return;
    setBusy(true);
    const prev = followUri;
    // 楽観的更新
    setFollowUri(prev ? undefined : 'pending');
    try {
      if (prev && prev !== 'pending') {
        await agent.deleteFollow(prev);
      } else {
        const res = await agent.follow(did);
        setFollowUri(res.uri);
      }
    } catch (e) {
      console.warn('[follow] toggle failed', e);
      setFollowUri(prev);
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={busy}
      style={{
        padding: '0.4em 0.9em',
        fontSize: '0.85em',
        fontWeight: 700,
        background: following ? 'transparent' : 'var(--color-accent)',
        color: following ? 'var(--color-fg)' : '#000',
        border: `2px solid ${following ? 'var(--color-border)' : 'var(--color-accent)'}`,
        borderRadius: 4,
        cursor: busy ? 'wait' : 'pointer',
        whiteSpace: 'nowrap',
      }}
    >
      {busy ? '…' : following ? 'フォロー中' : 'フォロー'}
    </button>
  );
}
