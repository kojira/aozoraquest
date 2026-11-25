/**
 * ワールドの画面の音 (D-SOUND-001)。場面の曲を決め (worldSound)、最初の操作で音を起こす。画面を出たら曲を止める。
 * jingle の鍵が変わったらジングルを 1 回 (レベルアップ・負け)。
 */
import { useEffect } from 'react';
import { installSoundUnlock, soundPlayer } from './sound-player';
import type { WorldSound } from './world-sound-scene';

export function useWorldSound({ scene, jingle }: WorldSound): void {
  useEffect(() => {
    const uninstall = installSoundUnlock();
    return () => { uninstall(); soundPlayer.setScene(null); };
  }, []);
  useEffect(() => { soundPlayer.setScene(scene); }, [scene]);
  const jingleKey = jingle?.key ?? null;
  useEffect(() => { if (jingle) soundPlayer.playJingle(jingle.id); }, [jingleKey]); // eslint-disable-line react-hooks/exhaustive-deps -- 鍵が変わったときだけ
}
