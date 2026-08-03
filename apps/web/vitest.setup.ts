import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

/**
 * DOM を使うテストの後片付けを**一括で**張る (#638 レビュー ★★)。
 *
 * `@testing-library/react` の自動 cleanup は `globals: true` のときしか登録されない。
 * 各テストの末尾で手で `cleanup()` を呼ぶ方式だと、**assertion が落ちた時点で
 * そこへ到達しない**ので前のテストの DOM が残り、次のテストが
 * `getAllByRole(...)[0]` で残骸を拾って誤った pass/fail を出す。
 *
 * node 環境のテストでは `cleanup()` は何もしない (document が無い場合は no-op)
 * ので、setupFiles を全体に張って問題ない。
 */
afterEach(() => {
  cleanup();
});
