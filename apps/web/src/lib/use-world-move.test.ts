/** 遭遇の開始 (beginEncounter)。始められない遭遇を無言で捨てない (敵が出ないのに何も起きない、を防ぐ)。 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Dispatch, SetStateAction } from 'react';
import { BASE_PALETTE, setInteriors, worldOverlay, type InteriorMap } from '@aozoraquest/core';
import { beginEncounter, blockedNotice, ENCOUNTER_FAILED_NOTICE } from './use-world-move';
import type { ServerEncounter } from './world-server';
import type { WorldBattle } from './use-world-battle';
import type { WipePhase } from '@/components/encounter-wipe';

const fighter = (name: string) => ({ name, hp: 30, maxHp: 30, mp: 5, maxMp: 5, atk: 1, def: 1, agi: 1, int: 1, luk: 1, vit: 0, guarding: false, parrying: false, charging: false, focus: 0, statuses: [], passives: [] });
/** edge の /api/world/move が返す encounter と同じ形 (seed を除いた state)。 */
const encounter = (): ServerEncounter => ({
  battleId: 'b1', monsterId: 'grass-slime', rewarded: true,
  state: { turn: 0, player: fighter('たびびと'), monster: fighter('くさいろスライム'), monsterId: 'grass-slime', outcome: 'ongoing', lastEvents: [] } as unknown as ServerEncounter['state'],
});

function harness() {
  const battleRef = { current: null as WorldBattle | null };
  const setBattle = vi.fn();
  const setWipe = vi.fn<Dispatch<SetStateAction<WipePhase | null>>>();
  const setNotice = vi.fn<Dispatch<SetStateAction<string | null>>>();
  return { battleRef, setBattle, setWipe, setNotice, begin: (e: ServerEncounter) => beginEncounter(e, battleRef, setBattle, setWipe, setNotice) };
}

describe('beginEncounter', () => {
  afterEach(() => vi.restoreAllMocks());

  it('サーバーの遭遇でワイプを始め、戦闘を置く', () => {
    const h = harness();
    h.begin(encounter());
    expect(h.battleRef.current?.battleId).toBe('b1');
    expect(h.setWipe).toHaveBeenCalledWith('cover');
    expect(h.setNotice).not.toHaveBeenCalled();
  });

  it('戦闘の state が壊れていたら、console.error と画面の一言を出し、戦闘もワイプも始めない', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const h = harness();
    const broken = { ...encounter(), state: { ...encounter().state, monster: undefined } } as unknown as ServerEncounter;
    h.begin(broken);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('[world] battle start failed'), expect.anything());
    expect(h.setNotice).toHaveBeenCalledWith(ENCOUNTER_FAILED_NOTICE);
    expect(h.battleRef.current).toBeNull();
    expect(h.setWipe).not.toHaveBeenCalled();
  });
});

describe('blockedNotice (I-06)', () => {
  afterEach(() => setInteriors(null, null));
  it('カジノの台にぶつかると前に立てばよいと出し、ただの壁は「そっちには進めない!」のまま', () => {
    const F = BASE_PALETTE.indexOf('plains'), W = BASE_PALETTE.indexOf('mountain');
    const tiles = new Uint8Array(64).fill(F);
    tiles[2 * 8 + 3] = W; tiles[7 * 8 + 7] = W;
    const t = worldOverlay().towns[0]!;
    const room: InteriorMap = { id: 'casino', name: 'カジノ', size: 8, tiles, casino: { town: { x: t.x, y: t.y }, exchange: { x: 1, y: 5 }, prize: { x: 2, y: 5 }, games: [{ x: 3, y: 3, game: 'slots' }] } };
    setInteriors([room], []);
    expect(blockedNotice('casino', 3, 2)).toBe('台の前に立つと遊べるよ。');
    expect(blockedNotice('casino', 7, 7)).toBe('そっちには進めない!');
    expect(blockedNotice(undefined, 3, 2)).toBe('そっちには進めない!');
  });
});
