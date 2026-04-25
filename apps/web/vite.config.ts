import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

/**
 * 各 environment 用の client-metadata.json を build 時に生成する。
 * VITE_APP_URL に応じて client_id / redirect_uris を切り替える。
 * 未指定時は build を失敗させる (silent に prod URL に倒れて誤デプロイするのを防ぐ)。
 */
function clientMetadataPlugin(): Plugin {
  return {
    name: 'aozoraquest-client-metadata',
    apply: 'build',
    generateBundle() {
      const raw = process.env.VITE_APP_URL;
      if (!raw) {
        throw new Error(
          'VITE_APP_URL is required at build time (e.g. https://aozoraquest.app or https://dev.aozoraquest.app). ' +
            'Set it in the Cloudflare Workers Builds env vars per project.',
        );
      }
      // collections.ts が必要とする NSID prefix も build 時に明示必須。
      if (!process.env.VITE_NSID_ROOT) {
        throw new Error(
          'VITE_NSID_ROOT is required at build time (e.g. "app.aozoraquest"). ' +
            'Set it in the Cloudflare Workers Builds env vars per project.',
        );
      }
      const appUrl = raw.replace(/\/$/, '');
      const appName = process.env.VITE_APP_NAME || 'Aozora Quest';
      const metadata = {
        client_id: `${appUrl}/client-metadata.json`,
        client_name: appName,
        client_uri: appUrl,
        redirect_uris: [`${appUrl}/oauth/callback`],
        scope: 'atproto transition:generic',
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        application_type: 'web',
        dpop_bound_access_tokens: true,
        token_endpoint_auth_method: 'none',
      };
      this.emitFile({
        type: 'asset',
        fileName: 'client-metadata.json',
        source: JSON.stringify(metadata, null, 2) + '\n',
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), clientMetadataPlugin()],
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
  server: { port: 9999, strictPort: true },
  preview: { port: 9999 },
  build: {
    outDir: 'dist',
    target: 'es2022',
    sourcemap: true,
  },
});
