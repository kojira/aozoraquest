import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DiagnosisResult } from '@aozoraquest/core';
import type { LocalLLM } from './local-llm';

/** generateCardText はプロンプト方式 (cardPrompt) で分ける: four-line は 4 行方式、3 回とも駄目なら fallback (CardTextError を出さない)。 */
const picked = vi.hoisted(() => ({ llm: null as LocalLLM | null }));
vi.mock('./local-llm', () => ({
  pickLocalLLM: async () => picked.llm,
  generateWithLocalLLM: async () => { throw new Error('two-stage path must not be used for four-line'); },
}));

import { generateCardText } from './flavor-text';

const sage = { archetype: 'sage' } as DiagnosisResult;

describe('generateCardText routing', () => {
  beforeEach(() => { picked.llm = null; });

  it('uses the 4-line prompt for a four-line backend and falls back after 3 bad outputs', async () => {
    let n = 0;
    picked.llm = { id: 'lfm2.5-1.2b-jp', label: 'x', cardPrompt: 'four-line', availability: async () => true, generate: async () => { n++; return 'だめ'; } };
    const c = await generateCardText(sage, 'common', { seed: 1 });
    expect(n).toBe(3);
    expect(c.source.kind).toBe('fallback');
  });

  it('falls back when no backend is available', async () => {
    expect((await generateCardText(sage, 'common', { seed: 1 })).source.kind).toBe('fallback');
  });
});
