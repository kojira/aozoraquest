/**
 * ワールドの画面の右上の 🔊/🔇 (D-SOUND-001)。1 回押すとゲームの音 (BGM・効果音・Blueskyちゃんの声) をぜんぶ止め、
 * もう 1 回で戻す。端末に覚える。声の ON/OFF の設定は変えない。
 * 会話窓 (900/901) や戦闘 (900) の上でも押せるように、マップ枠の中で高い層に置く (エンカウント演出 1000 より下)。
 */
import { setSoundSetting, useSoundSettings } from '@/lib/sound/sound-store';
import { SOUND_MUTE_ATTR, soundPlayer } from '@/lib/sound/sound-player';

export const SOUND_MUTE_BUTTON_SIZE = 30;
const SOUND_MUTE_Z = 950;

export function SoundMuteButton() {
  const { muted } = useSoundSettings();
  return (
    <button
      type="button"
      {...{ [SOUND_MUTE_ATTR]: '' }}
      aria-pressed={muted}
      aria-label={muted ? 'ミュート中 (押すと音を出す)' : '音を消す (ミュート)'}
      title={muted ? 'ミュート中' : '音あり'}
      // 会話の送り・マップの操作 (スティック・自分タップ) へ伝えない
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        setSoundSetting('muted', !muted);
        // ミュートを外したタップの中で音を起こす (iOS)。ミュートにするタップでは起こさない (鳴らさない)。
        if (muted) soundPlayer.unlock();
      }}
      style={{
        position: 'absolute', top: 4, right: 4, zIndex: SOUND_MUTE_Z,
        width: SOUND_MUTE_BUTTON_SIZE, height: SOUND_MUTE_BUTTON_SIZE, padding: 0, minHeight: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 15, lineHeight: 1, borderRadius: 5,
        background: muted ? 'rgba(120, 30, 40, 0.85)' : 'rgba(20, 22, 30, 0.75)',
        border: '1px solid rgba(255,255,255,0.4)',
        touchAction: 'manipulation',
      }}
    >
      <span aria-hidden>{muted ? '🔇' : '🔊'}</span>
    </button>
  );
}
