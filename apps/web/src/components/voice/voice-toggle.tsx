/**
 * Blueskyちゃんの声 (D-TTS-001) のトグルとクレジット。
 * - 会話窓 (variant 'dialogue'): 窓の右上の小さなボタン。押しても会話は進まない。
 * - 設定 (variant 'settings'): 説明・進捗・クレジットつき。
 * クレジットは ZEN-TTS ライセンス 1.0 §3.1 の文言そのまま、URL をリンクにする。
 */
import type { CSSProperties, ReactNode } from 'react';
import { toggleVoice, useVoiceState } from '@/lib/tts/voice-store';
import { TTS_TOTAL_BYTES } from '@/lib/tts/tts-assets';

const ZEN_URL = 'https://zenryokukikai.com';
const MB = (n: number) => Math.round(n / 1_000_000);

/** 「音声合成：ZEN-TTS（https://zenryokukikai.com ）」 */
export function ZenTtsCredit({ style }: { style?: CSSProperties }) {
  return <span style={style}>音声合成：ZEN-TTS（<a href={ZEN_URL} target="_blank" rel="noopener noreferrer">{ZEN_URL}</a> ）</span>;
}

function Progress({ loaded, total, compact }: { loaded: number; total: number; compact?: boolean }) {
  const all = total || TTS_TOTAL_BYTES;
  return (
    <span role="status" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4em' }}>
      <progress value={loaded} max={all} style={{ width: compact ? '3em' : '6em' }} aria-label="声のダウンロード" />
      <span>{MB(loaded)}/{MB(all)}MB</span>
    </span>
  );
}

export function VoiceToggle({ variant }: { variant: 'dialogue' | 'settings' }) {
  const { enabled, installing, error } = useVoiceState();
  const button = (
    <button
      type="button"
      aria-pressed={enabled}
      disabled={!!installing}
      // 会話窓の送り面・窓本体の click (行送り) へ伝えない
      onClick={(e) => { e.stopPropagation(); toggleVoice(); }}
      onKeyDown={(e) => e.stopPropagation()}
      style={variant === 'dialogue'
        ? { fontSize: '0.75em', padding: '0.1em 0.6em', lineHeight: 1.4, opacity: enabled ? 1 : 0.75, touchAction: 'manipulation' }
        : { fontSize: '0.9em', padding: '0.2em 0.8em' }}
    >
      🔊 声
    </button>
  );
  const status: ReactNode = installing
    ? <Progress loaded={installing.loaded} total={installing.total} compact={variant === 'dialogue'} />
    : error ? <span role="alert" style={{ color: '#b00' }}>{error}</span>
      : variant === 'settings' ? <span>{enabled ? 'ON' : 'OFF'}</span> : null;
  if (variant === 'dialogue') {
    return (
      <span onClick={(e) => e.stopPropagation()} className={status ? 'dq-window' : undefined}
        style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4em', fontSize: '0.85em', pointerEvents: 'auto', ...(status ? { padding: '0.15em 0.4em', margin: 0 } : {}) }}>
        {status}
        {button}
      </span>
    );
  }
  return (
    <div style={{ marginTop: '1em' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6em', flexWrap: 'wrap', fontSize: '0.9em' }}>
        <span>Blueskyちゃんの声</span>
        {button}
        {status}
      </div>
      <p style={{ fontSize: '0.75em', color: 'var(--color-muted)', marginTop: '0.3em', marginLeft: '0.2em' }}>
        ON にすると、ギルドの受付などで Blueskyちゃんのセリフを声で読みます。声は端末の中で作ります (セリフを外部に送りません)。
        はじめて ON にしたときだけ、声のデータ (約{MB(TTS_TOTAL_BYTES)}MB) をダウンロードします。
        <br />
        <ZenTtsCredit />
      </p>
    </div>
  );
}

/** プライバシーのページのクレジット (どこからでも見つけられる場所)。 */
export function PrivacyVoiceCredit() {
  return (
    <p style={{ fontSize: '0.8em', color: 'var(--color-muted)' }}>
      <ZenTtsCredit />
      <br />
      音声モデル：Blueskyちゃん（<a href="https://github.com/kojira/zen-tts-models" target="_blank" rel="noopener noreferrer">https://github.com/kojira/zen-tts-models</a> ）
    </p>
  );
}
