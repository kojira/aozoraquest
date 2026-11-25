/** vitest 用の AudioContext の偽物 (D-SOUND-001)。作られた数・鳴らした音・音量を見られる。 */
import { vi } from 'vitest';

export interface FakeParam { value: number; cancelScheduledValues: () => void; setValueAtTime: (v: number) => void; linearRampToValueAtTime: (v: number) => void }
export interface FakeNode { kind: 'gain' | 'source'; connectedTo: FakeNode | 'destination' | null; gain?: FakeParam; buffer?: { length: number } | null; loop?: boolean; started?: boolean; stopped?: boolean; onended?: (() => void) | null }

export function installFakeAudioContext() {
  const made: FakeAudioContext[] = [];
  const param = (v: number): FakeParam => {
    const p: FakeParam = { value: v, cancelScheduledValues: () => undefined, setValueAtTime: (x) => { p.value = x; }, linearRampToValueAtTime: (x) => { p.value = x; } };
    return p;
  };
  class FakeAudioContext {
    state: 'suspended' | 'running' = 'suspended';
    sampleRate = 32000;
    currentTime = 0;
    destination = 'destination' as const;
    nodes: FakeNode[] = [];
    constructor() { made.push(this); }
    resume = vi.fn(async () => { this.state = 'running'; });
    suspend = vi.fn(async () => { this.state = 'suspended'; });
    createGain() {
      const n: FakeNode = { kind: 'gain', connectedTo: null, gain: param(1) };
      this.nodes.push(n);
      return { ...n, get gain() { return n.gain!; }, connect: (to: FakeNode | 'destination') => { n.connectedTo = (to as { __node?: FakeNode }).__node ?? to; }, __node: n };
    }
    createBuffer(_ch: number, length: number) { return { length, copyToChannel: () => undefined }; }
    createBufferSource() {
      const n: FakeNode = { kind: 'source', connectedTo: null, buffer: null, loop: false, started: false, stopped: false, onended: null };
      this.nodes.push(n);
      return {
        __node: n,
        set buffer(b: { length: number } | null) { n.buffer = b; }, get buffer() { return n.buffer ?? null; },
        set loop(v: boolean) { n.loop = v; }, get loop() { return !!n.loop; },
        loopStart: 0, loopEnd: 0,
        set onended(f: (() => void) | null) { n.onended = f; }, get onended() { return n.onended ?? null; },
        connect: (to: FakeNode | 'destination') => { n.connectedTo = (to as { __node?: FakeNode }).__node ?? to; },
        start: () => { n.started = true; },
        stop: () => { n.stopped = true; },
      };
    }
  }
  vi.stubGlobal('AudioContext', FakeAudioContext);
  const ctx = () => made[0];
  /** 鳴らした音 (無音 1 サンプルの解錠を除く)。 */
  const sounds = () => (ctx()?.nodes ?? []).filter((n) => n.kind === 'source' && n.started && (n.buffer?.length ?? 0) > 1);
  /** その音から destination までの音量の積 (0 なら聞こえない)。 */
  const audibleGain = (n: FakeNode): number => {
    let g = 1;
    for (let at = n.connectedTo; at && at !== 'destination'; at = at.connectedTo) g *= at.gain?.value ?? 1;
    return g;
  };
  return { made, ctx, sounds, audibleGain };
}
