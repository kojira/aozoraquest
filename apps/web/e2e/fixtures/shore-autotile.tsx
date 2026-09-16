// Isolated transport only; editors, persistence codecs and World are the real components.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import type { Agent } from '@atproto/api';
import { BASE_PALETTE } from '@aozoraquest/core';
import { SessionContext } from '../../src/lib/session';
import { AdminInteriors } from '../../src/routes/admin-interiors';
import { AdminMap } from '../../src/routes/admin-map';
import { World } from '../../src/routes/world';
import { pixelTile, shoreTile } from '../../src/components/world-tiles';
import { shoreMaskAt } from '../../src/lib/shore-autotile';
import '../../src/styles.css';
async function call(op: string, params: unknown) {
  const response = await fetch('/shore-fixture-pds', { method: 'POST', body: JSON.stringify({ op, params }) });
  const data = await response.json();
  if (!response.ok) throw Object.assign(new Error(data.error), { error: data.error });
  return { data };
}
const agent = {
  assertDid: 'did:plc:shoreadmin', getProfile: async () => ({ data: { displayName: '管理者', handle: 'shore.invalid' } }),
  com: { atproto: { repo: {
    getRecord: (p: unknown) => call('get', p), putRecord: (p: unknown) => call('put', p), listRecords: (p: unknown) => call('list', p),
  }, server: { getServiceAuth: async () => ({ data: { token: 'isolated-token' } }) } } },
} as unknown as Agent;

const sample = [
  '00000044444444', '00000004444444', '00000000444444', '00000000044444',
  '00000000444444', '00000000004444', '00000000000444', '00000044444444',
  '00330044444044', '00333004444444', '00003004444444', '00000044444444',
  '00300004444444', '00030000444444',
];
function ArtGallery() {
  const terrainAt = (x: number, y: number) => BASE_PALETTE[Number(sample[y]?.[x] ?? 4)];
  const tileMap = (auto: boolean) => <svg width="448" height="448" viewBox="0 0 448 448">
    {sample.flatMap((row, y) => [...row].map((t, x) => <g key={`${x}-${y}`} transform={`translate(${x * 32},${y * 32})`}>
      {auto && ['3', '4'].includes(t) ? shoreTile(shoreMaskAt(x, y, terrainAt)) : pixelTile(BASE_PALETTE[Number(t)]!)}
    </g>))}
  </svg>;
  const examples: [string, number][] = [['水面', 255], ['上岸', 110], ['右岸', 205], ['下岸', 155], ['左岸', 55],
    ['丸角↖', 38], ['丸角↗', 76], ['丸角↘', 137], ['丸角↙', 19],
    ['入隅↖', 127], ['入隅↗', 239], ['入隅↘', 223], ['入隅↙', 191]];
  return <main style={{ position: 'relative', padding: 24, background: '#181f2e', color: 'white', width: 970 }}>
    <h1>岸辺パーツ · オリジナル16×16ドット絵</h1>
    <p>標準の海・池を塗るだけ。岬・入り江・細水路・1マス池・対角の池。</p>
    <div style={{ display: 'flex', gap: 24 }}><section><h2>従来</h2>{tileMap(false)}</section><section><h2>自動接続</h2>{tileMap(true)}</section></div>
    <h2>基本13分類（四隅の合成で47接続形）</h2>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>{examples.map(([label, mask]) => <div key={label} style={{ textAlign: 'center' }}>
      <svg width="96" height="96" viewBox="0 0 32 32">{shoreTile(mask)}</svg><div>{label}</div>
    </div>)}</div>
    <p>草・土・泡・浅瀬を段階的につなぐ。通行判定や保存データは変更しません。</p>
  </main>;
}
const screen = new URLSearchParams(location.search).get('screen');
createRoot(document.getElementById('root')!).render(<MemoryRouter>
  <SessionContext.Provider value={{ status: 'signed-in', did: agent.assertDid, agent }}>
    {screen === 'world' ? <World /> : screen === 'art' ? <ArtGallery /> : screen === 'field' ? <AdminMap /> : <AdminInteriors />}
  </SessionContext.Provider>
</MemoryRouter>);
