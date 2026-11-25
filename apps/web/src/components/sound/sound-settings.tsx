/**
 * 設定画面の「BGM」「効果音」の ON/OFF (D-SOUND-001)。どちらもはじめから ON。
 * ワールドの 🔊/🔇 (ミュート) はこの上の親スイッチ。作りは VoiceToggle (settings) にそろえる。
 */
import { setSoundSetting, useSoundSettings } from '@/lib/sound/sound-store';

function Row({ label, on, onToggle }: { label: string; on: boolean; onToggle: () => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.6em', flexWrap: 'wrap', fontSize: '0.9em' }}>
      <span>{label}</span>
      <button type="button" aria-pressed={on} onClick={(e) => { e.stopPropagation(); onToggle(); }} style={{ fontSize: '0.9em', padding: '0.2em 0.8em' }}>
        {on ? 'ON' : 'OFF'}
      </button>
    </div>
  );
}

export function SoundSettings() {
  const { bgm, se, muted } = useSoundSettings();
  return (
    <div style={{ marginTop: '1em' }}>
      <div style={{ display: 'flex', gap: '1.2em', flexWrap: 'wrap' }}>
        <Row label="あおぞらワールドの BGM" on={bgm} onToggle={() => setSoundSetting('bgm', !bgm)} />
        <Row label="効果音" on={se} onToggle={() => setSoundSetting('se', !se)} />
      </div>
      <p style={{ fontSize: '0.75em', color: 'var(--color-muted)', marginTop: '0.3em', marginLeft: '0.2em' }}>
        ワールドで、ファミコン風の曲と効果音を鳴らします (音は端末の中で作ります)。画面を最初にタップしたときから鳴ります。
        ワールドの右上の 🔊 を押すと、BGM・効果音・Blueskyちゃんの声をまとめて消せます{muted ? ' (いまはミュート中)' : ''}。
        iPhone は、消音スイッチがオンだと鳴らないことがあります。
      </p>
    </div>
  );
}
