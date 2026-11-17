import { beforeEach, describe, expect, it, vi } from 'vitest';

const nano = vi.hoisted(() => ({ available: false }));
const slm = vi.hoisted(() => ({ available: false }));
vi.mock('./gemini-nano-llm', () => ({
  GEMINI_NANO: { id: 'gemini-nano', label: 'Nano', availability: async () => nano.available, generate: async () => '' },
}));
vi.mock('./slm-llm', () => ({
  SLM: { id: 'lfm2.5-1.2b-jp', label: 'ブルスコン', purposes: ['general', 'translation'], availability: async () => slm.available, generate: async () => '' },
}));

import { BACKENDS, pickLocalLLM, resetLocalLLMChoice } from './local-llm';

describe('pickLocalLLM', () => {
  beforeEach(() => { resetLocalLLMChoice(); nano.available = false; slm.available = false; });

  it('prefers Gemini Nano for translation when everything is available (PC unchanged)', async () => {
    nano.available = true; slm.available = true;
    expect((await pickLocalLLM(false, 'translation'))?.id).toBe('gemini-nano');
  });

  it('translates with LFM once it is installed', async () => {
    slm.available = true;
    expect((await pickLocalLLM(false, 'translation'))?.id).toBe('lfm2.5-1.2b-jp');
  });

  it('backends are exactly Nano then LFM (sarashina removed, D-SLM-CARD-001 PR4)', async () => {
    expect(BACKENDS.map((b) => b.id)).toEqual(['gemini-nano', 'lfm2.5-1.2b-jp']);
    expect(await pickLocalLLM(false, 'translation')).toBeNull();
  });

  it('card text (general): Nano if available, else LFM if installed, else null', async () => {
    expect(await pickLocalLLM()).toBeNull();
    slm.available = true;
    expect((await pickLocalLLM(true))?.id).toBe('lfm2.5-1.2b-jp');
    nano.available = true;
    expect((await pickLocalLLM(true))?.id).toBe('gemini-nano');
  });

  it('re-evaluates after resetLocalLLMChoice (install finished during the ritual)', async () => {
    expect(await pickLocalLLM(false, 'translation')).toBeNull();
    slm.available = true;
    expect(await pickLocalLLM(false, 'translation')).toBeNull();
    resetLocalLLMChoice();
    expect((await pickLocalLLM(false, 'translation'))?.id).toBe('lfm2.5-1.2b-jp');
  });
});
