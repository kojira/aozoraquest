import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

/**
 * 各 environment 用の client-metadata.json を build 時に生成する。
 * VITE_APP_URL に応じて client_id / redirect_uris を切り替える。
 *   - 本番: https://aozoraquest.app
 *   - dev: https://dev.aozoraquest.app
 *   - 未指定: 本番にフォールバック
 */
function clientMetadataPlugin(): Plugin {
  return {
    name: 'aozoraquest-client-metadata',
    apply: 'build',
    generateBundle() {
      const appUrl = (process.env.VITE_APP_URL || 'https://aozoraquest.app').replace(/\/$/, '');
      const metadata = {
        client_id: `${appUrl}/client-metadata.json`,
        client_name: 'Aozora Quest',
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
