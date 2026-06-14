/**
 * 表示幅の概算。U+0020〜U+00FF を 1、それ以外を 2 と数える。
 * 半角カナ (U+FF61〜) も 2 に丸めるが、折り返し防止 (= 早めに畳む) という
 * 用途では安全側なので許容する。サロゲートは for...of のコードポイント反復で
 * 1 文字 = 2 に収まる (絵文字が幅 4+ に膨らまない)。
 *
 * タイムラインで「名前が長いと @handle を畳む」判定などに使う。
 */
export function displayWidth(s: string): number {
  let w = 0;
  for (const ch of s) w += /[ -ÿ]/.test(ch) ? 1 : 2;
  return w;
}
