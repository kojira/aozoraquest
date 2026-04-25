import { useEffect, useRef, useState } from 'react';
import type { Agent } from '@atproto/api';
import { SpiritIcon } from './spirit-icon';
import { getGenerator, type ChatMessage } from '@/lib/generator';
import { isLowEndDevice } from '@/lib/device';

interface SummoningRitualProps {
  agent: Agent;
  userName: string;
  systemPrompt: string;
  onComplete: (welcome: string) => Promise<void> | void;
  onCancel: () => void;
}

type Phase = 'gathering' | 'forming' | 'awakening' | 'greeting' | 'emerging' | 'done' | 'error';

// phase ごとの基本ナレーション。greeting 中は変化させたいので追加プールも用意する
const STATIC_NARRATIONS: Partial<Record<Phase, string>> = {
  gathering: '青空の気配が集まる…',
  forming: '光の中に、形が見えてきた…',
  awakening: 'まぶたがゆっくりと開いていく…',
  emerging: '',
};

/** greeting 中は長引くので、数秒ごとにこのプールから言葉を差し替える。 */
const GREETING_POOL: readonly string[] = [
  '名乗りの言葉を、ブルスコンが紡いでいる…',
  '空の奥で、声の形を整えている…',
  '吹く風が、言葉を運んでこようとしている…',
  'あなたの呼びかけが、深いところまで届いている…',
  '光の粒が、一つひとつ意味を帯びていく…',
  '遠くの雲が、耳を澄ませているようだ…',
  'ふるえる気配が、かたちを探している…',
  'もうすぐ、最初のひと息が聞こえる…',
  '言葉になる前の、静けさが満ちる…',
  '空色の糸が、ゆっくりと編まれていく…',
  '名前の輪郭が、淡く立ち上がる…',
  '一つひとつの音が、選ばれていく…',
];

const MIN_PHASE_MS = 2200;
const GREETING_NARRATION_INTERVAL = 3200;

/**
 * ブルスコン召喚の儀式。
 *
 * TinySwallow のロードと演出を並列進行。演出は最低 ~7 秒、LLM ロードが長引く場合は
 * greeting フェーズでナレーションを巡回させて間を持たせる。ロード完了 → 歓迎メッセージ
 * 生成完了の瞬間に 'emerging' フェーズに入り、フラッシュ + 星弾けの演出をしてから閉じる。
 */
export function SummoningRitual({ agent: _agent, userName, systemPrompt, onComplete, onCancel }: SummoningRitualProps) {
  const [phase, setPhase] = useState<Phase>('gathering');
  const [greetingIdx, setGreetingIdx] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const startedAt = useRef(Date.now());
  const loadedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    // モバイルは LLM が乗らないので儀式自体を hand-crafted 完走させる。
    // モデル DL すらしない (Cache Storage 圧迫もしない)。
    const skipLlm = isLowEndDevice();
    const g = skipLlm ? null : getGenerator();

    const loadPromise = skipLlm
      ? Promise.resolve()
      : g!.load().then(() => {
          loadedRef.current = true;
        }).catch((e) => {
          if (cancelled) return;
          setErr(String((e as Error)?.message ?? e));
          setPhase('error');
        });

    async function run() {
      await sleep(MIN_PHASE_MS);
      if (cancelled) return;
      setPhase('forming');
      await sleep(MIN_PHASE_MS);
      if (cancelled) return;
      setPhase('awakening');
      await sleep(MIN_PHASE_MS);
      if (cancelled) return;

      setPhase('greeting');
      await loadPromise;
      if (cancelled || err) return;

      let welcome = '';
      if (skipLlm) {
        // モバイル: ハンドクラフト固定文 (一人称無し)
        welcome = `呼んでくれて、ありがとう、${userName}。ここにいる。`;
      } else {
        if (!loadedRef.current) return;
        const messages: ChatMessage[] = [
          { role: 'system', content: systemPrompt },
          {
            role: 'user',
            content: `${userName} があなたを初めて呼んだ。自己紹介と、これから短く話せる喜びを、1〜2 文で伝えてください。一人称は使わないでください。`,
          },
        ];
        try {
          welcome = await g!.generate(messages);
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
      }

      // 生成が終わったところで 'emerging' に遷移してスペクタクル演出
      if (cancelled) return;
      setPhase('emerging');
      // 演出が見えるように少し待つ
      await sleep(2200);
      if (cancelled) return;

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

  // greeting 中はナレーションを巡回
  useEffect(() => {
    if (phase !== 'greeting') return;
    const id = setInterval(() => {
      setGreetingIdx((i) => (i + 1) % GREETING_POOL.length);
    }, GREETING_NARRATION_INTERVAL);
    return () => clearInterval(id);
  }, [phase]);

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

  const elapsed = Date.now() - startedAt.current;
  const narrationText =
    phase === 'greeting' ? GREETING_POOL[greetingIdx]! : (STATIC_NARRATIONS[phase] ?? '');
  const narrationKey = phase === 'greeting' ? `greet-${greetingIdx}` : `phase-${phase}`;

  const emerging = phase === 'emerging';

  return (
    <div className="summon-overlay" role="dialog" aria-modal="true" aria-label="精霊召喚の儀式">
      {/* emergence 用フラッシュ (一瞬、画面全体を白光で覆う) */}
      {emerging && <div className="summon-flash" aria-hidden />}

      <div className="summon-stage">
        {/* 粒子 */}
        {!emerging && buildParticles(24)}

        {/* シルエット */}
        <div
          className={`summon-silhouette${emerging ? ' emerging' : ''}`}
          style={{
            opacity: phase === 'gathering' ? 0.2 : phase === 'forming' ? 0.55 : 1,
            transition: 'opacity 800ms ease',
          }}
        >
          <SpiritIcon
            size={emerging ? 220 : 180}
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

        {/* emerging: 放射状に弾ける大きな星たち */}
        {emerging && (
          <>
            {Array.from({ length: 14 }).map((_, i) => {
              const angle = (360 / 14) * i;
              return (
                <span
                  key={i}
                  className="summon-burst"
                  style={{
                    ['--angle' as string]: `${angle}deg`,
                    animationDelay: `${Math.random() * 0.15}s`,
                  } as React.CSSProperties}
                />
              );
            })}
          </>
        )}
      </div>

      {/* ナレーション (greeting 中は key 切り替えでフェード) */}
      {!emerging && narrationText && (
        <div
          key={narrationKey}
          style={{
            position: 'absolute',
            bottom: '14%',
            left: 0,
            right: 0,
            textAlign: 'center',
            color: '#ffffff',
            fontSize: '1.05em',
            letterSpacing: '0.04em',
            animation: 'ritual-text-swap 3200ms ease',
          }}
        >
          {narrationText}
        </div>
      )}

      {/* 出現宣言 */}
      {emerging && (
        <div
          style={{
            position: 'absolute',
            bottom: '18%',
            left: 0,
            right: 0,
            textAlign: 'center',
            color: '#ffffff',
            fontSize: '1.6em',
            letterSpacing: '0.08em',
            fontWeight: 700,
            textShadow: '0 0 16px rgba(159, 215, 255, 0.85), 0 0 40px rgba(255, 255, 255, 0.6)',
            animation: 'ritual-announce 1800ms ease',
          }}
        >
          ブルスコン、あらわれた!
        </div>
      )}

      {phase === 'greeting' && elapsed > 20000 && (
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

function cleanGenerated(s: string): string {
  return s
    .replace(/^<\|.*?\|>/g, '')
    .replace(/<\|.*?\|>$/g, '')
    .replace(/^(assistant|system):\s*/i, '')
    .trim()
    .slice(0, 400);
}
