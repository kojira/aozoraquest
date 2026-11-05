import { beforeEach, describe, expect, it, vi } from 'vitest';

const nano = vi.hoisted(() => ({ available: false }));
const slm = vi.hoisted(() => ({ available: false }));
const sara = vi.hoisted(() => ({ available: false }));
vi.mock('./gemini-nano-llm', () => ({
  GEMINI_NANO: { id: 'gemini-nano', label: 'Nano', availability: async () => nano.available, generate: async () => '' },
}));
vi.mock('./slm-llm', () => ({
  SLM: { id: 'lfm2.5-1.2b-jp', label: 'ブルスコン', purposes: ['general', 'translation'], availability: async () => slm.available, generate: async () => '' },
}));
vi.mock('./sarashina-llm', () => ({
  SARASHINA: { id: 'sarashina-0.5b', label: 'sarashina', purposes: ['translation'], availability: async () => sara.available, generate: async () => '' },
}));

import { pickLocalLLM, resetLocalLLMChoice } from './local-llm';

describe('pickLocalLLM', () => {
  beforeEach(() => { resetLocalLLMChoice(); nano.available = false; slm.available = false; sara.available = false; });

  it('prefers Gemini Nano for translation when everything is available (PC unchanged)', async () => {
    nano.available = true; slm.available = true; sara.available = true;
    expect((await pickLocalLLM(false, 'translation'))?.id).toBe('gemini-nano');
  });

  it('translates with LFM once it is installed, even if sarashina is still cached', async () => {
    slm.available = true; sara.available = true;
    expect((await pickLocalLLM(false, 'translation'))?.id).toBe('lfm2.5-1.2b-jp');
  });

  it('keeps translating with an installed sarashina until LFM is installed', async () => {
    sara.available = true;
    expect((await pickLocalLLM(false, 'translation'))?.id).toBe('sarashina-0.5b');
  });

  it('card text (general): Nano if available, else LFM if installed, else null (sarashina never)', async () => {
    sara.available = true;
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
