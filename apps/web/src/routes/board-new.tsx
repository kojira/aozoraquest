/**
 * 依頼クエスト発行画面 (docs/15-user-quest.md §UI 設計 A)。
 *
 * Phase 1 MVP:
 *  - タイトル / 本文 / 報酬ポイント / タグ / 締切 / 求めるジョブ / Bluesky 告知
 *  - visibility は public 固定 (MVP 決定事項)
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ARCHETYPES, JOBS_BY_ID, jobDisplayName, formatQuestAnnouncement, checkIssuanceLimits } from '@aozoraquest/core';
import { useSession } from '@/lib/session';
import { createQuest, listIssuedQuests } from '@/lib/quest-api';
import { refreshQuestIndex } from '@/lib/quest-index-cache';
import { createTaggedPost } from '@/lib/atproto';
import { getPostQuestNotifications, getPostQuestNotificationsDefault } from '@/lib/prefs';
import { DateTimePicker } from '@/components/date-time-picker';

const MAX_TITLE = 80;
const MAX_BODY = 1500;
const MAX_TAGS = 8;

export function BoardNew() {
  const session = useSession();
  const navigate = useNavigate();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [tagInput, setTagInput] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [targetJob, setTargetJob] = useState<string>('');
  const [deadline, setDeadline] = useState('');
  const [rewardPoints, setRewardPoints] = useState(100);
  const [announce, setAnnounce] = useState(() => getPostQuestNotifications());
  const [announceText, setAnnounceText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const handle = session.handle ?? 'me';
  const announceTemplate = useMemo(() => {
    return formatQuestAnnouncement({
      title: title || '(タイトル未入力)',
      rewardPoints,
      handle,
      ...(deadline ? { deadline } : {}),
      tags,
      questUrl: '[QUEST_URL]',
    });
  }, [title, rewardPoints, handle, deadline, tags]);

  // テンプレが変わったらユーザー編集中の文字列も追従 (= ユーザーが触っていなければ)
  useEffect(() => {
    setAnnounceText(announceTemplate);
  }, [announceTemplate]);

  function addTag() {
    const t = tagInput.trim().replace(/^#/, '');
    if (!t || tags.includes(t) || tags.length >= MAX_TAGS) return;
    setTags([...tags, t]);
    setTagInput('');
  }

  function removeTag(t: string) {
    setTags(tags.filter((x) => x !== t));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (session.status !== 'signed-in' || !session.agent || !session.did) return;
    if (!title.trim() || !body.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      // スパム上限チェック (docs/15-user-quest.md §モデレーション)
      const myQuests = await listIssuedQuests(session.agent, session.did, 100);
      const limit = checkIssuanceLimits(myQuests);
      if (!limit.ok) {
        setErr(limit.reason ?? '発行制限に達しました。');
        setBusy(false);
        return;
      }
      const quest = await createQuest(session.agent, session.did, {
        title: title.trim(),
        body: body.trim(),
        tags,
        ...(targetJob ? { targetJob } : {}),
        ...(deadline ? { deadline: new Date(deadline).toISOString() } : {}),
        rewardPoints,
      });
      // Bluesky 告知 (default ON、ユーザー編集テキストを使う)
      if (announce) {
        const questUrl = `${location.origin}/board/${encodeURIComponent(quest.uri)}`;
        // [QUEST_URL] マーカーが残っていれば置換。ユーザーが消してしまっていれば末尾に追加。
        let finalText = announceText.replace('[QUEST_URL]', questUrl);
        if (!finalText.includes(questUrl)) finalText = `${finalText.trim()}\n${questUrl}`;
        try {
          await createTaggedPost(session.agent, finalText, 'aozoraquest');
        } catch (e) {
          console.warn('[board-new] bluesky announce failed', e);
        }
      }
      // index キャッシュを破棄 (発行直後に「募集中」一覧へ反映されるように)
      void refreshQuestIndex();
      navigate(`/board/${encodeURIComponent(quest.uri)}`);
    } catch (e) {
      setErr(String((e as Error)?.message ?? e));
      setBusy(false);
    }
  }

  if (session.status !== 'signed-in') {
    return <p style={{ fontSize: '0.9em' }}>サインインしてください。</p>;
  }

  const validTitle = title.trim().length > 0 && title.length <= MAX_TITLE;
  const validBody = body.trim().length > 0 && body.length <= MAX_BODY;
  const validReward = Number.isInteger(rewardPoints) && rewardPoints >= 0;
  const canSubmit = !busy && validTitle && validBody && validReward;

  return (
    <form onSubmit={onSubmit}>
      <h2 style={{ marginTop: 0, fontSize: '1.05em' }}>クエストを出す</h2>

      <Field label={`タイトル (最大 ${MAX_TITLE} 字)`}>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={MAX_TITLE}
          placeholder="例: 精霊のイラストを描いてくれる人募集"
          style={{ width: '100%' }}
        />
        <Counter cur={title.length} max={MAX_TITLE} />
      </Field>

      <Field label={`本文 (最大 ${MAX_BODY} 字)`}>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          maxLength={MAX_BODY}
          rows={6}
          placeholder="やってほしいことの詳細、納期、参考リンクなど"
          style={{ width: '100%' }}
        />
        <Counter cur={body.length} max={MAX_BODY} />
      </Field>

      <Field label="タグ (最大 8 個)">
        <div style={{ display: 'flex', gap: '0.4em', flexWrap: 'wrap', marginBottom: '0.4em' }}>
          {tags.map((t) => (
            <button type="button" key={t} onClick={() => removeTag(t)} style={{ fontSize: '0.75em', padding: '0.1em 0.5em' }}>
              #{t} ×
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: '0.3em' }}>
          <input
            type="text"
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTag(); } }}
            placeholder="例: illust"
            style={{ flex: 1 }}
            disabled={tags.length >= MAX_TAGS}
          />
          <button type="button" onClick={addTag} disabled={tags.length >= MAX_TAGS}>追加</button>
        </div>
      </Field>

      <Field label="求めるジョブ (任意)">
        <select value={targetJob} onChange={(e) => setTargetJob(e.target.value)}>
          <option value="">指定なし</option>
          {ARCHETYPES.map((id) => (
            <option key={id} value={id}>{jobDisplayName(id, 'default')}</option>
          ))}
        </select>
      </Field>

      <Field label="募集期限 (任意)">
        <DateTimePicker
          value={deadline}
          onChange={setDeadline}
          ariaLabel="募集期限を選択"
        />
        <p style={{ fontSize: '0.75em', color: 'var(--color-muted)', margin: '0.2em 0 0' }}>
          期限内のみ応募可。後から延長 / 短縮できます。期限切れでも自動キャンセルされません。
        </p>
      </Field>

      <Field label={`報酬: ${handle} ポイント`}>
        <input
          type="number"
          value={rewardPoints}
          onChange={(e) => setRewardPoints(Math.max(0, parseInt(e.target.value, 10) || 0))}
          min={0}
          step={100}
          style={{ width: '12em' }}
        />
        <p style={{ fontSize: '0.75em', color: 'var(--color-muted)', margin: '0.2em 0 0' }}>
          あなたの名前のポイントを {rewardPoints} pt 発行します (合算されない、発行上限なし)。
        </p>
      </Field>

      <Field label="Bluesky に告知する">
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.4em', fontSize: '0.9em' }}>
          <input type="checkbox" checked={announce} onChange={(e) => setAnnounce(e.target.checked)} />
          告知する
        </label>
        {!getPostQuestNotificationsDefault() && (
          <p style={{ fontSize: '0.75em', color: 'var(--color-muted)', margin: '0.3em 0 0' }}>
            dev 環境では default OFF (本番 Bluesky に流さないため)。
            設定ページの「クエスト告知を Bluesky に投稿する」で常時 ON にできます。
          </p>
        )}
        {announce && (
          <>
            <p style={{ fontSize: '0.75em', color: 'var(--color-muted)', margin: '0.4em 0 0.2em' }}>
              <code>[QUEST_URL]</code> が発行後の URL に置き換わります。消した場合は末尾に自動追加されます。
            </p>
            <textarea
              aria-label="Bluesky 告知本文"
              value={announceText}
              onChange={(e) => setAnnounceText(e.target.value)}
              rows={5}
              style={{ width: '100%', marginTop: '0.2em' }}
            />
          </>
        )}
      </Field>

      {err && <p style={{ color: 'var(--color-danger)', fontSize: '0.85em' }}>{err}</p>}

      <div style={{ display: 'flex', gap: '0.6em', marginTop: '1em' }}>
        <button type="submit" disabled={!canSubmit}>
          {busy ? '送信中...' : 'クエストを出す'}
        </button>
        <button type="button" className="secondary" onClick={() => navigate('/board')}>戻る</button>
      </div>
    </form>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div role="group" aria-label={label} style={{ marginBottom: '1em' }}>
      <label style={{ display: 'block', fontSize: '0.85em', marginBottom: '0.3em' }}>{label}</label>
      {children}
    </div>
  );
}

function Counter({ cur, max }: { cur: number; max: number }) {
  const near = cur > max * 0.9;
  return (
    <span style={{ fontSize: '0.7em', color: near ? 'var(--color-danger)' : 'var(--color-muted)', float: 'right' }}>
      {cur} / {max}
    </span>
  );
}
