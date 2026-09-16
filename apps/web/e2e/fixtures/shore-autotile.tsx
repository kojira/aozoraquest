// Isolated transport only; editors, persistence codecs and World are the real components.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import type { Agent } from '@atproto/api';
import { BASE_PALETTE, setTileArt } from '@aozoraquest/core';
import { SessionContext } from '../../src/lib/session';
import { AdminInteriors } from '../../src/routes/admin-interiors';
import { AdminMap } from '../../src/routes/admin-map';
import { World } from '../../src/routes/world';
import { pixelTile, pixelPart, shoreTile } from '../../src/components/world-tiles';
import { SHORE_NEIGHBORS, shoreMaskAt } from '../../src/lib/shore-autotile';
import '../../src/styles.css';
import { sandArt, snowArt } from './shore-ground-art';
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
  setTileArt('part:10', sandArt); setTileArt('part:11', snowArt);
  const terrainAt = (x: number, y: number) => BASE_PALETTE[Number(sample[y]?.[x] ?? 4)];
  const groundIndex = (theme: string, x: number, y: number) => theme === '砂地' ? 10 : theme === '雪' ? 11 : theme === '混在' ? (y < 5 ? 0 : x < 5 ? 10 : 11) : 0;
  const tileMap = (theme: string, auto: boolean) => <svg width="336" height="336" viewBox="0 0 448 448">
    {sample.flatMap((row, y) => [...row].map((t, x) => <g key={`${x}-${y}`} transform={`translate(${x * 32},${y * 32})`}>
      {['3', '4'].includes(t) ? auto ? shoreTile(shoreMaskAt(x, y, terrainAt), `gallery-${theme}-${x}-${y}`, (neighbor) => {
        const [dx, dy] = SHORE_NEIGHBORS[neighbor]!;
        return pixelPart(groundIndex(theme, x + dx, y + dy), 'plains');
      }) : pixelTile(BASE_PALETTE[Number(t)]!) : pixelPart(groundIndex(theme, x, y), 'plains')}
    </g>))}
  </svg>;
  return <main style={{ padding: 24, background: '#181f2e', color: 'white', width: 1080 }}>
    <h1>岸辺 · 周囲の下地をそのまま</h1>
    <p>水を塗るだけ。砂地・雪は自作の絵の例です（新しい地形の追加ではありません）。</p>
    <div style={{ display: 'flex', gap: 24 }}>{['草地', '砂地', '雪'].map((theme) => <section key={theme}><h2>{theme}</h2>{tileMap(theme, true)}</section>)}</div>
    <div style={{ display: 'flex', gap: 24 }}><section><h2>混在 · 水際なし</h2>{tileMap('混在', false)}</section><section><h2>混在 · 自動の岸辺</h2>{tileMap('混在', true)}</section></div>
    <p>丸角・入り江・単独池・細水路。陸の色と模様、32画素の雪もそのまま。</p>
  </main>;
}
const screen = new URLSearchParams(location.search).get('screen');
createRoot(document.getElementById('root')!).render(<MemoryRouter>
  <SessionContext.Provider value={{ status: 'signed-in', did: agent.assertDid, agent }}>
    {screen === 'world' ? <World /> : screen === 'art' ? <ArtGallery /> : screen === 'field' ? <AdminMap /> : <AdminInteriors />}
  </SessionContext.Provider>
</MemoryRouter>);
