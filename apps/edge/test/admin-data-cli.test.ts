/**
 * 管理データ CLI の保存先 (#716)。scripts/admin-data.mjs は dev 以外の保存先を返すエッジでは
 * 止まり、scripts/copy-admin-data-to-dev.mjs は本番 → dev の対応だけを作り本番を書かない。
 */
import { describe, expect, it } from 'vitest';
// @ts-expect-error -- 型定義の無い Node スクリプト
import { assertDevCollection, DEV_COLLECTION_PREFIX } from '../../../scripts/admin-data.mjs';
// @ts-expect-error -- 型定義の無い Node スクリプト
import { assertDevTarget, devCollectionOf, devRecord, SOURCE_COLLECTIONS } from '../../../scripts/copy-admin-data-to-dev.mjs';

describe('scripts/admin-data.mjs (#716)', () => {
  it('dev エッジの保存先 app.aozoraquest.dev.world.* だけを受け付ける', () => {
    expect(DEV_COLLECTION_PREFIX).toBe('app.aozoraquest.dev.world.');
    expect(() => assertDevCollection('app.aozoraquest.dev.world.npcs')).not.toThrow();
    expect(() => assertDevCollection(undefined)).not.toThrow(); // blob 応答は collection を持たない
    expect(() => assertDevCollection('app.aozoraquest.world.npcs')).toThrow(/dev でない/);
  });
});

describe('scripts/copy-admin-data-to-dev.mjs (#716)', () => {
  it('本番の全管理コレクションを同名の dev コレクションへ写す', () => {
    expect(SOURCE_COLLECTIONS).toHaveLength(14);
    expect(devCollectionOf('app.aozoraquest.world.npcs')).toBe('app.aozoraquest.dev.world.npcs');
    expect(devCollectionOf('app.aozoraquest.config.flags')).toBe('app.aozoraquest.dev.config.flags');
    for (const c of SOURCE_COLLECTIONS) expect(devCollectionOf(c).startsWith('app.aozoraquest.dev.')).toBe(true);
    expect(() => devCollectionOf('app.aozoraquest.directory')).toThrow();
  });

  it('本番への書き込みは拒否し、値は $type だけ dev に合わせて blob 参照を保つ', () => {
    expect(() => assertDevTarget('app.aozoraquest.world.npcs')).toThrow(/拒否/);
    const blob = { $type: 'blob', ref: { $link: 'bafkrei' }, mimeType: 'image/webp', size: 10 };
    const value = { $type: 'app.aozoraquest.world.npcs', npcs: [{ id: 'a', spriteImage: { blob, width: 32, height: 32 } }] };
    expect(devRecord(value, 'app.aozoraquest.dev.world.npcs')).toEqual({ ...value, $type: 'app.aozoraquest.dev.world.npcs' });
  });
});
