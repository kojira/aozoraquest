import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { DiagnosisResult } from '@aozoraquest/core';
import {
  GREETING_HOUR_BOUNDARIES,
  jobDisplayName,
  jobLevelFromXp,
  pickSpiritLine,
  questXpScalar,
  type SpiritSituation,
} from '@aozoraquest/core';
import { useSession } from '@/lib/session';
import { getRecord } from '@/lib/atproto';
import { listReceivedQuests, loadCompletionsByUri } from '@/lib/quest-api';
import { COL } from '@/lib/collections';
import { SpiritIcon } from '@/components/spirit-icon';
import { SpiritBubble } from '@/components/spirit-bubble';
import { SummoningRitual } from '@/components/summoning-ritual';
import { useOnPosted } from '@/components/compose-modal';
import { useRuntimeConfig } from '@/components/config-provider';
import { applyPromptTemplate } from '@/lib/prompt-template';
import { bumpPower, loadPointsState, SUMMON_THRESHOLD, type PointsState } from '@/lib/points';
import { WORLD_PREVIEW_ENABLED } from '@/lib/world-preview';
import { isAdminDid } from '@/lib/runtime-config';

/**
 * 精霊ブルスコンのページ。
 *
 * かつてはブルスコンとの LLM チャット → 「ブルスコンの試練」(ターン制バトル) と
 * 変遷したが、いずれも撤去し、召喚後の主導線を「あおぞらワールド」(docs/19) に
 * 一本化した (オーナー決定 2026-07-19。試練の戦闘画面が旧仕様で表示崩れのため)。
 * 召喚の儀式 (E1/E2) は従来どおりのゲート。過去の spiritChat レコードは消さない
 * (パワー式の userMessages も従来どおり数える = 残高は変わらない)。
 */

type GreetingSituation = 'greeting.morning' | 'greeting.daytime' | 'greeting.night';

function currentGreeting(): GreetingSituation {
  const h = new Date().getHours();
  if (h < GREETING_HOUR_BOUNDARIES.morningEnd) return 'greeting.morning';
  if (h < GREETING_HOUR_BOUNDARIES.dayEnd) return 'greeting.daytime';
  return 'greeting.night';
}

export function Spirit() {
  const session = useSession();
  const config = useRuntimeConfig();
  const [diag, setDiag] = useState<DiagnosisResult | null>(null);
  const [points, setPoints] = useState<PointsState | null>(null);
  // 受託完了クエストの経験値 (現職 LV に加算)。
  const [questXp, setQuestXp] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [ritualOpen, setRitualOpen] = useState(false);
  // 管理者用パワー付与の書込み中フラグ (dev 限定・多重押し防止)
  const [grantingPower, setGrantingPower] = useState(false);

  const agent = session.agent ?? null;
  const did = session.did ?? null;
  const userName = session.handle?.split('.')[0] ?? 'あなた';

  // 召喚の儀式の口上生成 (LLM。失敗時は ritual 側の手書き fallback)。
  // 性格・口調は admin の prompts/spiritChat の領分のまま。
  const systemPromptRaw = (config.prompts?.spiritChat?.body ?? '').trim();
  const archetypeName = diag ? jobDisplayName(diag.archetype, 'default') : undefined;
  const levelStr = diag?.jobLevel?.xp !== undefined ? String(jobLevelFromXp(diag.jobLevel.xp + questXp)) : undefined;
  const systemPrompt = useMemo(
    () =>
      applyPromptTemplate(systemPromptRaw, {
        user: userName,
        archetype: archetypeName,
        level: levelStr,
      }),
    [systemPromptRaw, userName, archetypeName, levelStr],
  );

  // 初期ロード: diagnosis, points, quest XP
  useEffect(() => {
    if (session.status !== 'signed-in' || !agent || !did) {
      setLoaded(true);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const [r, p, rxp] = await Promise.all([
          getRecord<DiagnosisResult>(agent, did, COL.analysis, 'self').catch(() => null),
          loadPointsState(agent, did),
          listReceivedQuests(agent, did).then(async (qs) => questXpScalar(qs, did, await loadCompletionsByUri(qs))).catch(() => 0),
        ]);
        if (cancelled) return;
        setDiag(r);
        setPoints(p);
        setQuestXp(rxp);
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

  const greetingLines = useMemo(() => {
    if (session.status !== 'signed-in' || !did) return [];
    const ctx = { userName, userDid: did };
    const situations: SpiritSituation[] = [currentGreeting()];
    const collected: string[] = [];
    for (const s of situations) {
      const line = pickSpiritLine(s, ctx);
      if (line) collected.push(line);
    }
    return collected;
  }, [session.status, did, userName]);

  const onCancelRitual = useCallback(() => {
    setRitualOpen(false);
  }, []);

  const onCompleteRitual = useCallback(
    async (welcome: string) => {
      if (!agent || !did) return;
      const createdAt = new Date().toISOString();
      try {
        // 初回の口上を spiritChat に 1 件残す (summoned 判定 = レコード有無 のため)。
        await agent.com.atproto.repo.createRecord({
          repo: did,
          collection: COL.spiritChat,
          record: { $type: COL.spiritChat, role: 'spirit', text: welcome, createdAt },
        });
        setPoints((p) => (p ? { ...p, summoned: true } : p));
        // PDS の累積カウンタの summoned フラグも立てる
        void bumpPower(agent, did, { summoned: true });
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

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6em', marginBottom: '0.2em' }}>
        <div className={points.summoned ? '' : 'breathe'}>
          <SpiritIcon size={56} sleeping={!points.summoned} />
        </div>
        <div>
          <h2 style={{ margin: 0 }}>精霊ブルスコン</h2>
          <p style={{ margin: 0, fontSize: '0.8em', color: 'var(--color-muted)' }}>
            {jobLabel ? `あなたは今「${jobLabel}」の姿` : 'じぶんのページで気質を調べよう'}
          </p>
        </div>
      </div>

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
            <div style={{ height: 8, background: 'var(--color-track-bg)', borderRadius: 4, overflow: 'hidden' }}>
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
              background: 'var(--color-pill-bg)',
              color: 'var(--color-fg)',
              border: '3px solid var(--color-pill-border)',
              boxShadow: '0 0 20px rgba(159, 215, 255, 0.45)',
            }}
          >
            召喚の儀式を始める
          </button>
        </section>
      )}

      {/* ─── E3: summoned = あおぞらワールドへの入口 ─── */}
      {points.summoned && (
        <>
          <section style={{ marginTop: '1em', display: 'flex', flexDirection: 'column', gap: '0.6em' }}>
            {greetingLines.map((line, i) => (
              <SpiritBubble key={`greet-${i}`} showIcon={i === 0}>{line}</SpiritBubble>
            ))}
          </section>

          {/* あおぞらワールド (docs/19) の入口。試練より上に置く (旅がメイン導線 —
              オーナー要望 2026-07-18)。プレビュー段階 = dev 環境限定。 */}
          {WORLD_PREVIEW_ENABLED && (
            <section style={{ marginTop: '1.4em', textAlign: 'center' }}>
              <Link to="/world">
                {/* 主導線として pill 枠 + 背景で目立たせる。発光グロー (boxShadow) は
                    一度きりの「召喚の儀式」ボタン専用に温存し、最強調シグナルの
                    希少性を保つ (レビュー ★★) */}
                <button
                  type="button"
                  style={{
                    padding: '0.8em 1.8em',
                    fontSize: '1.05em',
                    background: 'var(--color-pill-bg)',
                    color: 'var(--color-fg)',
                    border: '3px solid var(--color-pill-border)',
                  }}
                >
                  🗺 あおぞらワールドを冒険する
                </button>
              </Link>
              <p style={{ fontSize: '0.75em', color: 'var(--color-muted)', marginTop: '0.4em', maxWidth: 260, marginInline: 'auto' }}>
                街をめぐり、戦い、そうびを整える旅へ。
              </p>
            </section>
          )}

          {/* 本番 (WORLD_PREVIEW_ENABLED=false) ではワールド入口を出さないため、
              このままだと召喚後が挨拶のみの行き止まりになる (レビュー ★★★)。
              旅の解禁を匂わせる精霊の一言だけ置いて「無」を避ける (DQ 風に最小限)。
              ワールドを本番解禁する判断はオーナー領分なので、ここでは入口を出さない。 */}
          {!WORLD_PREVIEW_ENABLED && (
            <section style={{ marginTop: '1.4em', textAlign: 'center' }}>
              <SpiritBubble>
                次の旅の支度をしている。もう少しだけ、待っておくれ。
              </SpiritBubble>
            </section>
          )}

          {/* 管理者用: dev でパワーを付与してテストする。VITE_ADMIN_DIDS の DID かつ
              プレビュー環境 (dev/local) のときだけ表示。本番遮断は WORLD_PREVIEW_ENABLED
              (本番ビルドでは false → dead-code) が担い、isAdminDid は dev 内での権限分離。
              加算は残高に純増する salePowerEarned に乗せる (viaPosts は召喚進捗ゲージ・
              toSummon も動かす別セマンティクスなので、残高だけ盛る用途では使わない)。 */}
          {WORLD_PREVIEW_ENABLED && agent && did && isAdminDid(did) && (
            <section style={{ marginTop: '1em', textAlign: 'center' }}>
              <div
                style={{
                  display: 'inline-flex',
                  gap: '0.5em',
                  alignItems: 'center',
                  fontSize: '0.78em',
                  border: '1px dashed var(--color-muted)',
                  borderRadius: 6,
                  padding: '0.45em 0.7em',
                  color: 'var(--color-muted)',
                }}
              >
                <span>{grantingPower ? '管理者用 · 付与中…' : `管理者用 · あおぞらパワー ${points.balance}`}</span>
                {[100, 1000].map((n) => (
                  <button
                    key={n}
                    type="button"
                    disabled={grantingPower}
                    onClick={async () => {
                      setGrantingPower(true);
                      try {
                        await bumpPower(agent, did, { salePowerEarned: n });
                        const next = await loadPointsState(agent, did);
                        setPoints(next);
                      } catch (e) {
                        console.warn('admin power grant failed', e);
                      } finally {
                        setGrantingPower(false);
                      }
                    }}
                    style={{ fontSize: '1em', padding: '0.2em 0.6em' }}
                  >
                    +{n}
                  </button>
                ))}
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
