import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Agent } from '@atproto/api';
import type { DiagnosisResult } from '@aozoraquest/core';
import { GREETING_HOUR_BOUNDARIES, SPIRIT_CHAT_HISTORY_TURNS, SPIRIT_INPUT_MAX_LENGTH, jobDisplayName, pickSpiritLine, type SpiritSituation } from '@aozoraquest/core';
import { useSession } from '@/lib/session';
import { getRecord } from '@/lib/atproto';
import { COL } from '@/lib/collections';
import { SpiritIcon } from '@/components/spirit-icon';
import { SpiritBubble } from '@/components/spirit-bubble';
import { UserBubble } from '@/components/user-bubble';
import { SummoningRitual } from '@/components/summoning-ritual';
import { TextField } from '@/components/text-field';
import { useOnPosted } from '@/components/compose-modal';
import { useRuntimeConfig } from '@/components/config-provider';
import { loadPointsState, SUMMON_THRESHOLD, type PointsState } from '@/lib/points';
import { getGenerator, isModelCached, type ChatMessage } from '@/lib/generator';
import { finalizeLlmTrace } from '@/lib/llm-trace';
import { LlmTracePanel } from '@/components/llm-trace-panel';

type GreetingSituation = 'greeting.morning' | 'greeting.daytime' | 'greeting.night';

function currentGreeting(): GreetingSituation {
  const h = new Date().getHours();
  if (h < GREETING_HOUR_BOUNDARIES.morningEnd) return 'greeting.morning';
  if (h < GREETING_HOUR_BOUNDARIES.dayEnd) return 'greeting.daytime';
  return 'greeting.night';
}

/** ユーザー 1 発言の最大文字数 (tuning.SPIRIT_INPUT_MAX_LENGTH の別名) */
const INPUT_MAX = SPIRIT_INPUT_MAX_LENGTH;

/** LLM に渡す直近の会話ターン数 (tuning.SPIRIT_CHAT_HISTORY_TURNS の別名) */
const HISTORY_TURNS = SPIRIT_CHAT_HISTORY_TURNS;

const DEFAULT_SYSTEM_PROMPT = `あなたは「あおぞらくえすと」の精霊、ブルスコン。
青空の化身で、穏やかで詩的、押し付けがましくない。
応答ルール:
- 2 文以内で返す
- 一人称は使わない
- 古風な語尾 (じゃ、ぞ、など) は使わない
- 断定予言や強い助言はしない
- 相手の名前が分かれば自然に添える`;

interface HistoryItem {
  uri?: string;
  role: 'user' | 'spirit';
  text: string;
  createdAt: string;
}

export function Spirit() {
  const session = useSession();
  const config = useRuntimeConfig();
  const [diag, setDiag] = useState<DiagnosisResult | null>(null);
  const [points, setPoints] = useState<PointsState | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [ritualOpen, setRitualOpen] = useState(false);
  /** モデルファイルがブラウザの Cache Storage にあるかどうか。false ならキャッシュ切れ。 */
  const [cacheReady, setCacheReady] = useState(false);
  /** モデルが現在のセッションで生成器として使える状態か。cacheReady=true のときは裏で自動ロードする。 */
  const [generatorReady, setGeneratorReady] = useState(false);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [sendErr, setSendErr] = useState<string | null>(null);
  const streamingRef = useRef<string | null>(null); // uri of current streaming message
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);
  const prevSendingRef = useRef(false);

  const agent = session.agent ?? null;
  const did = session.did ?? null;

  const userName = session.handle?.split('.')[0] ?? 'あなた';
  const systemPrompt = (config.prompts?.spiritChat?.body ?? DEFAULT_SYSTEM_PROMPT).trim();

  // 初期ロード: diagnosis, points, chat history, モデルキャッシュ確認
  useEffect(() => {
    if (session.status !== 'signed-in' || !agent || !did) {
      setLoaded(true);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const [r, p, hist, cached] = await Promise.all([
          getRecord<DiagnosisResult>(agent, did, COL.analysis, 'self').catch(() => null),
          loadPointsState(agent, did),
          loadChatHistory(agent, did),
          isModelCached(),
        ]);
        if (cancelled) return;
        setDiag(r);
        setPoints(p);
        setHistory(hist);
        setCacheReady(cached);
        // 召喚済み + キャッシュあり → 裏で静かにロード (儀式なし)
        if (p.summoned && cached) {
          getGenerator().load().then(() => {
            if (!cancelled) setGeneratorReady(true);
          }).catch((e) => {
            console.warn('silent generator load failed', e);
          });
        }
      } catch (e) {
        console.warn('spirit init failed', e);
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, [session.status, agent, did]);

  // 投稿直後にポイント再計算
  useOnPosted(() => {
    if (!agent || !did) return;
    setTimeout(() => {
      loadPointsState(agent, did).then(setPoints).catch((e) => console.warn('points refresh failed', e));
    }, 600);
  });

  // history 末尾へオートスクロール
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [history.length, sending]);

  // 送信が終わった瞬間に入力欄へフォーカスを戻す (disabled 解除のタイミング)
  useEffect(() => {
    if (prevSendingRef.current && !sending) {
      // disabled 属性の更新後に focus したいので次の tick に回す
      const t = setTimeout(() => inputRef.current?.focus(), 0);
      return () => clearTimeout(t);
    }
    prevSendingRef.current = sending;
    return;
  }, [sending]);

  const greetingLines = useMemo(() => {
    if (session.status !== 'signed-in' || !did) return [];
    const ctx = { userName, userDid: did };
    const situations: SpiritSituation[] = [currentGreeting()];
    if (diag) situations.push('quest.complete');
    const collected: string[] = [];
    for (const s of situations) {
      const line = pickSpiritLine(s, ctx);
      if (line) collected.push(line);
    }
    return collected;
  }, [session.status, did, userName, diag]);

  const sendMessage = useCallback(async () => {
    if (!agent || !did || !points || sending) return;
    const text = input.trim().slice(0, INPUT_MAX);
    if (!text) return;
    if (points.balance < 1) return;

    setSending(true);
    setSendErr(null);
    const createdAt = new Date().toISOString();

    // 楽観的 UI に user メッセージを追加
    const tempUser: HistoryItem = { role: 'user', text, createdAt };
    setHistory((h) => [...h, tempUser]);
    setInput('');

    // user レコードを PDS に書き込み
    let userUri: string;
    try {
      const res = await agent.com.atproto.repo.createRecord({
        repo: did,
        collection: COL.spiritChat,
        record: { $type: COL.spiritChat, role: 'user', text, createdAt },
      });
      userUri = res.data.uri;
    } catch (e) {
      setSendErr('あなたの言葉を保存できなかった。もう一度どうぞ。');
      setHistory((h) => h.filter((x) => x !== tempUser));
      setSending(false);
      return;
    }

    // 楽観的残高 -1
    setPoints({ ...points, userMessages: points.userMessages + 1, balance: points.balance - 1 });

    // spirit の返答を生成 (streaming)
    const g = getGenerator();
    // 保留用 uri (本物が入るまで streamingRef で識別)
    const streamKey = `__streaming_${Date.now()}`;
    streamingRef.current = streamKey;
    const placeholder: HistoryItem = { uri: streamKey, role: 'spirit', text: '', createdAt: new Date().toISOString() };
    setHistory((h) => [...h, placeholder]);

    // 直近 HISTORY_TURNS ターン (1 ターン = user + spirit の 2 件) を LLM コンテキストに渡す。
    // 要約はせず、それ以前は忘れる。
    const recentHistory = [...history.slice(-HISTORY_TURNS * 2), tempUser];
    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      ...recentHistory.map((m) => ({
        role: (m.role === 'spirit' ? 'assistant' : 'user') as 'assistant' | 'user',
        content: m.text,
      })),
    ];

    let full = '';
    try {
      full = await g.generate(messages, {
        onToken: (chunk: string) => {
          if (streamingRef.current !== streamKey) return;
          setHistory((h) => h.map((x) => (x.uri === streamKey ? { ...x, text: x.text + chunk } : x)));
        },
      });
    } catch (e) {
      streamingRef.current = null;
      setHistory((h) => h.filter((x) => x.uri !== streamKey));
      setSendErr('ブルスコンは今、うまく声を出せないようだ。少し時間を置いて、また話しかけてみて。');
      setSending(false);
      // user メッセージは残す (残高も消費済み)。LLM 失敗時は仕方なし
      return;
    }

    const cleanFull = cleanGenerated(full || '');
    if (!cleanFull) {
      streamingRef.current = null;
      setHistory((h) => h.filter((x) => x.uri !== streamKey));
      setSendErr('ブルスコンは何も答えなかった。');
      setSending(false);
      return;
    }

    // spirit レコードを PDS に書き込み、履歴の placeholder を本 uri に差し替え
    const spiritCreatedAt = new Date().toISOString();
    try {
      const res = await agent.com.atproto.repo.createRecord({
        repo: did,
        collection: COL.spiritChat,
        record: { $type: COL.spiritChat, role: 'spirit', text: cleanFull, createdAt: spiritCreatedAt },
      });
      streamingRef.current = null;
      setHistory((h) =>
        h.map((x) =>
          x.uri === streamKey ? { uri: res.data.uri, role: 'spirit', text: cleanFull, createdAt: spiritCreatedAt } : x,
        ),
      );
    } catch (e) {
      // 保存失敗しても UI 表示はキープ
      streamingRef.current = null;
      setHistory((h) => h.map((x) => (x.uri === streamKey ? { ...x, text: cleanFull } : x)));
      console.warn('spirit record save failed', e);
    }

    void userUri;
    setSending(false);
  }, [agent, did, points, input, sending, history, systemPrompt]);

  const onCancelRitual = useCallback(() => {
    setRitualOpen(false);
  }, []);

  const onCompleteRitual = useCallback(
    async (welcome: string) => {
      if (!agent || !did) return;
      const createdAt = new Date().toISOString();
      try {
        const res = await agent.com.atproto.repo.createRecord({
          repo: did,
          collection: COL.spiritChat,
          record: { $type: COL.spiritChat, role: 'spirit', text: welcome, createdAt },
        });
        setHistory((h) => [...h, { uri: res.data.uri, role: 'spirit', text: welcome, createdAt }]);
        setPoints((p) => (p ? { ...p, summoned: true } : p));
        // 儀式中にモデルはロード済み、キャッシュにも入った
        setCacheReady(true);
        setGeneratorReady(true);
        // ここまで来たら LLM trace は無事完走、last 側に格上げして次セッションは綺麗に始まる
        finalizeLlmTrace();
      } catch (e) {
        console.warn('welcome message save failed', e);
        throw e;
      }
      setRitualOpen(false);
    },
    [agent, did],
  );

  if (session.status === 'loading' || !loaded) {
    return (
      <div>
        <LlmTracePanel />
        <h2>精霊ブルスコン</h2>
        <SpiritBubble sleeping>…</SpiritBubble>
      </div>
    );
  }

  if (session.status === 'signed-out') {
    return (
      <div>
        <LlmTracePanel />
        <h2>精霊ブルスコン</h2>
        <SpiritBubble>ログインすると、わたしの声が届きます。</SpiritBubble>
        <Link to="/onboarding"><button style={{ marginTop: '1em' }}>ログイン</button></Link>
      </div>
    );
  }

  if (!points) {
    return (
      <div>
        <LlmTracePanel />
      </div>
    );
  }

  const jobLabel = diag ? jobDisplayName(diag.archetype, 'default') : null;
  /** 召喚済みだがキャッシュが消えているため、再召喚の儀式を要求する状態。 */
  const needsResummon = points.summoned && !cacheReady;

  return (
    <div>
      <LlmTracePanel />
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6em', marginBottom: '0.2em' }}>
        <div className={points.summoned ? '' : 'breathe'}>
          <SpiritIcon size={56} sleeping={!points.summoned} />
        </div>
        <div>
          <h2 style={{ margin: 0 }}>精霊ブルスコン</h2>
          <p style={{ margin: 0, fontSize: '0.8em', color: 'var(--color-muted)' }}>
            {jobLabel ? `あなたは今「${jobLabel}」の姿` : '気質を調べるともう少し深く話せる'}
          </p>
        </div>
      </div>

      {/* ─── 再召喚 (キャッシュ切れ) ─── */}
      {needsResummon && (
        <section style={{ marginTop: '1em', textAlign: 'center' }}>
          <SpiritBubble sleeping>
            ブルスコンのかたちが、消えてしまったようだ。もう一度、呼び戻そう。
          </SpiritBubble>
          <button
            onClick={() => setRitualOpen(true)}
            style={{
              marginTop: '1em',
              padding: '0.7em 1.6em',
              fontSize: '1em',
              background: 'rgba(0, 0, 0, 0.6)',
              color: '#ffffff',
              border: '3px solid #ffffff',
              boxShadow: '0 0 20px rgba(159, 215, 255, 0.45)',
            }}
          >
            もう一度 召喚の儀式
          </button>
        </section>
      )}

      {/* ─── E1: pre-ritual (初回) ─── */}
      {!points.summoned && points.viaPosts < SUMMON_THRESHOLD && (
        <section style={{ marginTop: '1em' }}>
          <SpiritBubble sleeping>
            精霊はまだ眠っている。あと {points.toSummon} 回、このアプリから投稿を重ねると、召喚の儀式ができる。
          </SpiritBubble>
          <div style={{ marginTop: '0.8em' }}>
            <div style={{ fontSize: '0.8em', color: 'var(--color-muted)', marginBottom: '0.3em' }}>
              あおぞらパワー {points.viaPosts} / {SUMMON_THRESHOLD}
            </div>
            <div style={{ height: 8, background: 'rgba(255,255,255,0.15)', borderRadius: 4, overflow: 'hidden' }}>
              <div
                style={{
                  width: `${(points.viaPosts / SUMMON_THRESHOLD) * 100}%`,
                  height: '100%',
                  background: 'var(--color-accent)',
                  transition: 'width 400ms ease',
                }}
              />
            </div>
          </div>
        </section>
      )}

      {/* ─── E2: ready-to-summon ─── */}
      {!points.summoned && points.viaPosts >= SUMMON_THRESHOLD && (
        <section style={{ marginTop: '1em', textAlign: 'center' }}>
          <SpiritBubble>十分な歩みが積まれた。今なら、召喚の儀式を始められる。</SpiritBubble>
          <button
            onClick={() => setRitualOpen(true)}
            style={{
              marginTop: '1em',
              padding: '0.7em 1.6em',
              fontSize: '1em',
              background: 'rgba(0, 0, 0, 0.6)',
              color: '#ffffff',
              border: '3px solid #ffffff',
              boxShadow: '0 0 20px rgba(159, 215, 255, 0.45)',
            }}
          >
            召喚の儀式を始める
          </button>
        </section>
      )}

      {/* ─── E3: summoned (かつキャッシュあり) ─── */}
      {points.summoned && !needsResummon && (
        <>
          <section style={{ marginTop: '1em', display: 'flex', flexDirection: 'column', gap: '0.6em' }}>
            {greetingLines.map((line, i) => (
              <SpiritBubble key={`greet-${i}`} showIcon={i === 0}>{line}</SpiritBubble>
            ))}
          </section>

          <section style={{ marginTop: '1em', display: 'flex', flexDirection: 'column', gap: '0.5em' }}>
            <div style={{ fontSize: '0.85em', color: 'var(--color-muted)' }}>
              あおぞらパワー: <strong>{points.balance}</strong> (話せる残り回数)
            </div>
            {history.map((m, i) => {
              const showIcon = m.role === 'spirit' && (i === 0 || history[i - 1]?.role !== 'spirit');
              return m.role === 'spirit' ? (
                <SpiritBubble key={m.uri ?? `idx-${i}`} showIcon={showIcon}>{m.text || '…'}</SpiritBubble>
              ) : (
                <UserBubble key={m.uri ?? `idx-${i}`}>{m.text}</UserBubble>
              );
            })}
            <div ref={bottomRef} />
            {sendErr && <p style={{ color: 'var(--color-danger)', fontSize: '0.85em' }}>{sendErr}</p>}
          </section>

          <section style={{ marginTop: '0.8em', display: 'flex', flexDirection: 'column', gap: '0.3em' }}>
            <div style={{ display: 'flex', gap: '0.4em', alignItems: 'flex-end' }}>
              <TextField
                ref={inputRef}
                value={input}
                onChange={(v) => setInput(v.slice(0, INPUT_MAX))}
                onSubmit={() => void sendMessage()}
                placeholder={
                  !generatorReady
                    ? 'ブルスコンを呼び戻している…'
                    : points.balance > 0
                      ? 'ブルスコンに話しかける'
                      : 'あなたの投稿を重ねると、話せるようになる'
                }
                disabled={sending || points.balance < 1 || !generatorReady}
                maxLength={INPUT_MAX}
                style={{ flex: 1 }}
              />
              <button
                onClick={() => void sendMessage()}
                disabled={sending || points.balance < 1 || !input.trim() || !generatorReady}
              >
                {sending ? '…' : '送る'}
              </button>
            </div>
            <div style={{ fontSize: '0.75em', color: 'var(--color-muted)', textAlign: 'right' }}>
              {input.length} / {INPUT_MAX}
            </div>
          </section>
        </>
      )}

      {ritualOpen && agent && (
        <SummoningRitual
          agent={agent}
          userName={userName}
          systemPrompt={systemPrompt}
          onComplete={onCompleteRitual}
          onCancel={onCancelRitual}
        />
      )}
    </div>
  );
}

async function loadChatHistory(agent: Agent, did: string): Promise<HistoryItem[]> {
  try {
    const res = await agent.com.atproto.repo.listRecords({
      repo: did,
      collection: COL.spiritChat,
      limit: 50,
    });
    const items: HistoryItem[] = [];
    for (const r of res.data.records) {
      const v = r.value as { role?: string; text?: string; createdAt?: string };
      if (!v?.text || !v.createdAt) continue;
      if (v.role !== 'user' && v.role !== 'spirit') continue;
      items.push({ uri: r.uri, role: v.role, text: v.text, createdAt: v.createdAt });
    }
    items.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return items;
  } catch (e) {
    console.info('no spiritChat history yet', (e as Error)?.message);
    return [];
  }
}

function cleanGenerated(s: string): string {
  return s
    .replace(/^<\|.*?\|>/g, '')
    .replace(/<\|.*?\|>$/g, '')
    .replace(/^(assistant|system):\s*/i, '')
    .trim()
    .slice(0, 400);
}
