import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Agent } from '@atproto/api';
import type { DiagnosisResult } from '@aozoraquest/core';
import { GREETING_HOUR_BOUNDARIES, SPIRIT_CHAT_HISTORY_TURNS, SPIRIT_INPUT_MAX_LENGTH, jobDisplayName, jobLevelFromXp, pickSpiritLine, type SpiritSituation } from '@aozoraquest/core';
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
import { applyPromptTemplate } from '@/lib/prompt-template';
import { bumpPower, loadPointsState, SUMMON_THRESHOLD, type PointsState } from '@/lib/points';
import { getGenerator, isModelCached } from '@/lib/generator';
import { generateSpirit, type SpiritBackend } from '@/lib/spirit-generator';
import { useGeminiNanoPref } from '@/lib/spirit-prefs';
import { detectGeminiNano, type NanoStatus } from '@/lib/gemini-nano-availability';
import { isLowEndDevice } from '@/lib/device';

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

/** 精霊応答の最大トークン数のデフォルト値 (= UI 側の fallback)。
 *  これ以上短くしたい / 長くしたいときは admin が
 *  `app.aozoraquest.config.prompts/spiritChat` の `maxNewTokens` で
 *  上書きできる (lexicon 拡張は別タスクで対応予定)。
 *
 *  この数値定数だけが code 側に残るが、character には関与しない (生成上限の
 *  安全値 = エンジニアリング都合)。性格・口調・形式・例文は **すべて admin** が
 *  PDS の prompt body に書く。 */
const SPIRIT_MAX_NEW_TOKENS_DEFAULT = 60;

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
  const [useNano, setUseNano] = useGeminiNanoPref();
  const [nanoStatus, setNanoStatus] = useState<NanoStatus | null>(null);
  const [lastBackend, setLastBackend] = useState<SpiritBackend | null>(null);
  const streamingRef = useRef<string | null>(null); // uri of current streaming message
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);
  const prevSendingRef = useRef(false);

  const agent = session.agent ?? null;
  const did = session.did ?? null;

  const userName = session.handle?.split('.')[0] ?? 'あなた';
  // 性格・口調・応答形式・例文 — 全部 admin の領分 (PDS の prompts/spiritChat に書く)。
  // 長さも admin の `maxNewTokens` で上書き可。code 側には fallback 数値だけ残す
  // (UI 安全のため、未設定時の暴走を抑える程度の小さな default)。
  // admin の prompt body 内の `{user}` `{archetype}` `{level}` を実行時に展開する。
  // 値が無い変数 (例: 診断未実施の {archetype}) は placeholder のまま残る
  // (admin が typo / 未定義に気付ける、UI で誤展開せず可視化される)。
  const systemPromptRaw = (config.prompts?.spiritChat?.body ?? '').trim();
  const archetypeName = diag ? jobDisplayName(diag.archetype, 'default') : undefined;
  const levelStr = diag?.jobLevel?.xp !== undefined ? String(jobLevelFromXp(diag.jobLevel.xp)) : undefined;
  const systemPrompt = useMemo(
    () =>
      applyPromptTemplate(systemPromptRaw, {
        user: userName,
        archetype: archetypeName,
        level: levelStr,
      }),
    [systemPromptRaw, userName, archetypeName, levelStr],
  );
  const spiritMaxNewTokens = config.prompts?.spiritChat?.maxNewTokens ?? SPIRIT_MAX_NEW_TOKENS_DEFAULT;

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
        // 召喚済み + キャッシュあり → 裏で静かにロード (儀式なし)。
        // モバイルは LLM 自体が乗らないので skip (会話 UI も別経路で隠す)。
        if (p.summoned && cached && !isLowEndDevice()) {
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

  // Gemini Nano (Chrome 内蔵 AI) の利用可能性を 1 回だけ問い合わせる。
  useEffect(() => {
    let cancelled = false;
    detectGeminiNano().then((s) => {
      if (!cancelled) setNanoStatus(s);
    });
    return () => { cancelled = true; };
  }, []);

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
    // PDS の累積カウンタも +userMessages (失敗しても UI は止めない)
    void bumpPower(agent, did, { userMessages: 1 });

    // spirit の返答を生成 (streaming)
    // 保留用 uri (本物が入るまで streamingRef で識別)
    const streamKey = `__streaming_${Date.now()}`;
    streamingRef.current = streamKey;
    const placeholder: HistoryItem = { uri: streamKey, role: 'spirit', text: '', createdAt: new Date().toISOString() };
    setHistory((h) => [...h, placeholder]);

    // 直近 HISTORY_TURNS ターン (1 ターン = user + spirit の 2 件) を LLM コンテキストに渡す。
    // 要約はせず、それ以前は忘れる。
    //
    // backend 切替 (Gemini Nano か TinySwallow か) と、TinySwallow 用の
    // system prompt prepend は spirit-generator.ts の router が引き受ける。
    const recentHistory = [...history.slice(-HISTORY_TURNS * 2), tempUser];
    const historyForGen = recentHistory.map((m) => ({
      role: m.role === 'spirit' ? ('assistant' as const) : ('user' as const),
      content: m.text,
    }));

    let full = '';
    try {
      const result = await generateSpirit(
        { systemPrompt, history: historyForGen },
        {
          maxNewTokens: spiritMaxNewTokens,
          onToken: (chunk: string) => {
            if (streamingRef.current !== streamKey) return;
            setHistory((h) => h.map((x) => (x.uri === streamKey ? { ...x, text: x.text + chunk } : x)));
          },
        },
      );
      full = result.text;
      setLastBackend(result.backend);
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
  }, [agent, did, points, input, sending, history, systemPrompt, spiritMaxNewTokens]);

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
        // PDS の累積カウンタの summoned フラグも立てる
        void bumpPower(agent, did, { summoned: true });
        // 儀式中にモデルはロード済み、キャッシュにも入った
        setCacheReady(true);
        setGeneratorReady(true);
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
        <h2>精霊ブルスコン</h2>
        <SpiritBubble sleeping>…</SpiritBubble>
      </div>
    );
  }

  if (session.status === 'signed-out') {
    return (
      <div>
        <h2>精霊ブルスコン</h2>
        <SpiritBubble>ログインすると、わたしの声が届きます。</SpiritBubble>
        <Link to="/onboarding"><button style={{ marginTop: '1em' }}>ログイン</button></Link>
      </div>
    );
  }

  if (!points) return null;

  const jobLabel = diag ? jobDisplayName(diag.archetype, 'default') : null;
  /** 召喚済みだがキャッシュが消えているため、再召喚の儀式を要求する状態。 */
  const needsResummon = points.summoned && !cacheReady;
  /** Nano を使う条件: ユーザー設定 ON + Nano available。Nano なら TinySwallow
   *  キャッシュロード完了を待たずに即チャット可能。 */
  const willUseNano = useNano && nanoStatus === 'available';
  const effectiveReady = willUseNano || generatorReady;

  return (
    <div>
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

          {isLowEndDevice() ? (
            <section style={{ marginTop: '0.8em' }}>
              <p style={{ fontSize: '0.85em', color: 'var(--color-muted)' }}>
                ブルスコンとの会話は PC のブラウザでのみ使えます。
                モバイルではブルスコンの存在を眺めるだけになります。
              </p>
            </section>
          ) : (
            <section style={{ marginTop: '0.8em', display: 'flex', flexDirection: 'column', gap: '0.3em' }}>
              <details style={{ fontSize: '0.8em' }}>
                <summary style={{ cursor: 'pointer', color: 'var(--color-muted)' }}>
                  ⚙ AI 設定
                  {lastBackend && (
                    <span style={{ marginLeft: '0.5em', padding: '0.05em 0.5em', borderRadius: 10, background: 'rgba(255,255,255,0.1)' }}>
                      前回: {lastBackend === 'gemini-nano' ? 'Gemini Nano' : 'TinySwallow'}
                    </span>
                  )}
                </summary>
                <div style={{ marginTop: '0.5em', paddingLeft: '0.5em', lineHeight: 1.6 }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.5em' }}>
                    <input
                      type="checkbox"
                      checked={useNano}
                      disabled={nanoStatus !== 'available'}
                      onChange={(e) => setUseNano(e.target.checked)}
                    />
                    <span>ブラウザ内蔵 AI を使う (Gemini Nano、速い)</span>
                  </label>
                  <p style={{ margin: '0.3em 0 0 1.8em', color: 'var(--color-muted)', fontSize: '0.9em' }}>
                    {nanoStatus === 'available' && 'お使いの環境では Gemini Nano が利用可能です。OFF にすると常に TinySwallow を使います。'}
                    {nanoStatus === 'downloadable' && 'Chrome がモデルを未取得のため使えません。他サイトで一度有効化されると自動的に使えるようになります。今は TinySwallow を使います。'}
                    {nanoStatus === 'downloading' && 'Chrome がモデルをダウンロード中。完了するまでは TinySwallow を使います。'}
                    {nanoStatus === 'unavailable' && 'お使いの環境では利用できません (Chrome 148+ デスクトップ専用)。TinySwallow を使います。'}
                    {nanoStatus === null && '利用可否を確認中…'}
                  </p>
                </div>
              </details>
              <div style={{ display: 'flex', gap: '0.4em', alignItems: 'flex-end' }}>
                <TextField
                  ref={inputRef}
                  value={input}
                  onChange={(v) => setInput(v.slice(0, INPUT_MAX))}
                  onSubmit={() => void sendMessage()}
                  placeholder={
                    !effectiveReady
                      ? 'ブルスコンを呼び戻している…'
                      : points.balance > 0
                        ? 'ブルスコンに話しかける'
                        : 'あなたの投稿を重ねると、話せるようになる'
                  }
                  disabled={sending || points.balance < 1 || !effectiveReady}
                  maxLength={INPUT_MAX}
                  style={{ flex: 1 }}
                />
                <button
                  onClick={() => void sendMessage()}
                  disabled={sending || points.balance < 1 || !input.trim() || !effectiveReady}
                >
                  {sending ? '…' : '送る'}
                </button>
              </div>
              <div style={{ fontSize: '0.75em', color: 'var(--color-muted)', textAlign: 'right' }}>
                {input.length} / {INPUT_MAX}
              </div>
            </section>
          )}
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

/** 精霊の応答を整える。最小限のクリーンアップだけ:
 *  特殊トークン / role prefix の除去 + 暴走時の保険として 400 字キャップ。
 *  応答長は **生成側 (prompt + max_new_tokens) で制御** する方針。後処理で
 *  文を切ると意味が壊れるので。
 */
function cleanGenerated(s: string): string {
  return s
    .replace(/^<\|.*?\|>/g, '')
    .replace(/<\|.*?\|>$/g, '')
    .replace(/^(assistant|system):\s*/i, '')
    .trim()
    .slice(0, 400);
}
