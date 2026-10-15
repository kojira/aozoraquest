/**
 * WebGPU の GPUBufferUsage / GPUMapMode のビット値 (仕様で固定)。
 * TypeScript 7 の lib.dom は型だけを持ちグローバル定数を宣言していないため、ここで定義する。
 */
export const BUFFER_USAGE = {
  MAP_READ: 0x0001,
  COPY_SRC: 0x0004,
  COPY_DST: 0x0008,
  UNIFORM: 0x0040,
  STORAGE: 0x0080,
} as const;

export const MAP_MODE_READ = 0x0001;
