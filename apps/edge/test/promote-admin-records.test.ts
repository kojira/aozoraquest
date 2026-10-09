/**
 * scripts/promote-admin-records.mjs (D-MONSTER-001): dev → 本番の monsters / monsterArt 昇格。
 * dry-run の判断だけを検査する (書き込みは行わない)。
 */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error -- 型定義の無い Node スクリプト
import { ADMIN_DID, assertAdminDid, assertProdTarget, parseArgs, planFor, restorePlan, writeBackup } from '../../../scripts/promote-admin-records.mjs';

describe('scripts/promote-admin-records.mjs', () => {
  it('書き先は app.aozoraquest.world.(monsters|monsterArt) だけ', () => {
    expect(() => assertProdTarget('app.aozoraquest.world.monsters')).not.toThrow();
    expect(() => assertProdTarget('app.aozoraquest.world.monsterArt')).not.toThrow();
    for (const c of ['app.aozoraquest.dev.world.monsters', 'app.aozoraquest.world.npcs', 'app.aozoraquest.config.flags']) expect(() => assertProdTarget(c)).toThrow(/許可/);
  });

  it('ログイン DID が管理者でなければ止める', () => {
    expect(() => assertAdminDid(ADMIN_DID)).not.toThrow();
    expect(() => assertAdminDid('did:plc:someone')).toThrow(/管理者/);
  });

  it('既定は dry-run。--backup-dir は必須、name は monsters / monsterArt だけ', () => {
    expect(parseArgs(['monsters', 'monsterArt', '--backup-dir', '/tmp/b'])).toMatchObject({ execute: false, names: ['monsters', 'monsterArt'] });
    expect(() => parseArgs(['monsters'])).toThrow(/backup-dir/);
    expect(() => parseArgs(['npcs', '--backup-dir', '/tmp/b'])).toThrow(/対象外/);
  });

  it('本番が無ければ swapRecord=null (新規)、あれば既存 cid で CAS し、既存値を退避する', () => {
    const dev = { cid: 'dev1', value: { monsters: [{ id: 'a' }], $type: 'app.aozoraquest.dev.world.monsters' } };
    const fresh = planFor('monsters', dev, null);
    expect(fresh).toMatchObject({ collection: 'app.aozoraquest.world.monsters', swapRecord: null, backup: null });
    expect(fresh.record.$type).toBe('app.aozoraquest.world.monsters');
    const prod = { cid: 'prod1', value: { monsters: [] } };
    const over = planFor('monsters', dev, prod);
    expect(over.swapRecord).toBe('prod1');
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
    writeFileSync(bad, JSON.stringify({ name: 'npcs', collection: 'app.aozoraquest.world.npcs', cid: 'x', value: {} }));
    expect(() => restorePlan(bad, null)).toThrow();
  });
});
