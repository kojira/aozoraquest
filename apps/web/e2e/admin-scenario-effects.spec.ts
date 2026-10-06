import { test, expect } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

/** D-STORY-007: シナリオのお知らせに演出 (プリセット) を足して保存すると PUT body に effects が載る。 */
let vite: ViteDevServer;
const URL = 'http://127.0.0.1:4274/e2e/fixtures/admin-scenario.html';
const SCENARIO = 'app.aozoraquest.dev.world.scenario';
test.beforeAll(async () => {
  vite = await createServer({ configFile: false, root: process.cwd(), plugins: [react()],
    resolve: { alias: { '@': path.join(process.cwd(), 'src') } },
    define: { 'import.meta.env.VITE_NSID_ENV': JSON.stringify('test'), 'import.meta.env.VITE_NSID_ROOT': JSON.stringify('app.aozoraquest'),
      'import.meta.env.VITE_ADMIN_DIDS': JSON.stringify('did:plc:villageadmin') },
    server: { host: '127.0.0.1', port: 4274, strictPort: true },
  });
  await vite.listen();
});
test.afterAll(async () => { await vite?.close(); });

test('お知らせに「空が赤く染まる」を足して保存すると effects が保存される', async ({ page }) => {
  page.setDefaultTimeout(8_000);
  await page.setViewportSize({ width: 390, height: 844 });
  const puts: Array<{ collection: string; record: { events: Array<{ notice?: string; effects?: unknown }> } }> = [];
  await page.route('**/*', async (route) => {
    const url = new globalThis.URL(route.request().url());
    if (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') { await route.abort(); return; }
    if (url.pathname !== '/scenario-fixture-pds') { await route.continue(); return; }
    const { op, params } = route.request().postDataJSON();
    if (op === 'put') { puts.push(params); await route.fulfill({ json: { uri: 'at://isolated/record', cid: 'saved' } }); }
    else if (op === 'get') await route.fulfill({ status: 404, json: { error: 'RecordNotFound' } });
    else await route.fulfill({ json: { records: [] } });
  });
  await page.goto(URL);
  await page.getByRole('button', { name: '＋イベント', exact: true }).click();
  const addEffect = page.getByRole('button', { name: '＋演出', exact: true });
  await expect(addEffect).toBeDisabled();
  await page.getByPlaceholder(/東の橋が なおったらしい/).fill('そらが いっしゅん、あかく ひかった。');
  await addEffect.click();
  await expect(page.getByRole('combobox', { name: '演出 1' })).toHaveValue('6');
  await page.screenshot({ path: `${process.env.ADMIN_SHOTS ?? 'test-results'}/admin-scenario-effects-390.png` });
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect.poll(() => puts.length).toBe(1);
  expect(puts[0]!.collection).toBe(SCENARIO);
  expect(puts[0]!.record.events[0]).toMatchObject({ notice: 'そらが いっしゅん、あかく ひかった。', effects: [{ kind: 'tint', color: 'red' }] });
});
