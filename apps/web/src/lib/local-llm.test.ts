import { beforeEach, describe, expect, it, vi } from 'vitest';

const nano = vi.hoisted(() => ({ available: false }));
const sara = vi.hoisted(() => ({ available: false }));
vi.mock('./gemini-nano-llm', () => ({
  GEMINI_NANO: { id: 'gemini-nano', label: 'Nano', availability: async () => nano.available, generate: async () => '' },
}));
vi.mock('./sarashina-llm', () => ({
  SARASHINA: { id: 'sarashina-0.5b', label: 'sarashina', purposes: ['translation'], availability: async () => sara.available, generate: async () => '' },
}));

import { pickLocalLLM, resetLocalLLMChoice } from './local-llm';

describe('pickLocalLLM', () => {
  beforeEach(() => { resetLocalLLMChoice(); nano.available = false; sara.available = false; });

  it('prefers Gemini Nano for translation when both are available (PC unchanged)', async () => {
    nano.available = true; sara.available = true;
    expect((await pickLocalLLM(false, 'translation'))?.id).toBe('gemini-nano');
  });

  it('uses sarashina for translation only when Nano is unavailable', async () => {
    sara.available = true;
    expect((await pickLocalLLM(false, 'translation'))?.id).toBe('sarashina-0.5b');
  });

  it('never picks sarashina for greeting / card text', async () => {
    sara.available = true;
    expect(await pickLocalLLM()).toBeNull();
  });

  it('re-evaluates after resetLocalLLMChoice (install finished during the ritual)', async () => {
    expect(await pickLocalLLM(false, 'translation')).toBeNull();
    sara.available = true;
    expect(await pickLocalLLM(false, 'translation')).toBeNull();
    resetLocalLLMChoice();
    expect((await pickLocalLLM(false, 'translation'))?.id).toBe('sarashina-0.5b');
  });
});
