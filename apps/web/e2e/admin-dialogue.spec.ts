import { test, expect } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { starterTownNpcs } from '@aozoraquest/core';
import { readFileSync } from 'node:fs';
const DIALOGUE_FIXTURE = JSON.parse(readFileSync(path.join(process.cwd(), '../../packages/core/src/__tests__/fixtures/dialogue.json'), 'utf8'));

/** D-DIALOGUE-006: 会話の 1 行を編集し、演出を足して保存すると、PUT の中身に反映される。読めなければ保存できない。 */
let vite: ViteDevServer;
const URL = 'http://127.0.0.1:4277/e2e/fixtures/admin-dialogue.html';
const DIALOGUE = 'app.aozoraquest.dev.world.dialogue';
test.beforeAll(async () => {
  vite = await createServer({ configFile: false, root: process.cwd(), plugins: [react()],
    resolve: { alias: { '@': path.join(process.cwd(), 'src') } },
    define: { 'import.meta.env.VITE_NSID_ENV': JSON.stringify('test'), 'import.meta.env.VITE_NSID_ROOT': JSON.stringify('app.aozoraquest'),
      'import.meta.env.VITE_ADMIN_DIDS': JSON.stringify('did:plc:villageadmin') },
    server: { host: '127.0.0.1', port: 4277, strictPort: true },
  });
  await vite.listen();
});
test.afterAll(async () => { await vite?.close(); });

type Put = { collection: string; record: { scenes: Array<{ id: string; lines: Array<{ text: string; effects?: unknown; npcId?: string }> }> } };
async function routePds(page: import('@playwright/test').Page, puts: Put[], failGet = false) {
  const records: Record<string, unknown> = { 'app.aozoraquest.dev.world.npcs': { npcs: starterTownNpcs() }, [DIALOGUE]: DIALOGUE_FIXTURE };
  await page.route('**/*', async (route) => {
    const url = new globalThis.URL(route.request().url());
    if (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') { await route.abort(); return; }
    if (url.pathname !== '/dialogue-fixture-pds') { await route.continue(); return; }
    const { op, params } = route.request().postDataJSON();
    if (op === 'put') { puts.push(params); await route.fulfill({ json: { uri: 'at://isolated/record', cid: 'saved' } }); }
    else if (op === 'get' && failGet) await route.fulfill({ status: 500, json: { error: 'InternalServerError' } });
    else if (op === 'get') { const r = records[params.collection]; await route.fulfill(r ? { json: { value: r, cid: 'c' } } : { status: 404, json: { error: 'RecordNotFound' } }); }
    else await route.fulfill({ json: { records: [] } });
  });
}

test('救護の 3 行目を書き換え、白い閃光を足して保存すると PUT に載る', async ({ page }) => {
  page.setDefaultTimeout(8_000);
  await page.setViewportSize({ width: 390, height: 844 });
  const puts: Put[] = [];
  await routePds(page, puts);
  await page.goto(URL);
  const list = page.getByRole('navigation', { name: '場面一覧' });
  await list.getByRole('button', { name: /救護/ }).click();
  await expect(page.getByLabel('1 行目の本文')).toHaveValue('[sad]……聞こえる？　大丈夫？');
  await page.getByLabel('3 行目の本文').fill('少女はやくそうを取り出した。');
  await page.getByRole('button', { name: '3 行目の演出を足す' }).click();
  await page.getByRole('combobox', { name: '3 行目の演出 1' }).selectOption({ label: '白い閃光' });
  await page.screenshot({ path: `${process.env.ADMIN_SHOTS ?? 'test-results'}/admin-dialogue-390.png`, fullPage: true });
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect.poll(() => puts.length).toBe(1);
  expect(puts[0]!.collection).toBe(DIALOGUE);
  const rescue = puts[0]!.record.scenes.find((s) => s.id === 'opening.rescue')!;
  expect(rescue.lines[2]).toEqual({ text: '少女はやくそうを取り出した。', effects: [{ kind: 'flash', color: 'white' }] });
  expect(rescue.lines[0]).toMatchObject({ npcId: 'futaba-bluesky', text: '[sad]……聞こえる？　大丈夫？' });
});

test('保存済みの会話を読めなければ保存できない', async ({ page }) => {
  page.setDefaultTimeout(8_000);
  const puts: Put[] = [];
  await routePds(page, puts, true);
  await page.goto(URL);
  await expect(page.getByText(/保存済みの会話を読み込めなかった/)).toBeVisible();
  await expect(page.getByRole('button', { name: '保存', exact: true })).toBeDisabled();
  expect(puts).toEqual([]);
});
