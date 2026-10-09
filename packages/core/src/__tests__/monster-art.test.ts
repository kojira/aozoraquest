import { afterEach, describe, expect, it } from 'vitest';
import { clearMonsterArts, MonsterArtError, monsterArtDataUri, monsterArtSvg, setMonsterArts } from '../index.js';

/**
 * **モンスターの絵は管理者 PDS の monsterArt レコードだけが正** (D-MONSTER-001 PR2)。
 * 差し込み口 (tint / shade / ifTint) と data URI、検証 (多重の防御) を固定する。
 */
const SLIME = '<g><path fill="{{tint|#57b7ee}}" stroke="{{ifTint:rgba(255,255,255,0.7)|#bfe6ff}}"/><rect fill="{{shade:0.86|#8fa08a}}"/></g>';
const WRAP = (body: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${body}</svg>`;

describe('monsterArtSvg', () => {
  afterEach(() => clearMonsterArts());

  it('tint 無しは既定色、slime のハイライトは else 側、shade は既定色を暗くする', () => {
    setMonsterArts([{ id: 'slime', svg: SLIME }]);
    expect(monsterArtSvg('slime', undefined)).toBe(WRAP('<g><path fill="#57b7ee" stroke="#bfe6ff"/><rect fill="#7b8a77"/></g>'));
  });

  it('#rrggbb の tint は 3 種の差し込み口すべてに入る', () => {
    setMonsterArts([{ id: 'slime', svg: SLIME }]);
    expect(monsterArtSvg('slime', '#e0574a')).toBe(WRAP('<g><path fill="#e0574a" stroke="rgba(255,255,255,0.7)"/><rect fill="#c14b40"/></g>'));
  });

  it('不正な tint (#fff / red / 属性を閉じる文字列) は既定色になる', () => {
    setMonsterArts([{ id: 'slime', svg: SLIME }]);
    const plain = monsterArtSvg('slime', undefined);
    for (const bad of ['#fff', 'red', '"><script>alert(1)</script>']) expect(monsterArtSvg('slime', bad)).toBe(plain);
  });

  it('絵の無い species は null (呼び出し側が「?」を出す)', () => {
    setMonsterArts([{ id: 'slime', svg: SLIME }]);
    expect(monsterArtSvg('dragon', undefined)).toBeNull();
  });
});

describe('setMonsterArts の検証', () => {
  afterEach(() => clearMonsterArts());
  const reject = (svg: string) => expect(() => setMonsterArts([{ id: 'x', svg }])).toThrow(MonsterArtError);

  it('知らない差し込み口・既定色が #rrggbb でない差し込み口は弾く', () => {
    reject('<g fill="{{color|#57b7ee}}"/>');
    reject('<g fill="{{tint|red}}"/>');
    reject('<g fill="{{shade:x|#57b7ee}}"/>');
    reject('<g fill="{{tint}}"/>');
  });

  it('16KB を超える絵は弾く (16KB ちょうどは通す)', () => {
    const pad = (n: number) => `<g>${' '.repeat(n - 7)}</g>`;
    expect(() => setMonsterArts([{ id: 'x', svg: pad(16 * 1024) }])).not.toThrow();
    reject(pad(16 * 1024 + 1));
  });

  it('<script / on*= / href= を含む絵は弾く', () => {
    reject('<g><script>alert(1)</script></g>');
    reject('<g onload="alert(1)"/>');
    reject('<g ONCLICK = "x"/>');
    reject('<image href="https://evil.example/x.png"/>');
    reject('<use xlink:href="#a"/>');
  });

  it('id の重複・空は弾き、壊れた 1 枚で全体を落とす (前の値を残す)', () => {
    setMonsterArts([{ id: 'slime', svg: SLIME }]);
    expect(() => setMonsterArts([{ id: 'a', svg: '<g/>' }, { id: 'a', svg: '<g/>' }])).toThrow(MonsterArtError);
    expect(() => setMonsterArts([{ id: '', svg: '<g/>' }])).toThrow(MonsterArtError);
    expect(() => setMonsterArts([{ id: 'ok', svg: '<g/>' }, { id: 'bad', svg: '<script>' }])).toThrow(MonsterArtError);
    expect(monsterArtSvg('slime', undefined)).not.toBeNull();
    expect(monsterArtSvg('ok', undefined)).toBeNull();
  });
});

describe('monsterArtDataUri', () => {
  afterEach(() => clearMonsterArts());

  it('URI に生の # / % / " を含まず、decodeURIComponent で元の SVG に戻る', () => {
    setMonsterArts([{ id: 'slime', svg: '<g><text>100%</text></g>' + SLIME }]);
    const uri = monsterArtDataUri('slime', '#e0574a')!;
    const prefix = 'data:image/svg+xml;charset=utf-8,';
    expect(uri.startsWith(prefix)).toBe(true);
    const body = uri.slice(prefix.length);
    expect(body).not.toMatch(/[#"]/);
    expect(body.replace(/%[0-9A-F]{2}/g, '')).not.toContain('%');
    expect(decodeURIComponent(body)).toBe(monsterArtSvg('slime', '#e0574a'));
  });

  it('絵が無ければ null', () => {
    expect(monsterArtDataUri('slime', undefined)).toBeNull();
  });
});
