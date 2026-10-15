import { afterEach, describe, expect, test, vi } from 'vitest';
import { CognitiveWgslModel } from './model';

/**
 * WebGPU の挙動のうち CognitiveWgslModel が依存する部分だけを真似る偽 device:
 *  - map 待ち/map 中の buffer に再度 mapAsync すると reject (実機の OperationError と同じ)
 *  - map 待ち/map 中の buffer へ copy する submit は validation error (uncaptured)
 *  - push/popErrorScope は scope 内で起きた error を返す
 */
function fakeGpu(opts: { scopeError?: GPUError } = {}) {
  const scopes: (GPUError | null)[] = [];
  let pendingScopeError = opts.scopeError ?? null;
  const device = {
    lost: new Promise(() => {}),
    onuncapturederror: null as ((ev: { error: GPUError }) => void) | null,
    queue: {
      writeBuffer: () => {},
      submit: (cmds: { copies: { mapState: string; raise: () => void }[] }[]) => {
        for (const c of cmds) for (const copy of c.copies) if (copy.mapState !== 'unmapped') copy.raise();
      },
    },
    createBuffer: ({ size, label }: { size: number; label: string }) => {
      const b = {
        size,
        label,
        mapState: 'unmapped',
        mapAsync: async () => {
          if (b.mapState !== 'unmapped') throw new Error('OperationError: buffer already mapped or pending');
          b.mapState = 'pending';
          await new Promise((r) => setTimeout(r, 5));
          b.mapState = 'mapped';
        },
        getMappedRange: (_o: number, n: number) => new ArrayBuffer(n),
        unmap: () => { b.mapState = 'unmapped'; },
        destroy: () => {},
      };
      return b;
    },
    createShaderModule: () => ({}),
    createComputePipeline: () => ({ getBindGroupLayout: () => ({}) }),
    createComputePipelineAsync: async () => ({ getBindGroupLayout: () => ({}) }),
    createBindGroup: () => ({}),
    createCommandEncoder: () => {
      const copies: { mapState: string; raise: () => void }[] = [];
      return {
        beginComputePass: () => ({ setPipeline: () => {}, setBindGroup: () => {}, dispatchWorkgroups: () => {}, end: () => {} }),
        copyBufferToBuffer: (_s: unknown, _so: number, dst: { mapState: string }) => {
          copies.push({
            get mapState() { return dst.mapState; },
            raise: () => device.onuncapturederror?.({ error: { message: 'copy into mapped buffer' } as GPUError }),
          });
        },
        finish: () => ({ copies }),
      };
    },
    pushErrorScope: () => { scopes.push(null); },
    popErrorScope: async () => {
      scopes.pop();
      const e = pendingScopeError;
      pendingScopeError = null;
      return e;
    },
    destroy: () => {},
  };
  return device;
}

/** model.ts が名前で引く全 tensor を 4 byte ずつ持つ .aqw。mean-pool (Ruri) は分類 head の tensor を持たない。 */
function tinyAqw(head?: 'mean-pool'): Uint8Array<ArrayBuffer> {
  const names = ['emb_q', 'emb_scale', 'emb_norm', 'final_norm'];
  if (!head) names.push('head_dense', 'head_norm', 'cls_w', 'cls_b');
  for (let l = 0; l < 10; l++) for (const n of ['attn_norm', 'wqkv', 'wo', 'mlp_norm', 'wi', 'wo2']) names.push(`l${l}.${n}`);
  const tensors = names.map((name, i) => ({ name, dtype: 'f32', shape: [1], offset: i * 4, bytes: 4 }));
  let json = JSON.stringify({ format: 'aqw1', config: head ? { head } : {}, tensors });
  json += ' '.repeat((4 - (json.length % 4)) % 4);
  const header = new TextEncoder().encode(json);
  const out = new Uint8Array(8 + header.length + names.length * 4);
  out.set(new TextEncoder().encode('AQW1'));
  new DataView(out.buffer).setUint32(4, header.length, true);
  out.set(header, 8);
  return out;
}

function stubGpu(device: ReturnType<typeof fakeGpu>, head?: 'mean-pool') {
  vi.stubGlobal('navigator', { gpu: { requestAdapter: async () => ({ requestDevice: async () => device }) } });
  vi.stubGlobal('caches', undefined);
  vi.stubGlobal('fetch', async () => new Response(tinyAqw(head)));
}

afterEach(() => vi.unstubAllGlobals());

describe('CognitiveWgslModel.run', () => {
  test('同時に呼んでも全ての呼び出しが結果を返す (readback buffer を順番に使う)', async () => {
    const device = fakeGpu();
    stubGpu(device);
    const model = await CognitiveWgslModel.create('https://example.test/model.aqw');
    const results = await Promise.all(Array.from({ length: 8 }, () => model.run([[1, 5, 2], [1, 2]])));
    expect(results).toHaveLength(8);
    for (const r of results) expect(r.map((x) => x.length)).toEqual([9, 9]);
  });

  test('head が mean-pool (Ruri) なら分類 head の tensor なしで作れ、系列ごとに 256 次元を返す', async () => {
    const device = fakeGpu();
    stubGpu(device, 'mean-pool');
    const model = await CognitiveWgslModel.create('https://example.test/ruri.aqw');
    expect(model.head).toBe('mean-pool');
    expect((await model.run([[1, 5, 2], [1, 2]])).map((x) => x.length)).toEqual([256, 256]);
  });

  test('device で捕捉されない GPU error が起きたら、以後の run は throw する', async () => {
    const device = fakeGpu();
    stubGpu(device);
    const model = await CognitiveWgslModel.create('https://example.test/model.aqw');
    device.onuncapturederror?.({ error: { message: 'out of memory' } as GPUError });
    expect(model.broken).toBe(true);
    await expect(model.run([[1, 2]])).rejects.toThrow(/out of memory/);
  });
});

describe('CognitiveWgslModel.create', () => {
  test('読み込み・確保・初回実行で GPU error が出たら throw する (一様な 1/9 を返さない)', async () => {
    const device = fakeGpu({ scopeError: { message: 'Out of memory' } as GPUError });
    stubGpu(device);
    await expect(CognitiveWgslModel.create('https://example.test/model.aqw')).rejects.toThrow(/Out of memory/);
  });
});
