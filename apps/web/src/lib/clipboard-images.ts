/**
 * ClipboardEvent の DataTransferItemList から画像ファイルだけを取り出す純粋関数
 * (テスト可能・描画非依存)。スクショ等を貼り付けたとき items に kind:'file' /
 * type:'image/*' のエントリが入る。テキストだけの貼り付けでは空配列を返すので、
 * 呼び出し側は「空なら preventDefault せず通常の貼り付けに委ねる」判断ができる。
 */
export function imageFilesFromClipboard(items: DataTransferItemList | null | undefined): File[] {
  if (!items) return [];
  const files: File[] = [];
  for (const item of items) {
    if (item.kind === 'file' && item.type.startsWith('image/')) {
      const f = item.getAsFile();
      if (f) files.push(f);
    }
  }
  return files;
}
