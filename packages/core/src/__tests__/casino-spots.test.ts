/** カジノのマス (InteriorMap.casino)・なまえのふだ の名前 (D-CASINO-001 PR2)。 */
import { afterEach, describe, expect, it } from 'vitest';
import { allyNameIssue, BASE_PALETTE, casinoSpotAt, facilityAt, partyDefsOf, recruitById, setInteriors, worldOverlay, type InteriorMap } from '../index.js';

const F = BASE_PALETTE.indexOf('plains');
const room = (over: Partial<NonNullable<InteriorMap['casino']>> = {}): InteriorMap => {
  const t = worldOverlay().towns[0]!;
  return { id: 'c', name: 'カジノ', size: 8, tiles: new Uint8Array(64).fill(F), casino: { town: { x: t.x, y: t.y }, exchange: { x: 1, y: 1 }, prize: { x: 2, y: 1 }, games: [{ x: 3, y: 3, game: 'race' }], ...over } };
};
afterEach(() => setInteriors(null, null));

describe('InteriorMap.casino', () => {
  it('両替・景品・台のマスを返し、facilityAt は カジノ (NPC を置かせない)', () => {
    setInteriors([room()], []);
    expect(casinoSpotAt('c', 1, 1)).toEqual({ kind: 'exchange' });
    expect(casinoSpotAt('c', 2, 1)).toEqual({ kind: 'prize' });
    expect(casinoSpotAt('c', 3, 3)).toEqual({ kind: 'game', game: 'race' });
    expect(casinoSpotAt('c', 4, 4)).toBeUndefined();
    expect(facilityAt('c', 3, 3)).toBe('カジノ');
  });
  it('マップの外・重なり・知らないゲーム・無い街は保存で弾く', () => {
    expect(() => setInteriors([room({ prize: { x: 9, y: 1 } })], [])).toThrow(/景品がマップの外/);
    expect(() => setInteriors([room({ prize: { x: 1, y: 1 } })], [])).toThrow(/重なる/);
    expect(() => setInteriors([room({ games: [{ x: 3, y: 3, game: 'poker' as 'race' }] })], [])).toThrow(/ゲームが不正/);
    expect(() => setInteriors([room({ town: { x: -5, y: -5 } })], [])).toThrow(/街が存在しない/);
  });
});

describe('なまえのふだ の名前', () => {
  it('1〜10 字・制御文字なし・{c: なし・今と同じは不可 (前後の空白は落とす)', () => {
    expect(allyNameIssue(' ソラ ', 'カイト')).toBeNull();
    expect(allyNameIssue('あいうえおかきくけこ', 'x')).toBeNull();
    expect(allyNameIssue('あいうえおかきくけこさ', 'x')).toMatch(/1〜10/);
    expect(allyNameIssue('', 'x')).toMatch(/1〜10/);
    expect(allyNameIssue('a\tb', 'x')).toMatch(/つかえない/);
    expect(allyNameIssue('{c:hero}', 'x')).toMatch(/つかえない/);
    expect(allyNameIssue('カイト', 'カイト')).toMatch(/おなじ/);
    expect(allyNameIssue(3, 'x')).toMatch(/ない/);
  });
  it('partyDefsOf は付けた名前を使う (生成の仲間・なじみ)', () => {
    const party = { ids: ['g-1'], members: [{ id: 'g-1', name: 'ミオ', archetype: 'miko' as const, xp: 0, star: 1 as const, minLevel: 1, line: 'よろしく。' }], names: { 'g-1': 'ソラ' } };
    expect(partyDefsOf(party, recruitById, 1)[0]!.name).toBe('ソラ');
  });
});
