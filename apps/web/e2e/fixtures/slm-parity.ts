// Test entry only: アプリの slm-wgsl (本物の SlmModel / weights) で LFM2.5 を読み、fixture の 4 プロンプトを greedy・罰 1.0 で EOS まで生成する。
import { SlmModel } from '../../src/lib/slm-wgsl/model';
import { fetchHeader, SLM_SOURCE } from '../../src/lib/slm-wgsl/weights';
import fixture from '../../src/lib/slm-wgsl/lfm-tokenizer.fixture.json';

const w = window as unknown as { parity?: { ids: number[]; ref: number[] }[]; parityError?: string };
(async () => {
  const opts = { allowNetwork: true };
  const header = await fetchHeader(SLM_SOURCE, opts);
  const model = await SlmModel.create(SLM_SOURCE, header, () => undefined, opts);
  const res: { ids: number[]; ref: number[] }[] = [];
  for (const c of fixture.cases) {
    const ids = await model.generate(c.ids, 400, { temperature: 0, topP: 1, repetitionPenalty: 1 }, () => true);
    res.push({ ids, ref: c.greedy });
  }
  model.dispose();
  w.parity = res;
})().catch((e: unknown) => { w.parityError = String((e as Error)?.message ?? e); });
