import { test, expect } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { BASE_PARTS, encodeWorldMap, encodeTileArt, emptyTileArt, inspectNpcImage, worldOverlay, type NpcDef } from '@aozoraquest/core';
import { png, imageFixture, cidFor } from '../../../packages/core/src/__tests__/helpers/npc-images';

let vite: ViteDevServer;
const URL = 'http://127.0.0.1:4276/e2e/fixtures/npc-image-upload.html';
test.beforeAll(async () => {
  vite = await createServer({ configFile: false, root: process.cwd(), plugins: [react()], resolve: { alias: { '@': path.join(process.cwd(), 'src') } },
    define: { 'import.meta.env.VITE_NSID_ENV': JSON.stringify('test'), 'import.meta.env.VITE_NSID_ROOT': JSON.stringify('app.aozoraquest'),
      'import.meta.env.VITE_ADMIN_DIDS': JSON.stringify('did:plc:npcadmin,did:plc:npcsecondary'), 'import.meta.env.VITE_EDGE_URL': JSON.stringify('/npc-upload-api'), 'import.meta.env.VITE_EDGE_DID': JSON.stringify('did:web:fixture.invalid') },
    server: { host: '127.0.0.1', port: 4276, strictPort: true },
  }); await vite.listen();
});
test.afterAll(async () => { await vite?.close(); });
for (const spriteFormat of ['png', 'webp'] as const) test(`NPC ${spriteFormat} sprite + other portrait: select, save/retry/reload, viewer/dialogue`, async ({ browser }) => {
  test.setTimeout(120_000);
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
  const page = await context.newPage(); page.setDefaultTimeout(8000);
  const errors: string[] = []; page.on('pageerror', (e) => errors.push(e.message));
  const spawn = worldOverlay().spawn;
  const art = emptyTileArt(); art.palette.push('#ee20bc'); art.pixels.fill(1);
  const initial: NpcDef[] = [
    { id: 'one', name: '案内人', spritePreset: 'bluesky', x: 11, y: 10, lines: ['これは会話イラストの表示確認です。地図を巡り、各地の人に話しかけてみましょう。'] },
    { id: 'two', name: 'となりの人', spritePreset: 'old-man', x: 13, y: 10, lines: ['やあ'] },
  ];
  const npcCollection = 'app.aozoraquest.world.npcs';
  const records: Record<string, unknown> = {
    'app.aozoraquest.world.map': { size: 1024, gz: Buffer.from(await encodeWorldMap(new Uint8Array(1024 ** 2))).toString('base64'), parts: BASE_PARTS },
    [npcCollection]: { npcs: structuredClone(initial) },
    'app.aozoraquest.world.tileArt': { arts: { 'npc:one': encodeTileArt(art) } },
    'app.aozoraquest.test.analysis': { archetype: 'warrior', rpgStats: { atk: 40, def: 15, agi: 15, int: 15, luk: 15 } },
    'app.aozoraquest.test.world': { x: 10, y: 10, gotStarterFeather: true, regions: [spawn.region], visitedTowns: [], hp: null, mp: null },
  };
  const blobs = new Map<string, Buffer>(); let uploads = 0, npcPuts = 0, failSave = false, failUpload = false, failImage = false;
  const imageRequests: string[] = [];
  await page.route('**/*', async (route) => {
    const u = new globalThis.URL(route.request().url());
    if (u.hostname !== '127.0.0.1' && u.hostname !== 'localhost') return route.abort();
    if (u.pathname === '/npc-upload-blob') {
      uploads++;
      if (failUpload) return route.fulfill({ status: 503, json: { error: 'Unavailable' } });
      const bytes = route.request().postDataBuffer()!;
      const info = inspectNpcImage(bytes, 'portrait');
      expect(info.mimeType).toBe('image/webp');
      const cid = cidFor(bytes); blobs.set(cid, bytes);
      return route.fulfill({ json: { blob: { $type: 'blob', ref: { $link: cid }, mimeType: info.mimeType, size: bytes.length } } });
    }
    if (u.pathname === '/npc-upload-pds') {
      const { op, params } = route.request().postDataJSON();
      if (op === 'get') {
        const record = records[params.collection];
        return route.fulfill({ status: record ? 200 : 404, json: record ? { value: record, cid: 'fixture-cid' } : { error: 'RecordNotFound' } });
      }
      if (op === 'put') {
        if (params.collection === npcCollection) { npcPuts++; if (failSave) return route.fulfill({ status: 503, json: { error: 'Unavailable' } }); }
        records[params.collection] = params.record;
        return route.fulfill({ json: { uri: 'at://isolated/record' } });
      }
      return route.fulfill({ json: { records: [] } });
    }
    if (u.pathname.endsWith('/api/npc-image')) {
      imageRequests.push(u.search);
      const npc = (records[npcCollection] as { npcs: NpcDef[] }).npcs.find((n) => n.id === u.searchParams.get('npcId'));
      const kind = u.searchParams.get('kind') === 'sprite' ? 'sprite' : 'portrait';
      const image = npc?.[kind === 'sprite' ? 'spriteImage' : 'portraitImage'];
      const bytes = image && image.blob.ref.$link === u.searchParams.get('cid') ? blobs.get(image.blob.ref.$link) : undefined;
      if (!bytes || failImage) return route.fulfill({ status: 404, body: 'not found' });
      await inspectNpcImage(bytes, kind);
      return route.fulfill({ contentType: image!.blob.mimeType, body: bytes, headers: { 'cache-control': 'no-store' } });
    }
    if (u.pathname.startsWith('/npc-upload-api/')) {
      if (u.pathname.endsWith('/me/state')) return route.fulfill({ json: { initialized: false, state: { did: 'did:plc:npcviewer', power: 5, playerXp: 0, jobXp: {}, materials: {}, gear: [], x: 10, y: 10, xpEpoch: 1, version: 1, updatedAt: '', flags: ['futaba_arrived'] } } });
      return route.fulfill({ status: 503, json: { error: 'NoGameWrites' } });
    }
    return route.continue();
  });
  const portraitFormat = spriteFormat === 'png' ? 'webp' : 'png';
  const sprite = { name: `walking.${spriteFormat}`, mimeType: `image/${spriteFormat}`, buffer: imageFixture(`64x32.${spriteFormat}`) };
  const portrait = { name: `portrait.${portraitFormat}`, mimeType: `image/${portraitFormat}`, buffer: imageFixture(`300x450.${portraitFormat}`) };
  const chooseNpc = async () => { await page.getByRole('button', { name: /案内人.*11,10/ }).click(); };
  const dismiss = async () => { for (let i = 0; i < 10 && await page.locator('.aq-dialogue-backdrop').count(); i++) await page.locator('.aq-dialogue-backdrop').click(); };
  try {
    await page.goto(URL); await chooseNpc();
    await expect(page.getByRole('group', { name: '標準の絵' }).getByRole('button')).toHaveCount(9);
    await page.getByLabel('マップ画像を選ぶ').setInputFiles({ name: 'bad.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg/>') });
    await expect(page.locator('.npc-editor > fieldset > [role=status]')).toContainText('PNG・WebP');
    await page.getByLabel('マップ画像を選ぶ').setInputFiles({ name: 'bad.png', mimeType: 'image/png', buffer: png(48, 32) });
    await expect(page.locator('.npc-editor > fieldset > [role=status]')).toContainText('16×16');
    await page.getByLabel('マップ画像を選ぶ').setInputFiles({ name: 'large.png', mimeType: 'image/png', buffer: Buffer.alloc(102401) });
    await expect(page.locator('.npc-editor > fieldset > [role=status]')).toContainText('100KiB');
    await page.getByLabel('マップ画像を選ぶ').setInputFiles({ name: 'broken.png', mimeType: 'image/png', buffer: png().subarray(0, 33) });
    await expect(page.locator('.npc-editor > fieldset > [role=status]')).toContainText('画像を');
    for (const extension of ['png', 'webp']) {
      await page.getByLabel('マップ画像を選ぶ').setInputFiles({ name: `animated.${extension}`, mimeType: `image/${extension}`, buffer: imageFixture(`animated.${extension}`) });
      await expect(page.locator('.npc-editor > fieldset > [role=status]')).toContainText('ファイル内アニメ');
    }
    await page.getByLabel('マップ画像を選ぶ').setInputFiles(sprite);
    await expect(page.locator('.npc-editor > fieldset > [role=status]')).toContainText('まだ送信');
    await page.getByLabel('会話イラストを選ぶ').setInputFiles(portrait);
    await expect(page.locator('.npc-editor > fieldset > [role=status]')).toContainText('まだ送信');
    // Decode the actual local preview in the browser: transparent corner and opaque artwork survive.
    const alpha = await page.getByAltText('会話イラストプレビュー').evaluate(async (element) => {
      const img = element as HTMLImageElement; await img.decode();
      const canvas = document.createElement('canvas'); canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d')!; ctx.drawImage(img, 0, 0);
      return [ctx.getImageData(0, 0, 1, 1).data[3], ctx.getImageData(150, 225, 1, 1).data[3]];
    });
    expect(alpha).toEqual([0, 255]);
    const spritePixelsMatch = await page.getByLabel('マップ画像プレビュー').locator('image').first().evaluate(async (element, original) => {
      const pixels = async (src: string) => {
        const img = new Image(); img.src = src; await img.decode();
        const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
        const ctx = c.getContext('2d')!; ctx.drawImage(img, 0, 0); return [...ctx.getImageData(0, 0, c.width, c.height).data];
      };
      return JSON.stringify(await pixels((element as SVGImageElement).getAttribute('href')!)) === JSON.stringify(await pixels(original));
    }, `data:${sprite.mimeType};base64,${sprite.buffer.toString('base64')}`);
    expect(spritePixelsMatch).toBe(true);
    expect(uploads).toBe(0); expect(npcPuts).toBe(0);
    await expect(page.getByLabel('マップ画像プレビュー').locator('[data-uploaded-sprite]')).toHaveCount(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await page.getByRole('region', { name: 'NPC画像アップロード' }).evaluate((el) => window.scrollBy(0, el.getBoundingClientRect().top - 50));
    await page.screenshot({ path: 'test-results/npc-image-upload-editor.png' });
    // Actual dialogue window, small landscape-sized viewport, full text and choice remain separate from art.
    await page.setViewportSize({ width: 568, height: 360 });
    await page.getByRole('button', { name: '会話をプレビュー' }).click();
    const displayedPortrait = page.getByAltText('案内人の会話イラスト');
    await expect(displayedPortrait).toBeVisible();
    const choice = page.getByRole('button', { name: 'プレビューを閉じる' }); await expect(choice).toBeVisible();
    const pb = (await displayedPortrait.boundingBox())!, cb = (await choice.boundingBox())!;
    expect(pb.y).toBeGreaterThanOrEqual(0); expect(pb.y + pb.height).toBeLessThan(cb.y); expect(cb.y + cb.height).toBeLessThanOrEqual(360);
    await page.screenshot({ path: 'test-results/npc-image-dialogue-small.png' });
    await choice.click(); await page.setViewportSize({ width: 390, height: 844 });
    page.once('dialog', (d) => d.accept()); await page.getByRole('button', { name: '未保存の変更を取り消す', exact: true }).click();
    await expect(page.getByLabel('マップ画像プレビュー').locator('[data-uploaded-sprite]')).toHaveCount(0);
    expect(uploads).toBe(0);
    await page.getByLabel('マップ画像を選ぶ').setInputFiles(sprite); await expect(page.locator('.npc-editor > fieldset > [role=status]')).toContainText('まだ送信');
    await page.getByLabel('会話イラストを選ぶ').setInputFiles(portrait); await expect(page.locator('.npc-editor > fieldset > [role=status]')).toContainText('まだ送信');
    failUpload = true; await page.getByRole('button', { name: '保存', exact: true }).click(); await expect(page.locator('.npc-editor > fieldset > [role=status]')).toContainText('保存できなかった');
    expect(npcPuts).toBe(0); failUpload = false;
    failSave = true; await page.getByRole('button', { name: '保存', exact: true }).click(); await expect(page.locator('.npc-editor > fieldset > [role=status]')).toContainText('保存できなかった');
    expect(uploads).toBe(3); expect((records[npcCollection] as { npcs: NpcDef[] }).npcs).toEqual(initial);
    failSave = false; await page.getByRole('button', { name: '保存', exact: true }).click(); await expect(page.locator('.npc-editor > fieldset > [role=status]')).toContainText('2 人を保存');
    expect(uploads).toBe(3); expect(npcPuts).toBe(2);
    const saved = structuredClone((records[npcCollection] as { npcs: NpcDef[] }).npcs);
    if (spriteFormat === 'png') expect(blobs.get(saved[0].spriteImage!.blob.ref.$link)!.includes(Buffer.from('public-test-metadata'))).toBe(false);
    if (portraitFormat === 'png') expect(blobs.get(saved[0].portraitImage!.blob.ref.$link)!.includes(Buffer.from('public-test-metadata'))).toBe(false);
    expect(saved[0].spriteImage!.blob.mimeType).toBe('image/webp');
    expect(saved[0].portraitImage!.blob.mimeType).toBe('image/webp');
    expect(saved[0].spriteImage!.width).toBe(64);
    expect(saved[0].portraitImage!.height).toBe(450);
    expect(saved[0].spriteImage!.blob.size).toBeLessThanOrEqual(102400);
    expect(saved[0].portraitImage!.blob.size).toBeLessThanOrEqual(1048576);
    if (spriteFormat === 'webp') expect(blobs.get(saved[0].spriteImage!.blob.ref.$link)).toEqual(sprite.buffer); // already tiny, no bloat
    if (portraitFormat === 'webp') expect(blobs.get(saved[0].portraitImage!.blob.ref.$link)).toEqual(portrait.buffer);
    expect(saved[1]).toEqual(initial[1]); expect(saved[0].spritePreset).toBe('bluesky');
    await page.reload(); await chooseNpc();
    await expect(page.getByAltText('会話イラストプレビュー')).toBeVisible();
    await expect(page.getByLabel('マップ画像プレビュー').locator('image').first()).toHaveAttribute('href', /npc-upload-api.*npc-image/);
    // Explicit preset selection and cancelling restores the saved upload without touching pixel art.
    await page.getByRole('group', { name: '標準の絵' }).getByRole('button', { name: 'おじいちゃん', exact: false }).click();
    await expect(page.getByLabel('マップ画像プレビュー').locator('[data-uploaded-sprite]')).toHaveCount(0);
    page.once('dialog', (d) => d.accept()); await page.getByRole('button', { name: '未保存の変更を取り消す', exact: true }).click();
    await expect(page.getByLabel('マップ画像プレビュー').locator('[data-uploaded-sprite]')).toHaveCount(1);
    await page.getByRole('button', { name: '手描きの絵を使う', exact: true }).click();
    await expect(page.getByLabel('マップ画像プレビュー').locator('rect[fill="#ee20bc"]')).toHaveCount(16);
    page.once('dialog', (d) => d.accept()); await page.getByRole('button', { name: '未保存の変更を取り消す', exact: true }).click();
    // Different session DID: saved refs load through the public NPC-only URL.
    await page.goto(`${URL}?game&viewer`); await expect(page.getByLabel('ワールドマップ')).toBeVisible(); await dismiss();
    await expect(page.getByLabel('ワールドマップ').locator('[data-uploaded-sprite]')).toHaveCount(1);
    await expect(page.getByLabel('ワールドマップ').locator('[data-preset="old-man"]')).toHaveCount(1);
    await page.keyboard.press('ArrowRight'); await expect(displayedPortrait).toBeVisible();
    await page.screenshot({ path: 'test-results/npc-image-world-dialogue.png' });
    await dismiss(); await expect(displayedPortrait).toHaveCount(0);
    expect(imageRequests.some((s) => s.includes('kind=portrait'))).toBe(true);
    failImage = true;
    await page.reload(); await expect(page.getByLabel('ワールドマップ')).toBeVisible(); await dismiss();
    await expect(page.getByLabel('ワールドマップ').locator('[data-preset="bluesky"]')).toHaveCount(1);
    await page.keyboard.press('ArrowRight'); await expect(page.getByRole('dialog', { name: '案内人のセリフ' })).toBeVisible();
    await expect(displayedPortrait).toHaveCount(0); await dismiss();
    await page.goto(`${URL}?secondary`); await chooseNpc();
    await expect(page.getByLabel('マップ画像を選ぶ')).toBeDisabled();
    await expect(page.getByText(/アップロードできるのは主管理者本人だけ/)).toBeVisible();
    await expect(page.getByRole('button', { name: '絵をかく', exact: true })).toBeEnabled();
    expect(errors).toEqual([]);
  } finally { await context.close(); }
});
