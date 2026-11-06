import type { TtsAsset } from './tts-assets';
export type TtsCacheLike = Pick<Cache, 'match' | 'put' | 'delete'> | { match(u: string): Promise<Response | undefined>; put(u: string, r: Response): Promise<void>; delete(u: string): Promise<boolean> };
export class TtsNotCachedError extends Error {}
export async function fetchTtsAsset(_a: TtsAsset, _c: TtsCacheLike | null, _o: { allowNetwork: boolean; onBytes?: (n: number) => void }): Promise<ArrayBuffer> { return new ArrayBuffer(0); }
