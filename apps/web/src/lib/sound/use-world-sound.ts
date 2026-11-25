/**
 * ワールドの画面の音 (D-SOUND-001)。場面の曲を決め、最初の操作で音を起こす。画面を出たら曲を止める。
 * levelUpKey: レベルアップした決着の鍵 (戦闘の id)。変わったらジングルを 1 回。
 */
import { useEffect } from 'react';
import { installSoundUnlock, soundPlayer } from './sound-player';
import type { SongId } from './songs';

export function useWorldSound(scene: SongId | null, levelUpKey: string | null): void {
  useEffect(() => {
    const uninstall = installSoundUnlock();
    return () => { uninstall(); soundPlayer.setScene(null); };
  }, []);
  useEffect(() => { soundPlayer.setScene(scene); }, [scene]);
  useEffect(() => { if (levelUpKey) soundPlayer.playJingle('levelup'); }, [levelUpKey]);
}
