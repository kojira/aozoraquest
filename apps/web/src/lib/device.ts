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
