import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { Agent, AppBskyActorDefs } from '@atproto/api';
import type { DiagnosisResult, ResonanceDetail, StatArray } from '@aozoraquest/core';
import { jobDisplayName, jobTagline, resonance, resonanceLabel, statVectorToArray } from '@aozoraquest/core';
import { useSession } from '@/lib/session';
import { getRecord } from '@/lib/atproto';
import { Avatar } from '@/components/avatar';
import { RadarChart } from '@/components/radar-chart';
import { PostText } from '@/components/post-text';

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
    ? resonance(statVectorToArray(myDiag.rpgStats), statVectorToArray(theirDiag.rpgStats))
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
        </div>
        {profile.description && (
          <p style={{ marginTop: '0.6em', whiteSpace: 'pre-wrap', fontSize: '0.9em' }}>{profile.description}</p>
        )}
        <div style={{ marginTop: '0.6em', fontSize: '0.8em', color: 'var(--color-muted)' }}>
          フォロー {profile.followsCount ?? 0} · フォロワー {profile.followersCount ?? 0} · 投稿 {profile.postsCount ?? 0}
        </div>
      </section>

      {!isSelf && (
        <section className="dq-window" style={{ marginTop: '0.8em' }}>
          <h3 style={{ fontSize: '0.95em', margin: '0 0 0.5em' }}>この人との相性</h3>
          {!theirDiag ? (
            <p style={{ fontSize: '0.85em', color: 'var(--color-muted)', margin: 0 }}>
              相手がまだ気質を公開していません。
            </p>
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
          <MiniBar label="近さ (似ているほど高い)" value={detail.similarity} />
          <MiniBar label="補い (違いが活きる距離)" value={detail.complementarity} />
        </div>
      </div>

      <div style={{ marginTop: '0.8em', display: 'flex', gap: '0.6em', flexWrap: 'wrap', fontSize: '0.85em' }}>
        <div style={{ flex: 1, minWidth: '7em', textAlign: 'center' }}>
          <RadarChart stats={toVec(myStats)} size={110} showValues={false} />
          <div style={{ color: 'var(--color-muted)', marginTop: '0.2em' }}>あなた ({myJob})</div>
        </div>
        <div style={{ flex: 1, minWidth: '7em', textAlign: 'center' }}>
          <RadarChart stats={toVec(theirStats)} size={110} showValues={false} />
          <div style={{ color: 'var(--color-muted)', marginTop: '0.2em' }}>相手 ({theirJob})</div>
        </div>
      </div>
    </div>
  );
}

function MiniBar({ label, value }: { label: string; value: number }) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  return (
    <div style={{ margin: '0.3em 0' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--color-muted)' }}>
        <span>{label}</span>
        <span>{Math.round(pct)}</span>
      </div>
      <div style={{ height: 4, background: 'rgba(255,255,255,0.15)', borderRadius: 2, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: 'var(--color-accent)' }} />
      </div>
    </div>
  );
}

function toVec(s: StatArray) {
  return { atk: s[0], def: s[1], agi: s[2], int: s[3], luk: s[4] };
}

interface RecentPostItem {
  text: string;
  facets?: Array<{ index: { byteStart: number; byteEnd: number }; features?: Array<{ $type?: string; uri?: string; did?: string; tag?: string }> }>;
}

interface RawPostRecord {
  text?: string;
  facets?: RecentPostItem['facets'];
}

function RecentPosts({ agent, did }: { agent: Agent; did: string }) {
  const [items, setItems] = useState<RecentPostItem[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await agent.getAuthorFeed({ actor: did, limit: 10, filter: 'posts_no_replies' });
        if (cancelled) return;
        const out: RecentPostItem[] = [];
        for (const item of res.data.feed) {
          const rec = item.post.record as RawPostRecord;
          if (typeof rec.text === 'string') out.push({ text: rec.text, ...(rec.facets ? { facets: rec.facets } : {}) });
        }
        setItems(out);
      } catch (e) {
        console.warn('recent posts failed', e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [agent, did]);

  if (loading) return <p>投稿を読み込み中...</p>;
  if (items.length === 0) return <p style={{ color: 'var(--color-muted)' }}>投稿がありません。</p>;

  return (
    <>
      <h3 style={{ fontSize: '0.95em' }}>最近の投稿</h3>
      {items.map((it, i) => (
        <article key={i} className="dq-window">
          <PostText text={it.text} facets={it.facets} />
        </article>
      ))}
    </>
  );
}
