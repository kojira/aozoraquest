import { useEffect, useRef, useState } from 'react';
import type { Agent } from '@atproto/api';
import { SpiritIcon } from './spirit-icon';
import { getGenerator, type ChatMessage } from '@/lib/generator';

interface SummoningRitualProps {
  agent: Agent;
  userName: string;
  systemPrompt: string;
  onComplete: (welcome: string) => Promise<void> | void;
  onCancel: () => void;
}

type Phase = 'gathering' | 'forming' | 'awakening' | 'greeting' | 'done' | 'error';

const NARRATIONS: Record<Phase, string> = {
  gathering: '青空の気配が集まる…',
  forming: '光の中に、形が見えてきた…',
  awakening: 'まぶたがゆっくりと開いていく…',
  greeting: '名乗りの言葉を、ブルスコンが紡いでいる…',
  done: '',
  error: '',
};

const MIN_PHASE_MS = 2200;

/**
 * ブルスコン召喚の儀式。
 *
 * TinySwallow のロードと演出を並列進行。演出は最低 ~7 秒、LLM ロードが長引く場合はその分伸びる。
 * 完了時に LLM で歓迎メッセージを生成し、onComplete で親に渡す。
 */
export function SummoningRitual({ agent: _agent, userName, systemPrompt, onComplete, onCancel }: SummoningRitualProps) {
  const [phase, setPhase] = useState<Phase>('gathering');
  const [err, setErr] = useState<string | null>(null);
  const startedAt = useRef(Date.now());
  const loadedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    const g = getGenerator();

    // 1) LLM ロード開始
    const loadPromise = g.load().then(() => {
      loadedRef.current = true;
    }).catch((e) => {
      if (cancelled) return;
      setErr(String((e as Error)?.message ?? e));
      setPhase('error');
    });

    // 2) 最低演出時間を確保しつつ phase を進める
    async function run() {
      // gathering 〜 awakening は時間で進める
      await sleep(MIN_PHASE_MS);
      if (cancelled) return;
      setPhase('forming');
      await sleep(MIN_PHASE_MS);
      if (cancelled) return;
      setPhase('awakening');
      await sleep(MIN_PHASE_MS);
      if (cancelled) return;

      // LLM ロード完了を待つ。ここで長く待つ可能性がある
      setPhase('greeting');
      await loadPromise;
      if (cancelled || err) return;
      if (!loadedRef.current) return; // エラーで中断

      // 歓迎メッセージを LLM に生成させる
      const messages: ChatMessage[] = [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: `${userName} があなたを初めて呼んだ。自己紹介と、これから短く話せる喜びを、1〜2 文で伝えてください。一人称は使わないでください。`,
        },
      ];

      let welcome = '';
      try {
        welcome = await g.generate(messages);
        welcome = cleanGenerated(welcome);
      } catch (e) {
        if (cancelled) return;
        setErr(String((e as Error)?.message ?? e));
        setPhase('error');
        return;
      }
      if (!welcome || welcome.length < 4) {
        welcome = `呼んでくれて、ありがとう、${userName}。ここにいる。`;
      }

      try {
        await onComplete(welcome);
      } catch (e) {
        if (cancelled) return;
        setErr(String((e as Error)?.message ?? e));
        setPhase('error');
        return;
      }
      if (!cancelled) setPhase('done');
    }

    void run();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // done になったら親の onComplete で閉じられる想定 (SummoningRitual 自体は消える)
  if (phase === 'done') return null;

  if (phase === 'error') {
    return (
      <div className="summon-overlay" role="alertdialog" aria-modal="true">
        <div style={{ textAlign: 'center', color: '#ffffff', padding: '2em' }}>
          <SpiritIcon size={96} sleeping />
          <h2 style={{ marginTop: '0.8em' }}>今日は儀式を続けられないようだ</h2>
          <p style={{ marginTop: '0.5em', color: '#c9d4e0' }}>{err ?? '原因不明'}</p>
          <p style={{ marginTop: '0.5em', fontSize: '0.85em', color: '#9fb3c8' }}>
            (WebGPU が使えるブラウザで再試行すると進みます)
          </p>
          <div style={{ display: 'flex', gap: '0.5em', justifyContent: 'center', marginTop: '1.2em' }}>
            <button onClick={onCancel}>やめる</button>
          </div>
        </div>
      </div>
    );
  }

  // 進行中
  const elapsed = Date.now() - startedAt.current;
  return (
    <div className="summon-overlay" role="dialog" aria-modal="true" aria-label="精霊召喚の儀式">
      <div className="summon-stage">
        {/* 粒子 */}
        {buildParticles(24)}

        {/* シルエット (phase によって徐々にはっきり) */}
        <div
          className="summon-silhouette"
          style={{
            opacity: phase === 'gathering' ? 0.2 : phase === 'forming' ? 0.55 : 1,
            transition: 'opacity 800ms ease',
          }}
        >
          <SpiritIcon
            size={180}
            sleeping={phase === 'gathering' || phase === 'forming'}
          />
        </div>

        {/* awakening 以降の星 */}
        {(phase === 'awakening' || phase === 'greeting') && (
          <>
            <span className="summon-sparkle" style={{ top: '10%', left: '20%' }} />
            <span className="summon-sparkle" style={{ top: '15%', right: '18%', animationDelay: '0.3s' }} />
            <span className="summon-sparkle" style={{ bottom: '20%', left: '12%', animationDelay: '0.6s' }} />
            <span className="summon-sparkle" style={{ bottom: '15%', right: '22%', animationDelay: '0.9s' }} />
          </>
        )}
      </div>

      {/* ナレーション */}
      <div
        key={phase}
        style={{
          position: 'absolute',
          bottom: '14%',
          left: 0,
          right: 0,
          textAlign: 'center',
          color: '#ffffff',
          fontSize: '1.05em',
          letterSpacing: '0.04em',
          animation: 'ritual-fade-in 700ms ease',
        }}
      >
        {NARRATIONS[phase]}
      </div>

      {/* 経過を隠す代わりに「歩みを重ねる」遠い数値は出さない。長引いたときだけヒント。 */}
      {phase === 'greeting' && elapsed > 15000 && (
        <div style={{ position: 'absolute', bottom: '8%', left: 0, right: 0, textAlign: 'center', fontSize: '0.8em', color: '#9fb3c8' }}>
          もう少しで姿が現れる
        </div>
      )}
    </div>
  );
}

function buildParticles(n: number) {
  const nodes: React.ReactElement[] = [];
  for (let i = 0; i < n; i++) {
    const xStart = `${Math.random() * 100 - 50}vw`;
    const xEnd = `${(Math.random() * 30 - 15)}vw`;
    const delay = `${Math.random() * 2}s`;
    const duration = `${2 + Math.random() * 1.2}s`;
    nodes.push(
      <span
        key={i}
        className="summon-particle"
        style={{
          ['--x-start' as string]: xStart,
          ['--x-end' as string]: xEnd,
          animationDelay: delay,
          animationDuration: duration,
        } as React.CSSProperties}
      />,
    );
  }
  return nodes;
}

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

/** LLM が余計なマークを出したときの整形 */
function cleanGenerated(s: string): string {
  return s
    .replace(/^<\|.*?\|>/g, '')
    .replace(/<\|.*?\|>$/g, '')
    .replace(/^(assistant|system):\s*/i, '')
    .trim()
    .slice(0, 400);
}
