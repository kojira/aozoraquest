import { useCallback, useRef, useState } from 'react';
import {
  BASE_PALETTE,
  TERRAIN_COLORS,
  TILE_ART_MAX_COLORS,
  TILE_ART_SIZES,
  UNKNOWN_TERRAIN_COLOR,
  dumpTileArts,
  emptyTileArt,
  loadTileArts,
  setTileArt,
  tileArtColorAt,
  tileArtFor,
  type TileArt,
} from '@aozoraquest/core';
import { useSession } from '@/lib/session';
import { saveTileArts } from '@/lib/world-authoring';

/**
 * **地形のドット絵エディタ** (#421)。
 *
 * タイルの見た目は今まで `world-tiles.tsx` の SVG をコードに直書きしていた。
 * 地形は 256 種まで増える前提なので、増やすたびにコードを書くのは続かない。
 * ここで描いた画素はデータとして持ち、描画側が SVG より優先して使う
 * (絵が無ければ従来の SVG、それも無ければ代表色のべた塗り、と 3 段で倒れる)。
 *
 * **色はタイル内パレットの索引で持つ。** 色を直接持たないのは、パレットを差し替える
 * だけで夜・雪・毒沼のような色調を、絵を描き直さずに出せるようにするため。
 */

/** 編集中の拡大率 (1 画素を何 px で見せるか)。 */
const CELL = 22;

export function TileArtEditor() {
  const session = useSession();
  const [terrain, setTerrain] = useState<string>(BASE_PALETTE[0]!);
  const [size, setSize] = useState<number>(16);
  const [art, setArt] = useState<TileArt>(() => tileArtFor(BASE_PALETTE[0]!) ?? emptyTileArt(16));
  const [color, setColor] = useState(1);
  const [note, setNote] = useState<string | null>(null);
  const painting = useRef(false);

  const pick = useCallback((t: string) => {
    setTerrain(t);
    const existing = tileArtFor(t);
    const next = existing ?? seedFromColor(t, size);
    setArt(next);
    setColor(1);
  }, [size]);

  const paint = useCallback((x: number, y: number) => {
    setArt((a) => {
      const pixels = new Uint8Array(a.pixels);
      pixels[y * a.size + x] = color;
      return { ...a, pixels };
    });
  }, [color]);

  const save = useCallback(() => {
    try {
      setTileArt(terrain, art);
      setNote(`${terrain} のドット絵を反映した (ワールド画面で使われる)`);
    } catch (e) {
      setNote(`保存できなかった: ${String(e)}`);
    }
  }, [terrain, art]);

  const publish = useCallback(async () => {
    if (!session.agent) return;
    try {
      setTileArt(terrain, art);
      const n = await saveTileArts(session.agent);
      setNote(`${n} 地形ぶんを保存した`);
    } catch (e) {
      setNote(`保存できなかった: ${String(e)}`);
    }
  }, [session.agent, terrain, art]);

  const exportJson = useCallback(() => {
    setTileArt(terrain, art);
    const blob = new Blob([JSON.stringify(dumpTileArts(), null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'tile-art.json';
    a.click();
    URL.revokeObjectURL(url);
  }, [terrain, art]);

  const importJson = useCallback((file: File) => {
    void file.text().then((txt) => {
      try {
        loadTileArts(JSON.parse(txt));
        setArt(tileArtFor(terrain) ?? emptyTileArt(size));
        setNote('読み込んだ');
      } catch (e) {
        setNote(`読み込めなかった: ${String(e)}`);
      }
    });
  }, [terrain, size]);

  const setPaletteColor = (i: number, v: string) => {
    setArt((a) => {
      const palette = [...a.palette];
      while (palette.length <= i) palette.push('');
      palette[i] = v;
      return { ...a, palette };
    });
  };

  return (
    <section style={{ marginTop: '2em' }}>
      <h3 style={{ fontSize: '0.95em' }}>タイルのドット絵</h3>
      <p style={{ fontSize: '0.8em', color: 'var(--color-muted)', marginBottom: '0.5em' }}>
        地形の見た目を画素で描く。描いた絵は<strong>従来の SVG より優先</strong>して使われ、
        絵が無い地形は代表色のべた塗りになるので、<strong>描く前でも編集は止まらない</strong>。
      </p>

      {note && <p style={{ fontSize: '0.85em', color: 'var(--color-accent)' }}>{note}</p>}

      <div style={{ display: 'flex', gap: '0.4em', flexWrap: 'wrap', alignItems: 'center', marginBottom: '0.5em' }}>
        <label style={{ fontSize: '0.8em' }}>
          地形{' '}
          <select value={terrain} onChange={(e) => pick(e.target.value)}>
            {BASE_PALETTE.map((t) => (
              <option key={t} value={t}>{t}{tileArtFor(t) ? ' ●' : ''}</option>
            ))}
          </select>
        </label>
        <label style={{ fontSize: '0.8em' }}>
          おおきさ{' '}
          <select
            value={size}
            onChange={(e) => {
              const n = Number(e.target.value);
              setSize(n);
              setArt(emptyTileArt(n));
            }}
          >
            {TILE_ART_SIZES.map((n) => <option key={n} value={n}>{n}×{n}</option>)}
          </select>
        </label>
      </div>

      {/* パレット (タイル内の色)。索引 0 は透明で固定。 */}
      <div style={{ display: 'flex', gap: '0.3em', flexWrap: 'wrap', alignItems: 'center', marginBottom: '0.5em' }}>
        <span style={{ fontSize: '0.75em', color: 'var(--color-muted)' }}>いろ</span>
        {Array.from({ length: TILE_ART_MAX_COLORS }, (_, i) => i).map((i) => (
          <span key={i} style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center' }}>
            <button
              type="button"
              onClick={() => setColor(i)}
              title={i === 0 ? '透明' : art.palette[i] || '未設定'}
              style={{
                width: 24, height: 24, padding: 0,
                background: i === 0 ? 'repeating-conic-gradient(#666 0% 25%, #333 0% 50%) 50% / 8px 8px' : (art.palette[i] || '#000'),
                border: color === i ? '3px solid var(--color-accent)' : '1px solid var(--color-border)',
              }}
            />
            {i > 0 && (
              <input
                type="color"
                value={art.palette[i] || '#000000'}
                onChange={(e) => setPaletteColor(i, e.target.value)}
                style={{ width: 24, height: 16, padding: 0, border: 'none', background: 'none' }}
              />
            )}
          </span>
        ))}
      </div>

      {/* 画素グリッド */}
      <div
        onMouseLeave={() => { painting.current = false; }}
        onMouseUp={() => { painting.current = false; }}
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${art.size}, ${CELL}px)`,
          width: art.size * CELL,
          border: '2px solid var(--color-border)',
          background: 'repeating-conic-gradient(#3a3a3a 0% 25%, #2a2a2a 0% 50%) 50% / 12px 12px',
        }}
      >
        {Array.from({ length: art.size * art.size }, (_, i) => {
          const x = i % art.size;
          const y = Math.floor(i / art.size);
          const c = tileArtColorAt(art, x, y);
          return (
            <div
              key={i}
              onMouseDown={() => { painting.current = true; paint(x, y); }}
              onMouseEnter={() => { if (painting.current) paint(x, y); }}
              style={{ width: CELL, height: CELL, background: c || 'transparent', cursor: 'crosshair' }}
            />
          );
        })}
      </div>

      <div style={{ display: 'flex', gap: '0.4em', marginTop: '0.5em', flexWrap: 'wrap', alignItems: 'center' }}>
        <button type="button" onClick={save} style={{ fontSize: '0.85em' }}>この地形に反映</button>
        <button type="button" onClick={() => void publish()} disabled={!session.agent} style={{ fontSize: '0.85em' }}>保存する</button>
        <button type="button" onClick={exportJson} style={{ fontSize: '0.85em' }}>すべて書き出す</button>
        <label style={{ fontSize: '0.85em' }}>
          読み込む{' '}
          <input
            type="file"
            accept="application/json"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) importJson(f); }}
            style={{ fontSize: '0.8em' }}
          />
        </label>
      </div>

      <p style={{ fontSize: '0.75em', color: 'var(--color-muted)', marginTop: '0.5em', lineHeight: 1.7 }}>
        色は<strong>索引で持つ</strong> (色そのものを画素に持たない)。パレットを差し替えるだけで
        夜・雪・毒沼のような色調を、絵を描き直さずに出せる。
        16×16 なら 1 地形 ~370 バイトで、256 地形ぜんぶ描いても ~93 KB。
      </p>
    </section>
  );
}

/** 新規作成の下敷き: その地形の代表色でべた塗りしておく (真っ白から描き始めない)。 */
function seedFromColor(terrain: string, size: number): TileArt {
  const base = (TERRAIN_COLORS as Record<string, string>)[terrain] ?? UNKNOWN_TERRAIN_COLOR;
  const art = emptyTileArt(size);
  art.palette = ['', base];
  art.pixels.fill(1);
  return art;
}
