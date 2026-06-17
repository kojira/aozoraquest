import { describe, it, expect } from 'vitest';
import { imageFilesFromClipboard } from './clipboard-images';

// DataTransferItem の最小フェイク (kind / type / getAsFile だけ使う)
function item(kind: string, type: string, file: File | null): DataTransferItem {
  return { kind, type, getAsFile: () => file } as unknown as DataTransferItem;
}
function list(items: DataTransferItem[]): DataTransferItemList {
  // for...of で回せれば十分なので配列を DataTransferItemList として渡す
  return items as unknown as DataTransferItemList;
}
const fakeFile = (name: string) => ({ name } as unknown as File);

describe('imageFilesFromClipboard', () => {
  it('画像ファイルだけを取り出す', () => {
    const png = fakeFile('shot.png');
    const files = imageFilesFromClipboard(list([
      item('string', 'text/plain', null),       // テキスト → 無視
      item('file', 'image/png', png),            // 画像 → 採用
      item('file', 'application/pdf', fakeFile('a.pdf')), // 非画像ファイル → 無視
    ]));
    expect(files).toEqual([png]);
  });

  it('複数画像をすべて取り出す', () => {
    const a = fakeFile('a.png'); const b = fakeFile('b.jpg');
    const files = imageFilesFromClipboard(list([
      item('file', 'image/png', a),
      item('file', 'image/jpeg', b),
    ]));
    expect(files).toEqual([a, b]);
  });

  it('kind が file でも getAsFile が null なら採用しない', () => {
    expect(imageFilesFromClipboard(list([item('file', 'image/png', null)]))).toEqual([]);
  });

  it('テキストのみ / null / undefined では空配列', () => {
    expect(imageFilesFromClipboard(list([item('string', 'text/plain', null)]))).toEqual([]);
    expect(imageFilesFromClipboard(null)).toEqual([]);
    expect(imageFilesFromClipboard(undefined)).toEqual([]);
  });
});
