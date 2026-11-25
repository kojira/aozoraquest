/** カジノのマス (InteriorMap.casino)・なまえのふだ の名前 (D-CASINO-001 PR2)。 */
import { afterEach, describe, expect, it } from 'vitest';
import { allyNameIssue, BASE_PALETTE, blockedSpotHint, casinoSpotAt, casinoSpots, tileArtFor, facilityAt, partyDefsOf, recruitById, setInteriors, worldOverlay, type InteriorMap } from '../index.js';

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
  it('床の印 (D-EARLY-002) に使う一覧: 両替・景品・台をデータから。カジノの無いマップは空', () => {
    setInteriors([room({ games: [{ x: 3, y: 3, game: 'race' }, { x: 4, y: 3, game: 'slots' }] }), { id: 'plain', name: 'へや', size: 8, tiles: new Uint8Array(64).fill(F) }], []);
    expect(casinoSpots('c')).toEqual([
      { x: 1, y: 1, spot: { kind: 'exchange' } },
      { x: 2, y: 1, spot: { kind: 'prize' } },
      { x: 3, y: 3, spot: { kind: 'game', game: 'race' } },
      { x: 4, y: 3, spot: { kind: 'game', game: 'slots' } },
    ]);
    for (const { x, y } of casinoSpots('c')) expect(casinoSpotAt('c', x, y)).toBeDefined();
    expect(casinoSpots('plain')).toEqual([]);
    expect(casinoSpots('nowhere')).toEqual([]);
    // 同梱の絵がある (/admin の絵の編集で上書きできるキー)。真ん中は透明 = 床が見える
    const art = tileArtFor('spot-mark')!;
    expect(art.size).toBe(16);
    expect(art.palette[art.pixels[8 * 16 + 8]!]).toBe('');
    expect(art.palette[art.pixels[1 * 16 + 1]!]).not.toBe('');
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

describe('blockedSpotHint (I-06: 台やカウンターにぶつかったら、前に立てばよいと知らせる)', () => {
  const W = BASE_PALETTE.indexOf('mountain'); // 歩けないマス (台・カウンター・壁)
  // y=0 は壁の列。台 (3,2) の前 (3,3) が台のマス、カウンター (1,0) の前 (1,1) が両替のマス。
  const map = (): InteriorMap => {
    const r = room();
    const tiles = new Uint8Array(64).fill(F);
    for (let x = 0; x < 8; x++) tiles[x] = W;
    tiles[2 * 8 + 3] = W; // 台
    tiles[7 * 8 + 7] = W; // ただの壁 (どのマスにもとなりあわない)
    return { ...r, tiles };
  };
  it('台にぶつかると「台の前に立つと遊べるよ。」、両替・景品のカウンターは「カウンターの前に立つと話せるよ。」', () => {
    setInteriors([map()], []);
    expect(blockedSpotHint('c', 3, 2)).toBe('台の前に立つと遊べるよ。');
    expect(blockedSpotHint('c', 1, 0)).toBe('カウンターの前に立つと話せるよ。');
    expect(blockedSpotHint('c', 2, 0)).toBe('カウンターの前に立つと話せるよ。');
  });
  it('ただの壁・歩けるマス・カジノの無いマップ・フィールドでは出さない (いつもの「そっちには進めない!」のまま)', () => {
    const { casino: _casino, ...plain } = map();
    setInteriors([map(), { ...plain, id: 'plain' }], []);
    expect(blockedSpotHint('c', 7, 7)).toBeUndefined();
    expect(blockedSpotHint('c', 5, 5)).toBeUndefined();
    expect(blockedSpotHint('c', 0, 0)).toBeUndefined();
    expect(blockedSpotHint('plain', 3, 2)).toBeUndefined();
    expect(blockedSpotHint('world', 3, 2)).toBeUndefined();
  });
});
