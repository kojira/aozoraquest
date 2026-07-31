/**
 * 管理エディタのモバイル対応 (#617)。**レイアウトを共有クラスに寄せたことを固定する** —
 * インラインで 2 カラム grid を書くと、狭い画面で右カラムが画面外へ出て入力もラベルも
 * 切れる (実機で操作不能になった)。新しいエディタで同じ崩れを持ち込まないよう検出する。
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
/** ダッシュボード (カード並べ) とマップエディタ (専用レイアウト) は対象外。 */
const EDITORS = readdirSync(DIR)
  .filter((f) => f.startsWith('admin-') && f.endsWith('.tsx'))
  .filter((f) => !['admin-dashboard.tsx', 'admin-map.tsx'].includes(f));

describe('管理エディタのレイアウト', () => {
  it('対象のエディタを拾えている', () => {
    expect(EDITORS.length).toBeGreaterThanOrEqual(6);
  });

  for (const f of EDITORS) {
    const src = readFileSync(join(DIR, f), 'utf8');

    it(`${f}: ルートに admin-page が付いている (入力が枠を超えない)`, () => {
      expect(src).toContain('className="admin-page"');
    });

    it(`${f}: 2 カラムをインラインの gridTemplateColumns で組んでいない`, () => {
      // 共有クラス (狭い画面で 1 カラムに畳む) を使うこと。
      // repeat(auto-fill, ...) は自動で折り返すので許容する。
      const inline = src.match(/gridTemplateColumns: '([^']*)'/g) ?? [];
      const twoCol = inline.filter((m) => !m.includes('repeat('));
      expect(twoCol, `${f} は admin-cols を使う`).toEqual([]);
    });
  }
});
