/**
 * scripts/promote-admin-records.mjs (D-MONSTER-001): dev → 本番の管理レコード昇格 (ワールド公開で 10 種)。
 * dry-run の判断だけを検査する (書き込みは行わない)。
 */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { assertNpcImage, inspectNpcImage, NPC_IMAGE_BYTES } from '@aozoraquest/core';
import { cidFor, imageFixture, png } from '../../../packages/core/src/__tests__/helpers/npc-images';
// @ts-expect-error -- 型定義の無い Node スクリプト
import { ADMIN_DID, assertAdminDid, assertProdTarget, blobCid, blobRefs, markProdImage, NPC_IMAGE_BYTES as SCRIPT_NPC_IMAGE_BYTES, parseArgs, planFor, PROMOTE_NAMES, restorePlan, withProdBlobs, writeBackup } from '../../../scripts/promote-admin-records.mjs';
// @ts-expect-error -- 型定義の無い Node スクリプト
import { NAMES } from '../../../scripts/admin-data.mjs';

describe('scripts/promote-admin-records.mjs', () => {
  it('対象は admin-data.mjs の NAMES と同じ 12 種 (map / tileArt / jobs は含めない。characters が先頭 D-CHAR-001)', () => {
    expect([...PROMOTE_NAMES].sort()).toEqual([...NAMES].sort());
    expect(PROMOTE_NAMES[0]).toBe('characters');
    for (const n of ['map', 'tileArt', 'jobs']) expect(PROMOTE_NAMES).not.toContain(n);
  });

  it('書き先は app.aozoraquest.world.(対象の名前) だけ', () => {
    for (const n of NAMES) expect(() => assertProdTarget(`app.aozoraquest.world.${n}`)).not.toThrow();
    for (const c of ['app.aozoraquest.dev.world.monsters', 'app.aozoraquest.world.map', 'app.aozoraquest.world.tileArt', 'app.aozoraquest.world.jobs', 'app.aozoraquest.config.flags']) expect(() => assertProdTarget(c)).toThrow(/許可/);
  });

  it('ログイン DID が管理者でなければ止める', () => {
    expect(() => assertAdminDid(ADMIN_DID)).not.toThrow();
    expect(() => assertAdminDid('did:plc:someone')).toThrow(/管理者/);
  });

  it('既定は dry-run。--backup-dir は必須、name は対象の 10 種だけ', () => {
    expect(parseArgs(['monsters', 'monsterArt', '--backup-dir', '/tmp/b'])).toMatchObject({ execute: false, names: ['monsters', 'monsterArt'] });
    expect(parseArgs(['items', 'npcs', 'story', '--backup-dir', '/tmp/b'])).toMatchObject({ execute: false, names: ['items', 'npcs', 'story'] });
    expect(() => parseArgs(['monsters'])).toThrow(/backup-dir/);
    for (const n of ['map', 'tileArt', 'jobs']) expect(() => parseArgs([n, '--backup-dir', '/tmp/b'])).toThrow(/対象外/);
  });

  it('要約の件数は admin-data.mjs と同じ一覧キーで数える (scenario→events, story→placedItems)', () => {
    const count = (name: string, value: object) => planFor(name, { cid: 'd', value }, null).summary;
    expect(count('items', { items: [1, 2, 3] })).toContain('(3 件)');
    expect(count('shops', { shops: [1] })).toContain('(1 件)');
    expect(count('npcs', { npcs: [1, 2] })).toContain('(2 件)');
    expect(count('interiors', { interiors: [1, 2], gates: [1] })).toContain('(2 件)');
    expect(count('quests', { quests: [1, 2, 3, 4] })).toContain('(4 件)');
    expect(count('scenario', { events: [1, 2, 3, 4, 5] })).toContain('(5 件)');
    expect(count('story', { battles: [1], placedItems: [1, 2, 3, 4] })).toContain('(4 件)');
  });

  it('本番が無ければ swapRecord=null (新規)、あれば既存 cid で CAS し、既存値を退避する', () => {
    const dev = { cid: 'dev1', value: { monsters: [{ id: 'a' }], $type: 'app.aozoraquest.dev.world.monsters' } };
    const fresh = planFor('monsters', dev, null);
    expect(fresh).toMatchObject({ collection: 'app.aozoraquest.world.monsters', swapRecord: null, backup: null });
    expect(fresh.record.$type).toBe('app.aozoraquest.world.monsters');
    const prod = { cid: 'prod1', value: { monsters: [] } };
    const over = planFor('monsters', dev, prod);
    expect(over.swapRecord).toBe('prod1');
    const dialogue = planFor('dialogue', { cid: 'dev2', value: { scenes: [{ id: 'inn.ask' }, { id: 'inn.thanks' }] } }, null);
    expect(dialogue).toMatchObject({ collection: 'app.aozoraquest.world.dialogue', summary: expect.stringContaining('(2 件)') });
    const dir = mkdtempSync(join(tmpdir(), 'promote-'));
    const file = writeBackup(dir, over.backup, new Date('2026-10-09T00:00:00Z'))!;
    expect(file).toMatch(/backup-monsters-2026-10-09T00-00-00-000Z\.json$/);
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ name: 'monsters', collection: 'app.aozoraquest.world.monsters', cid: 'prod1', value: prod.value });
  });

  it('--restore は退避ファイルを今の本番 cid で CAS して書き戻す (collection を検査)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'promote-'));
    const ok = join(dir, 'b.json');
    writeFileSync(ok, JSON.stringify({ name: 'monsterArt', collection: 'app.aozoraquest.world.monsterArt', cid: 'old', value: { arts: [] } }));
    expect(restorePlan(ok, { cid: 'now', value: {} })).toMatchObject({ collection: 'app.aozoraquest.world.monsterArt', swapRecord: 'now' });
    const bad = join(dir, 'bad.json');
    writeFileSync(bad, JSON.stringify({ name: 'map', collection: 'app.aozoraquest.world.map', cid: 'x', value: {} }));
    expect(() => restorePlan(bad, null)).toThrow();
  });
});

/**
 * D-ENV-002: 本番の world.* は dev の画像 (blob) を指さない (オーナー決定 2026-11-18)。
 * 昇格のとき blob を全部、本番の印つきのバイト列 (= 別の CID) で上げ直し、参照を書き換える。
 */
describe('promote: 画像は本番コピーにする (D-ENV-002)', () => {
  const webp = (name: string) => new Uint8Array(imageFixture(name));
  const ref = (bytes: Uint8Array, mimeType = 'image/webp') => ({ $type: 'blob', ref: { $link: cidFor(bytes) }, mimeType, size: bytes.length });
  const sprite = webp('64x32.webp'), portrait = webp('300x450.webp'), sad = webp('32x32.webp'), pngBytes = new Uint8Array(png(32, 32));
  const blobs = new Map([sprite, portrait, sad, pngBytes].map((b) => [cidFor(b), b]));
  const fetchBlob = async (cid: string) => blobs.get(cid)!;
  const dev = {
    npcs: [
      { id: 'a', spriteImage: { blob: ref(sprite), width: 64, height: 32 }, portraitImage: { blob: ref(portrait), width: 300, height: 450 }, expressionImages: { sad: { blob: ref(sad), width: 32, height: 32 } } },
      { id: 'b', spriteImage: { blob: ref(sprite), width: 64, height: 32 }, portraitImage: { blob: ref(pngBytes, 'image/png'), width: 32, height: 32 } },
    ],
  };

  it('core と同じ CID の計算・容量上限を使う', () => {
    for (const b of blobs.values()) expect(blobCid(b)).toBe(cidFor(b));
    expect(SCRIPT_NPC_IMAGE_BYTES).toEqual(NPC_IMAGE_BYTES);
  });

  it('本番のレコードは dev の CID を 1 つも指さず、同じ dev blob は同じ本番 blob 1 つになる', async () => {
    const { record, uploads } = await withProdBlobs(dev, fetchBlob);
    const devCids = new Set(blobRefs(dev).map((r: { cid: string }) => r.cid));
    const prodRefs = blobRefs(record) as Array<{ cid: string; size: number }>;
    expect(prodRefs).toHaveLength(5);
    for (const r of prodRefs) expect(devCids.has(r.cid)).toBe(false);
    expect(uploads).toHaveLength(4); // sprite は 2 人で 1 つ
    for (const u of uploads as Array<{ cid: string; bytes: Uint8Array }>) expect(blobCid(u.bytes)).toBe(u.cid);
    expect(record.npcs[0].spriteImage.blob.ref.$link).toBe(record.npcs[1].spriteImage.blob.ref.$link);
    expect(record.npcs[0].spriteImage.blob.size).toBe(sprite.length + 24);
    expect(dev.npcs[0].spriteImage.blob.ref.$link).toBe(cidFor(sprite)); // 元のレコードは変えない
  });

  it('決定的: 同じ dev blob を何度昇格しても同じ本番 CID (blob が増えない)', async () => {
    const a = await withProdBlobs(dev, fetchBlob), b = await withProdBlobs(dev, fetchBlob);
    expect(blobRefs(a.record)).toEqual(blobRefs(b.record));
    expect(markProdImage(sprite, 'image/webp')).toEqual(markProdImage(sprite, 'image/webp'));
  });

  it('印つきの画像も NPC 画像の規格を通る (形式・大きさ・CID・容量)', async () => {
    const { record, uploads } = await withProdBlobs(dev, fetchBlob);
    const bytesOf = new Map((uploads as Array<{ cid: string; bytes: Uint8Array }>).map((u) => [u.cid, u.bytes]));
    const check = (image: { blob: { ref: { $link: string } }; width: number; height: number }, kind: 'sprite' | 'portrait') => {
      assertNpcImage(image, kind);
      expect(inspectNpcImage(bytesOf.get(image.blob.ref.$link)!, kind)).toMatchObject({ width: image.width, height: image.height });
    };
    check(record.npcs[0].spriteImage, 'sprite');
    check(record.npcs[0].portraitImage, 'portrait');
    check(record.npcs[0].expressionImages.sad, 'portrait');
    check(record.npcs[1].portraitImage, 'portrait');
  });

  it('中身が CID と合わない blob・知らない形式・上限超えは止める', async () => {
    await expect(withProdBlobs(dev, async () => sad)).rejects.toThrow(/CID と合わない/);
    expect(() => markProdImage(sprite, 'image/gif')).toThrow(/対応していない/);
    // sprite の上限ちょうどの RIFF (中身は読み飛ばす chunk)。印を足すと上限を超える。
    const full = new Uint8Array(SCRIPT_NPC_IMAGE_BYTES.sprite), view = new DataView(full.buffer);
    full.set(new TextEncoder().encode('RIFF'), 0); view.setUint32(4, full.length - 8, true); full.set(new TextEncoder().encode('WEBPJUNK'), 8); view.setUint32(16, full.length - 20, true);
    const big = { npcs: [{ id: 'c', spriteImage: { blob: ref(full), width: 64, height: 32 } }] };
    await expect(withProdBlobs(big, async () => full)).rejects.toThrow(/上限/);
  });
});
