import { useEffect, useRef, useState } from 'react';
import type { Agent } from '@atproto/api';
import { SpiritIcon } from './spirit-icon';
import { RitualStage } from './ritual-stage';
import { pickLocalLLM, resetLocalLLMChoice } from '@/lib/local-llm';
import { GEMINI_NANO } from '@/lib/gemini-nano-llm';
import { installSlm, SlmStorageFullError } from '@/lib/slm-llm';

interface SummoningRitualProps {
  agent: Agent;
  userName: string;
  systemPrompt: string;
  /** 確認シートで承諾した時だけ true。儀式の間にブルスコン (約 660MB) を受け取る。 */
  download: boolean;
  onComplete: (welcome: string) => Promise<void> | void;
  /** 受け取りの途中で端末の空きが足りなくなった (儀式は手書きの口上で完走する)。 */
  onStorageFull: () => void;
  onCancel: () => void;
}

/** 重みの受け取りの進捗 (byte)。 */
interface DownloadProgress { loaded: number; total: number }

const MB = 1_000_000;

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
 * LLM 利用可能性 (Nano など) のチェックと演出を並列で進める。確認シートで承諾した (download) 時は、
 * ブルスコン (LFM2.5) をここでダウンロードし、終わるまで greeting で待つ。受け取り中は hint に MB の進捗を出す
 * (口上は手書き固定文のまま。失敗しても儀式は完走し、精霊タブのボタンからやり直せる)。演出は最低 ~7 秒、
 * LLM 応答が長引いた場合は greeting フェーズでナレーションを巡回させて間を持たせる。
 * LLM 応答完了 (or LLM 利用不可で hand-crafted 採用) の瞬間に 'emerging' フェーズへ
 * 遷移し、フラッシュ + 星弾けの演出をしてから閉じる。
 */
export function SummoningRitual({ agent: _agent, userName, systemPrompt, download, onComplete, onStorageFull, onCancel }: SummoningRitualProps) {
  const [phase, setPhase] = useState<Phase>('gathering');
  const [greetingIdx, setGreetingIdx] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [progress, setProgress] = useState<DownloadProgress | null>(null);
  const startedAt = useRef(Date.now());

  useEffect(() => {
    let cancelled = false;
    // LLM 利用可能性は儀式の早い段階で並行 probe しておく (greeting 到達時に確定済)。
    // 口上は Nano だけに任せる (ブルスコンに任せるのは D-SLM-CARD-001 の範囲外。ブルスコンなら手書きの口上)。
    const llmProbe = pickLocalLLM().then((l) => (l?.id === GEMINI_NANO.id ? l : null)).catch(() => null);
    const slmInstall = download
      ? installSlmDuringRitual((loaded, total) => { if (!cancelled) setProgress({ loaded, total }); }, onStorageFull)
        .finally(() => { if (!cancelled) setProgress(null); })
      : Promise.resolve();

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
      const llm = await llmProbe;
      await slmInstall;
      if (cancelled) return;

      let welcome = '';
      if (!llm) {
        // LLM 利用不可 (Firefox/Safari/モバイル等): ハンドクラフト固定文
        welcome = `呼んでくれて、ありがとう、${userName}。ここにいる。`;
      } else {
        // 儀式特有のタスク指示。`# あなたへの依頼` ヘッダで「今やること」を明示する。
        const taskBlock = `# あなたへの依頼\n${userName} があなたを初めて呼んだ。自己紹介と、これから短く話せる喜びを、1〜2 文で伝えてください。一人称は使わないでください。`;
        try {
          const text = await llm.generate({ systemPrompt, history: [{ role: 'user', content: taskBlock }] });
          welcome = cleanGenerated(text);
        } catch (e) {
          console.warn('[ritual] LLM failed, falling back to hand-crafted welcome', e);
          welcome = '';
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
            (PDS への書き込みが失敗したようです。少し待ってから再試行してください)
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

  return (
    <RitualStage
      phase={phase}
      narration={narrationText}
      narrationKey={narrationKey}
      hint={progress
        ? `ブルスコンを呼び出し中 ${Math.floor(progress.loaded / MB)} / ${Math.round(progress.total / MB)} MB`
        : phase === 'greeting' && elapsed > 20000 ? 'もう少しで姿が現れる' : undefined}
      label="精霊召喚の儀式"
    />
  );
}

/** ブルスコンを受け取る。失敗しても儀式は手書きの口上で完走する (空きが足りなければ onStorageFull で知らせる)。 */
async function installSlmDuringRitual(onProgress: (loaded: number, total: number) => void, onStorageFull: () => void): Promise<void> {
  try {
    await installSlm(onProgress);
    resetLocalLLMChoice();
  } catch (e) {
    console.warn('[ritual] slm install failed', e);
    if (e instanceof SlmStorageFullError) onStorageFull();
  }
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
