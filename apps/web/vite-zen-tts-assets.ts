/**
 * ZEN-TTS の G2P と CPU カーネル (D-TTS-001) を、依存の zen-tts パッケージから このアプリのオリジンへ出す。
 * ZEN-TTS ライセンス 1.0 は改変と単体の再配布を禁じるので、リポジトリにはコミットせず、HF などの単体の置き場にも
 * 置かない。ビルドでは dist の /zen-tts/1.2.0/ へそのまま写し、dev では同じパスで返す。
 * 写すファイルの byte 数と sha256 は tts-assets.ts の値と照合する (版を上げたら両方を直す)。
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import type { Plugin } from 'vite';
import { TTS_ASSETS } from './src/lib/tts/tts-assets';

const PKG_DIR = path.dirname(createRequire(import.meta.url).resolve('zen-tts/package.json'));
const PREFIX = '/zen-tts/1.2.0/';

/** 自分のオリジンから出すファイル: URL → パッケージ内のパス (models/g2p/*, cpu/tts-cpu.wasm)。 */
function originAssets(): Array<{ url: string; file: string; bytes: number; sha256: string }> {
  return TTS_ASSETS.filter((a) => a.url.startsWith(PREFIX)).map((a) => ({ ...a, file: path.join(PKG_DIR, a.url.slice(PREFIX.length)) }));
}

function readChecked(a: ReturnType<typeof originAssets>[number]): Buffer {
  const buf = readFileSync(a.file);
  const sha = createHash('sha256').update(buf).digest('hex');
  if (buf.length !== a.bytes || sha !== a.sha256) throw new Error(`zen-tts asset mismatch: ${a.url} (${buf.length} bytes, ${sha})`);
  return buf;
}

export function zenTtsAssetsPlugin(): Plugin {
  return {
    name: 'aozoraquest-zen-tts-assets',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const a = originAssets().find((x) => x.url === req.url?.split('?')[0]);
        if (!a) return next();
        res.setHeader('Content-Type', a.url.endsWith('.json') ? 'application/json' : a.url.endsWith('.wasm') ? 'application/wasm' : 'application/octet-stream');
        res.end(readChecked(a));
      });
    },
    generateBundle() {
      for (const a of originAssets()) this.emitFile({ type: 'asset', fileName: a.url.slice(1), source: readChecked(a) });
    },
  };
}
