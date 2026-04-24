/**
 * ブラウザ端末の「推論しんどい寄り」判定。
 * - モバイル (iOS/Android) はスペック幅広いが概ね低
 * - navigator.deviceMemory ≤ 4 も候補 (Safari は値を返さないので補助指標)
 * - WebGPU 非対応は fallback で WASM になるためここでは見ない
 */
export function isLowEndDevice(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  const isMobile = /iPhone|iPod|iPad|Android.*Mobile|Mobile Safari/.test(ua);
  if (isMobile) return true;
  const memRaw = (navigator as unknown as { deviceMemory?: number }).deviceMemory;
  if (typeof memRaw === 'number' && memRaw <= 4) return true;
  return false;
}

/**
 * iOS (iPhone / iPad) Safari かどうか。iOS の WebGPU は model を 2 回続けて
 * ロードすると GPU メモリが解放されず OOM クラッシュする問題があり、ここだけ
 * 特別扱いが必要 (Android Chrome の WebGPU は問題ない)。
 */
export function isIosSafari(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  if (/iPhone|iPod|iPad/.test(ua)) return true;
  // iPadOS 13+ は desktop 扱い ("Macintosh" + touch) になるので補助判定
  const isTouchMac = ua.includes('Macintosh') && typeof (navigator as Navigator & { maxTouchPoints?: number }).maxTouchPoints === 'number' && (navigator as Navigator & { maxTouchPoints?: number }).maxTouchPoints! > 1;
  return isTouchMac;
}
