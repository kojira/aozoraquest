import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Archetype, StatVector } from '@aozoraquest/core';
import { ARCHETYPES, JOBS_BY_ID, jobDisplayName, statArrayToVector } from '@aozoraquest/core';
import { useSession } from '@/lib/session';
import { signOut } from '@/lib/oauth';
import { createTaggedPost, getRecord, putRecord } from '@/lib/atproto';
import { TextField } from '@/components/text-field';
import { RadarChart } from '@/components/radar-chart';

const OPTIN_TAG = 'aozoraquest';

function statsOf(id: Archetype): StatVector {
  return statArrayToVector(JOBS_BY_ID[id].stats);
}
const DEFAULT_OPTIN_POST = `#${OPTIN_TAG} の気質診断に参加しました。共鳴 TL に自分の投稿が表示されても構いません。`;

interface Profile {
  targetJob?: string;
  nameVariant?: string;
  publicAnalysis?: boolean;
  discoverable?: boolean;
  spiritStyle?: string;
  updatedAt: string;
}

export function Settings() {
  const session = useSession();
  const navigate = useNavigate();

  // ─── Opt-in state ───
  const [profile, setProfile] = useState<Profile | null>(null);
  const [profileLoaded, setProfileLoaded] = useState(false);
  const [optInBusy, setOptInBusy] = useState(false);
  const [optInErr, setOptInErr] = useState<string | null>(null);
  const [optInDialog, setOptInDialog] = useState(false);
  const [postText, setPostText] = useState(DEFAULT_OPTIN_POST);

  useEffect(() => {
    if (session.status !== 'signed-in' || !session.agent || !session.did) return;
    const agent = session.agent;
    const did = session.did;
    (async () => {
      try {
        const p = await getRecord<Profile>(agent, did, 'app.aozoraquest.profile', 'self');
        setProfile(p);
      } catch (e) {
        console.warn('profile load failed', e);
      } finally {
        setProfileLoaded(true);
      }
    })();
  }, [session.status, session.agent, session.did]);

  async function onSignOut() {
    if (session.status === 'signed-in' && session.did) {
      await signOut(session.did);
    }
    navigate('/onboarding');
  }

  async function confirmOptIn() {
    if (session.status !== 'signed-in' || !session.agent) return;
    const agent = session.agent;
    setOptInBusy(true);
    setOptInErr(null);
    try {
      if (!postText.includes(`#${OPTIN_TAG}`)) {
        throw new Error(`投稿文に #${OPTIN_TAG} が含まれていません`);
      }
      await createTaggedPost(agent, postText, OPTIN_TAG);
      const next: Profile = {
        ...(profile ?? {}),
        discoverable: true,
        updatedAt: new Date().toISOString(),
      };
      await putRecord(agent, 'app.aozoraquest.profile', 'self', next);
      setProfile(next);
      setOptInDialog(false);
    } catch (e) {
      setOptInErr(String((e as Error)?.message ?? e));
    } finally {
      setOptInBusy(false);
    }
  }

  async function optOut() {
    if (session.status !== 'signed-in' || !session.agent) return;
    const agent = session.agent;
    setOptInBusy(true);
    setOptInErr(null);
    try {
      const next: Profile = {
        ...(profile ?? {}),
        discoverable: false,
        updatedAt: new Date().toISOString(),
      };
      await putRecord(agent, 'app.aozoraquest.profile', 'self', next);
      setProfile(next);
    } catch (e) {
      setOptInErr(String((e as Error)?.message ?? e));
    } finally {
      setOptInBusy(false);
    }
  }

  const [targetBusy, setTargetBusy] = useState(false);
  const [targetErr, setTargetErr] = useState<string | null>(null);
  async function setTargetJob(id: Archetype) {
    if (session.status !== 'signed-in' || !session.agent) return;
    const agent = session.agent;
    setTargetBusy(true);
    setTargetErr(null);
    try {
      const next: Profile = {
        ...(profile ?? {}),
        targetJob: id,
        updatedAt: new Date().toISOString(),
      };
      await putRecord(agent, 'app.aozoraquest.profile', 'self', next);
      setProfile(next);
    } catch (e) {
      setTargetErr(String((e as Error)?.message ?? e));
    } finally {
      setTargetBusy(false);
    }
  }

  const currentTarget = profile?.targetJob && profile.targetJob in JOBS_BY_ID
    ? (profile.targetJob as Archetype)
    : null;

  return (
    <div>
      <h2>設定</h2>

      <section style={{ marginTop: '1em' }}>
        <h3 style={{ fontSize: '0.95em' }}>目指す姿</h3>
        <p style={{ fontSize: '0.8em', color: 'var(--color-muted)' }}>
          近づきたい「ジョブ」を 1 つ選ぶと、毎日のクエストがそこへ向かう内容になります。
          いつでも変更できます。
        </p>
        {!profileLoaded ? (
          <p>読み込み中...</p>
        ) : (
          <>
            {currentTarget && (
              <div style={{ marginTop: '0.5em', display: 'flex', alignItems: 'center', gap: '0.8em' }}>
                <RadarChart stats={statsOf(currentTarget)} size={110} showValues={false} />
                <div>
                  <div style={{ fontSize: '0.8em', color: 'var(--color-muted)' }}>現在の目標</div>
                  <div style={{ fontSize: '1.1em', fontWeight: 700 }}>{jobDisplayName(currentTarget, 'default')}</div>
                </div>
              </div>
            )}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(4, 1fr)',
                gap: '0.4em',
                marginTop: '0.6em',
              }}
            >
              {ARCHETYPES.map((id) => {
                const isCurrent = currentTarget === id;
                return (
                  <button
                    key={id}
                    onClick={() => void setTargetJob(id)}
                    disabled={targetBusy}
                    style={{
                      padding: '0.4em 0.3em',
                      fontSize: '0.8em',
                      background: isCurrent ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.4)',
                      border: `2px solid ${isCurrent ? '#ffffff' : 'rgba(255,255,255,0.5)'}`,
                      borderRadius: 2,
                      color: '#ffffff',
                      cursor: targetBusy ? 'wait' : 'pointer',
                    }}
                  >
                    {jobDisplayName(id, 'default')}
                  </button>
                );
              })}
            </div>
            {targetErr && <p style={{ color: 'var(--color-danger)', fontSize: '0.85em', marginTop: '0.5em' }}>{targetErr}</p>}
          </>
        )}
      </section>

      <section style={{ marginTop: '2em' }}>
        <h3 style={{ fontSize: '0.95em' }}>共鳴タイムラインへの参加 (オプトイン)</h3>
        <p style={{ fontSize: '0.8em', color: 'var(--color-muted)' }}>
          参加すると、他のユーザーの共鳴 TL にあなたの投稿が表示される可能性があります。
          参加の合図として <code>#{OPTIN_TAG}</code> 付きの投稿をあなたのアカウントから 1 本作成します
          (これで検索 API で発見可能になる)。
        </p>
        {!profileLoaded ? (
          <p>読み込み中...</p>
        ) : profile?.discoverable ? (
          <div style={{ marginTop: '0.5em' }}>
            <p style={{ fontSize: '0.85em', color: '#1a6230' }}>✓ 共鳴 TL に参加しています。</p>
            <p style={{ fontSize: '0.75em', color: 'var(--color-muted)' }}>
              完全に離脱するには、このボタンで discoverable を false に戻し、かつ先ほどの <code>#{OPTIN_TAG}</code> 投稿を Bluesky から削除してください。
            </p>
            <button onClick={optOut} disabled={optInBusy}>共鳴 TL から外す</button>
          </div>
        ) : (
          <div style={{ marginTop: '0.5em' }}>
            {!optInDialog ? (
              <button onClick={() => setOptInDialog(true)}>共鳴 TL に参加する</button>
            ) : (
              <div style={{ border: '1px solid var(--color-border)', padding: '0.8em', borderRadius: 4 }}>
                <p style={{ fontSize: '0.85em' }}>以下の投稿をあなたのアカウントから作成します。本文は自由に編集できます:</p>
                <TextField
                  multiline
                  rows={4}
                  value={postText}
                  onChange={setPostText}
                  style={{ width: '100%', padding: '0.5em', fontSize: '0.9em' }}
                  disabled={optInBusy}
                />
                <p style={{ fontSize: '0.75em', color: 'var(--color-muted)' }}>
                  <code>#{OPTIN_TAG}</code> は必ず含めてください (検索対象になる)。
                </p>
                <div style={{ display: 'flex', gap: '0.5em', marginTop: '0.5em' }}>
                  <button onClick={confirmOptIn} disabled={optInBusy}>
                    {optInBusy ? '投稿中...' : '同意して投稿する'}
                  </button>
                  <button className="secondary" onClick={() => setOptInDialog(false)} disabled={optInBusy}>
                    キャンセル
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
        {optInErr && <p style={{ color: '#b00', marginTop: '0.5em', fontSize: '0.85em' }}>{optInErr}</p>}
      </section>

      <section style={{ marginTop: '2em' }}>
        <h3 style={{ fontSize: '0.95em' }}>アカウント</h3>
        {session.status === 'signed-in' && (
          <p style={{ fontSize: '0.85em', color: 'var(--color-muted)' }}>
            ログイン中: {session.handle ?? session.did}
          </p>
        )}
        <button onClick={onSignOut}>ログアウト</button>
      </section>
    </div>
  );
}
