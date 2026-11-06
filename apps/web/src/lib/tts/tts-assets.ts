/**
 * Blueskyちゃんの声のファイル (D-TTS-001)。端末の Cache Storage `tts-v1` に置く (他のモデルのキャッシュとは別)。
 *
 * - 声のモデル bluesky.ztm (kojira/zen-tts-models の bluesky-v1.1.0 をそのまま) は HF に置き、commit で固定する。
 * - ZEN-TTS の G2P と CPU カーネルは改変・単体の再配布ができない (ZEN-TTS ライセンス 1.0) ので、依存の
 *   zen-tts パッケージからビルド時にこのアプリの dist へ写し、自分のオリジンからだけ配る (vite の zenTtsAssetsPlugin)。
 */
export interface TtsAsset { url: string; bytes: number; sha256: string }

export const TTS_CACHE_NAME = 'tts-v1';
const HF_COMMIT = 'd00b061951e41cdeb35f9d072fd3b0241e9703f5';
export const TTS_ZTM_URL = `https://huggingface.co/kojira/aozoraquest-cognitive-small/resolve/${HF_COMMIT}/tts/bluesky-1.1.0/bluesky.ztm`;
/** ZEN-TTS の modelsUrl (この下に g2p/)。版ごとにパスを分ける。 */
export const TTS_MODELS_URL = '/zen-tts/1.2.0/models';
export const TTS_CPU_WASM_URL = '/zen-tts/1.2.0/cpu/tts-cpu.wasm';

export const TTS_ASSETS: readonly TtsAsset[] = [
  { url: TTS_ZTM_URL, bytes: 27_650_016, sha256: 'fccfa172ab5d687e617d62cbb7154d36ef2bc0394cba97ef4bb2abec7c92df93' },
  { url: `${TTS_MODELS_URL}/g2p/g2p.bin`, bytes: 13_453_312, sha256: '33182b3f988e03b37b5553f1fd25f6992d57d0e7c1777a868c2755e42168a15e' },
  { url: `${TTS_MODELS_URL}/g2p/g2p.json`, bytes: 55_408, sha256: '9354f73eaf3cd7161035a057a60294eb3c4bf03cab0c7532db3cdd3a6c3da454' },
  { url: TTS_CPU_WASM_URL, bytes: 61_165, sha256: '6df8e16fa52fbdda52805a06f905189dc77d5c066e1651e71f0a6d33e4d4c6d5' },
];
export const TTS_TOTAL_BYTES = TTS_ASSETS.reduce((n, a) => n + a.bytes, 0);
