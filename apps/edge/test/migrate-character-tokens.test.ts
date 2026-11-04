/**
 * scripts/migrate-character-tokens.mjs (D-CHAR-001 §3・§8): 文中の人物名を {c:id} に置き換える移行。
 * 守ること:
 * - 候補はプレイヤーに見える欄だけから、(レコード・要素 id・欄・今の文) で出す
 * - 行の from が今の値と違えば、その行は止める (途中で誰かが編集した)
 * - 置き換えた後の表示 (トークンを名前にした文) が from と同じでなければ止める
 * - レコードごとに GET → 検証 → cid が同じかの再 GET → dry-run → PUT (CAS) → GET で比べる
 */
import { describe, expect, it } from 'vitest';
// @ts-expect-error -- 型定義の無い Node スクリプト
import { APPLY_ORDER, candidates, migrate, planRecord, resolveTokens } from '../../../scripts/migrate-character-tokens.mjs';

const NPCS = { npcs: [
  { id: 'futaba-bluesky', name: 'Bluesky', x: 1, y: 1, lines: ['わたしはBluesky', 'ほむらの街へ'], altLines: [{ flags: ['f'], lines: ['Twitterを探して'] }] },
  { id: 'kid', name: 'こども', x: 2, y: 2, lines: ['Blueskyへの投稿'] },
] };
const CHARS = [{ id: 'bluesky', name: 'Bluesky' }, { id: 'twitter', name: 'Twitter' }];

describe('candidates', () => {
  it('名前を含む欄を、レコード・要素 id・欄のパスで出す', () => {
    expect(candidates('npcs', NPCS, ['Bluesky', 'Twitter'])).toEqual([
      { record: 'npcs', id: 'futaba-bluesky', field: 'name', from: 'Bluesky' },
      { record: 'npcs', id: 'futaba-bluesky', field: 'lines[0]', from: 'わたしはBluesky' },
      { record: 'npcs', id: 'futaba-bluesky', field: 'altLines[0].lines[0]', from: 'Twitterを探して' },
      { record: 'npcs', id: 'kid', field: 'lines[0]', from: 'Blueskyへの投稿' },
    ]);
    const dialogue = { scenes: [{ id: 'opening.rescue', lines: [{ speaker: '？？？', text: 'Xが来る' }] }] };
    expect(candidates('dialogue', dialogue, ['X'])).toEqual([{ record: 'dialogue', id: 'opening.rescue', field: 'lines[0].text', from: 'Xが来る' }]);
  });
});

describe('planRecord', () => {
  it('合う行だけを置き換え、from が違う行・表示が変わる行・知らない id の行は止める', () => {
    const rows = [
      { record: 'npcs', id: 'futaba-bluesky', field: 'name', from: 'Bluesky', to: '{c:bluesky}' },
      { record: 'npcs', id: 'futaba-bluesky', field: 'lines[0]', from: 'わたしはBluesky!', to: 'わたしは{c:bluesky}!' },
      { record: 'npcs', id: 'futaba-bluesky', field: 'altLines[0].lines[0]', from: 'Twitterを探して', to: '{c:twitter}を さがして' },
      { record: 'npcs', id: 'kid', field: 'lines[0]', from: 'Blueskyへの投稿', to: '{c:bluesky-sns}への投稿' },
    ];
    const plan = planRecord('npcs', NPCS, rows, CHARS);
    expect(plan.applied.map((r: { field: string }) => r.field)).toEqual(['name']);
    expect(plan.stopped.map((s: { reason: string }) => s.reason)).toEqual([
      expect.stringContaining('今の値と違う'),
      expect.stringContaining('表示が元の文と違う'),
      expect.stringContaining('bluesky-sns'),
    ]);
    expect(plan.next.npcs[0].name).toBe('{c:bluesky}');
    expect(plan.next.npcs[0].lines[0]).toBe('わたしはBluesky');
    expect(NPCS.npcs[0]!.name).toBe('Bluesky'); // 元の値は変えない
  });

  it('characters は足すだけ。同じ id で名前が違えば止める', () => {
    const plan = planRecord('characters', { characters: [{ id: 'twitter', name: 'Twitter' }] }, [], [{ id: 'twitter', name: 'Twitter' }, { id: 'x', name: 'X' }]);
    expect(plan.next.characters).toEqual([{ id: 'twitter', name: 'Twitter' }, { id: 'x', name: 'X' }]);
    expect(() => planRecord('characters', { characters: [{ id: 'x', name: 'エックス' }] }, [], [{ id: 'x', name: 'X' }])).toThrow(/エックス/);
  });

  it('resolveTokens は表示と同じ置き換え (知らない id は id のまま)', () => {
    expect(resolveTokens('{c:bluesky}ちゃんと{c:nobody}', CHARS)).toBe('Blueskyちゃんとnobody');
  });
});

describe('migrate', () => {
  /** admin-data の get/put のふり。PUT の CAS と dry-run を再現する。 */
  function fakeEdge(records: Record<string, unknown>) {
    const store = new Map(Object.entries(records).map(([k, v]) => [k, { cid: `${k}-1`, value: structuredClone(v) as unknown }]));
    const calls: string[] = [];
    let bump = 1;
    const request = async (method: string, name: string, body?: { value: unknown; swapCid: string | null; dryRun?: boolean }) => {
      calls.push(`${method} ${name}${body?.dryRun ? ' dry' : ''}`);
      const cur = store.get(name) ?? { cid: null, value: null };
      if (method === 'GET') return { name, cid: cur.cid, value: structuredClone(cur.value) };
      if (body!.swapCid !== cur.cid) throw new Error('409 swap_conflict');
      if (body!.dryRun) return { ok: true, dryRun: true };
      store.set(name, { cid: `${name}-${++bump}`, value: { ...(body!.value as object), updatedAt: 'now' } });
      return { ok: true, cid: store.get(name)!.cid };
    };
    return { request, calls, store };
  }
  const MAP = {
    characters: CHARS,
    rows: [
      { record: 'npcs', id: 'futaba-bluesky', field: 'name', from: 'Bluesky', to: '{c:bluesky}' },
      { record: 'items', id: 'letter', field: 'name', from: 'Twitterの てがみ', to: '{c:twitter}の てがみ' },
    ],
  };
  const ITEMS = { items: [{ id: 'letter', name: 'Twitterの てがみ' }], equipment: [{ id: 'e' }] };

  it('characters → items → npcs の順に、GET → 再 GET → dry-run → PUT → GET で書く', async () => {
    const edge = fakeEdge({ npcs: NPCS, items: ITEMS });
    const report = await migrate({ map: MAP, request: edge.request, execute: true, log: () => {} });
    expect(APPLY_ORDER.slice(0, 3)).toEqual(['characters', 'items', 'monsters']);
    expect(edge.calls).toEqual([
      'GET characters', 'GET characters', 'PUT characters dry', 'PUT characters', 'GET characters',
      'GET items', 'GET items', 'PUT items dry', 'PUT items', 'GET items',
      'GET npcs', 'GET npcs', 'PUT npcs dry', 'PUT npcs', 'GET npcs',
    ]);
    expect((edge.store.get('npcs')!.value as typeof NPCS).npcs[0]!.name).toBe('{c:bluesky}');
    expect((edge.store.get('characters')!.value as { characters: unknown }).characters).toEqual(CHARS);
    expect(report.applied).toBe(2);
    expect(report.stopped).toEqual([]);
  });

  it('既定 (execute なし) は dry-run までで書かない', async () => {
    const edge = fakeEdge({ npcs: NPCS, items: ITEMS });
    await migrate({ map: MAP, request: edge.request, execute: false, log: () => {} });
    expect(edge.calls.filter((c) => c.startsWith('PUT') && !c.endsWith('dry'))).toEqual([]);
    expect((edge.store.get('npcs')!.value as typeof NPCS).npcs[0]!.name).toBe('Bluesky');
  });

  it('検証の間に cid が変わったレコードは書かずに止める', async () => {
    const edge = fakeEdge({ npcs: NPCS, items: ITEMS });
    let n = 0;
    const racing = async (method: string, name: string, body?: never) => {
      const res = await edge.request(method, name, body);
      if (method === 'GET' && name === 'items' && ++n === 2) return { ...res, cid: 'items-other' };
      return res;
    };
    await expect(migrate({ map: MAP, request: racing, execute: true, log: () => {} })).rejects.toThrow(/items.*cid/);
    expect((edge.store.get('items')!.value as typeof ITEMS).items[0]!.name).toBe('Twitterの てがみ');
  });
});
