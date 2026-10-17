/**
 * scripts/promote-admin-records.mjs (D-MONSTER-001): dev → 本番の管理レコード昇格 (ワールド公開で 10 種)。
 * dry-run の判断だけを検査する (書き込みは行わない)。
 */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error -- 型定義の無い Node スクリプト
import { ADMIN_DID, assertAdminDid, assertProdTarget, parseArgs, planFor, PROMOTE_NAMES, restorePlan, writeBackup } from '../../../scripts/promote-admin-records.mjs';
// @ts-expect-error -- 型定義の無い Node スクリプト
import { NAMES } from '../../../scripts/admin-data.mjs';

describe('scripts/promote-admin-records.mjs', () => {
  it('対象は admin-data.mjs の NAMES と同じ 10 種 (map / tileArt / jobs は含めない)', () => {
    expect([...PROMOTE_NAMES].sort()).toEqual([...NAMES].sort());
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
