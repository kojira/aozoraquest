// Isolated transport only; editors, persistence codecs and World are the real components.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import type { Agent } from '@atproto/api';
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

function ArtGallery() {
  const tiles = ['snowfield', 'snowMountain', 'desert'] as const;
  const names = ['雪原', '雪山', '砂漠'];
  return <main style={{ padding: 24, background: '#181f2e', color: 'white', width: 920 }}>
    <h1>雪原・雪山・砂漠</h1><p>16×16の同梱ドット絵。マップ編集で追加して配置できます。</p>
    <div style={{ display: 'flex', gap: 24 }}>{tiles.map((terrain, i) => <section key={terrain}>
      <h2>{names[i]}</h2><svg width="128" height="128" viewBox="0 0 32 32">{pixelTile(terrain)}</svg>
      <p>{i === 1 ? '山と同じ：徒歩では通れない' : '平原と同じ：徒歩で通れる'}</p>
      <svg width="272" height="272" viewBox="0 0 256 256">{Array.from({ length: 64 }, (_, n) => {
        const x = n % 8, y = Math.floor(n / 8);
        const at = (a: number, b: number) => a >= 3 && a <= 5 && b >= 2 && b <= 4 ? 'pond' : terrain;
        return <g key={n} transform={`translate(${x * 32},${y * 32})`}>{at(x, y) === 'pond'
          ? shoreTile(shoreMaskAt(x, y, at), `biome-${i}-${n}`, () => pixelTile(terrain)) : pixelTile(terrain)}</g>;
      })}</svg>
    </section>)}</div><p>地形の下地を保って水際がつながります。既存マップの自動塗り替えや寒暑ダメージはありません。</p>
  </main>;
}
const screen = new URLSearchParams(location.search).get('screen');
createRoot(document.getElementById('root')!).render(<MemoryRouter>
  <SessionContext.Provider value={{ status: 'signed-in', did: agent.assertDid, agent }}>
    {screen === 'world' ? <World /> : screen === 'art' ? <ArtGallery /> : screen === 'field' ? <AdminMap /> : <AdminInteriors />}
  </SessionContext.Provider>
</MemoryRouter>);
