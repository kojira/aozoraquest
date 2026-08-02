import { useCallback, useRef, useState } from 'react';
import { TERRAIN_TILES } from '@/components/world-tiles';
import {
  BASE_PALETTE,
  TERRAIN_COLORS,
  partArtFor,
  partKey,
  worldParts,
  TILE_ART_MAX_COLORS,
  TILE_ART_SIZES,
  UNKNOWN_TERRAIN_COLOR,
  dumpTileArts,
  emptyTileArt,
  loadTileArts,
  bundledTileArtFor,
  partPresetByName,
  presetArt,
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

/** 描く対象 1 件。地形パーツにもモンスターにも使う (#591)。 */
export interface ArtSubject {
  /** 登録簿のキー (`part:3` / `monster:sky-slime`)。 */
  key: string;
  /** 一覧での表示名。 */
  name: string;
  /** 新規作成時にパレットへ入れる代表色。 */
  seedColor: string;
  /** 古い保存のキー (地形名時代の互換)。無ければ key だけ探す。 */
  legacyKey?: string;
  /** 下敷き (既存の SVG)。ゼロから描くよりなぞるほうが早い。 */
  underlay?: React.ReactNode;
}

export function TileArtEditor({ parts: partsIn, subjects: subjectsIn }: { parts?: readonly { terrain: string; name: string }[]; subjects?: ArtSubject[] } = {}) {
  const session = useSession();
  // 対象一覧。呼び出し元 (マップ/モンスター編集画面) が持つ一覧を優先する。
  // 別々に読むと、増やした直後に片方だけ古い一覧を見て「一覧に出てこない」になる。
  const parts = partsIn ?? worldParts();
  const subjects: ArtSubject[] = subjectsIn ?? parts.map((pt, i) => ({
    key: partKey(i),
    name: pt.name,
    seedColor: (TERRAIN_COLORS as Record<string, string>)[pt.terrain] ?? UNKNOWN_TERRAIN_COLOR,
    legacyKey: pt.terrain,
    underlay: <svg viewBox="0 0 32 32" width="100%" height="100%">{TERRAIN_TILES[pt.terrain as keyof typeof TERRAIN_TILES] ?? null}</svg>,
  }));
  const [partIndex, setPartIndex] = useState(0);
  const subject = subjects[partIndex] ?? subjects[0]!;
  const terrain = subject.key;
  const [size, setSize] = useState<number>(16);
  // **初期表示も代表色の下敷きから始める。** emptyTileArt だと全画素が透明で、
  // 開いた瞬間は市松模様しか出ず「壊れている」ように見える (実機で確認)。
  // 描いた絵があればそれ、無ければ**透明から**。下敷き (既存 SVG) をなぞる前提なので、
  // 代表色で塗りつぶすと下敷きが見えなくなる。パレットには代表色を入れておく。
  const [art, setArt] = useState<TileArt>(() => {
    const sub = (subjectsIn ?? [])[0];
    if (sub) return (tileArtFor(sub.key) ?? (sub.legacyKey ? tileArtFor(sub.legacyKey) : undefined)) ?? blankWithSeed(sub.seedColor, 16);
    return partArtFor(0, BASE_PALETTE[0]!) ?? blankWithSeed((TERRAIN_COLORS as Record<string, string>)[BASE_PALETTE[0]!] ?? UNKNOWN_TERRAIN_COLOR, 16);
  });
  const [color, setColor] = useState(1);
  const [note, setNote] = useState<string | null>(null);
  /** **既存の SVG を下敷きに敷く。** ゼロから描くより、今の絵をなぞるほうが早い。 */
  const [trace, setTrace] = useState(true);
  const painting = useRef(false);

  const lookup = useCallback((sub: ArtSubject): TileArt | undefined => {
    // **古い保存 (地形名キー) にも当たる**。描画側と同じ探し方にしないと、
    // 「地図には出るのに編集画面では SVG に戻る」になる。
    return tileArtFor(sub.key) ?? (sub.legacyKey ? tileArtFor(sub.legacyKey) : undefined);
  }, []);

  const pick = useCallback((i: number) => {
    setPartIndex(i);
    const sub = subjects[i];
    if (!sub) return;
    setArt(lookup(sub) ?? blankWithSeed(sub.seedColor, size));
    setColor(1);
  }, [size, subjects, lookup]);

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

  /**
   * **同梱の絵に戻す** (#605)。一度でも自分で描くとその絵が登録簿に残って恒久的に
   * 勝つので、既定に戻す手段が無いと「新しい同梱の絵が反映されない」ように見える。
   * 登録簿から消して保存すると、以後は同梱の絵が使われる。
   */
  const resetToBundled = useCallback(async () => {
    // **プリセットのパーツを先に見る。** 「たての橋」は地形が bridge なので、
    // 地形の既定に戻すと**横の橋**になってしまう (実際に起きた)。パーツ自身の
    // 同梱の絵があるならそれが戻し先。
    const preset = partPresetByName(subject.name);
    const bundled = preset ? presetArt(preset) : bundledTileArtFor(subject.legacyKey ?? subject.key);
    if (!bundled) { setNote('この部位には同梱の絵が無い'); return; }
    if (!window.confirm(`${subject.name} を同梱の絵に戻す？\n自分で描いた絵は消える`)) return;
    try {
      // **key と legacyKey の両方を消す** — 片方が残ると探索順で古い絵が勝ち続ける。
      setTileArt(subject.key, null);
      if (subject.legacyKey) setTileArt(subject.legacyKey, null);
      setArt(bundled);
      if (session.agent) {
        const n = await saveTileArts(session.agent);
        setNote(`同梱の絵に戻した (${n} 件を保存。サーバーは最大 5 分で拾う)`);
      } else {
        setNote('同梱の絵に戻した (未ログインなので保存されていない)');
      }
    } catch (e) {
      setNote(`戻せなかった: ${String(e)}`);
    }
  }, [subject, session.agent]);

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
        setArt(lookup(subject) ?? blankWithSeed(subject.seedColor, size));
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

      {note && <p style={{ fontSize: '0.85em', color: 'var(--color-accent)' }}>{note}</p>}

      <div style={{ display: 'flex', gap: '0.4em', flexWrap: 'wrap', alignItems: 'center', marginBottom: '0.5em' }}>
        <label style={{ fontSize: '0.8em' }}>
          地形{' '}
          <select value={partIndex} onChange={(e) => pick(Number(e.target.value))}>
            {subjects.map((sub, i) => (
              <option key={sub.key} value={i}>{sub.name}{lookup(sub) ? ' ●' : ''}</option>
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
              setArt(lookup(subject) ?? blankWithSeed(subject.seedColor, n));
            }}
          >
            {TILE_ART_SIZES.map((n) => <option key={n} value={n}>{n}×{n}</option>)}
          </select>
        </label>
      </div>

      {/* パレット (タイル内の色)。索引 0 は透明で固定。
          **色見本と色の変更を分ける。** 見本の下に 24×16px の色ピッカーを並べていたが、
          実機では小さすぎて押せず「色が選べない」状態だった。見本は選ぶだけにして、
          変更は選択中の色ひとつに対して大きく出す。 */}
      <div style={{ display: 'flex', gap: '0.3em', flexWrap: 'wrap', alignItems: 'center', marginBottom: '0.4em' }}>
        <span style={{ fontSize: '0.75em', color: 'var(--color-muted)' }}>いろ</span>
        {/* **空の枠を並べすぎない。** 上限は 64 色 (#629) だが、64 個の見本を出すと
            狭い画面が見本で埋まる。使っている色 + 追加用の 1 枠だけ出す。 */}
        {Array.from({ length: Math.min(TILE_ART_MAX_COLORS, Math.max(8, art.palette.length + 1)) }, (_, i) => i).map((i) => (
          <button
            key={i}
            type="button"
            onClick={() => setColor(i)}
            title={i === 0 ? '透明 (消しゴム)' : art.palette[i] || '未設定'}
            style={{
              width: 32, height: 32, padding: 0,
              background: i === 0
                ? 'repeating-conic-gradient(#666 0% 25%, #333 0% 50%) 50% / 10px 10px'
                : (art.palette[i] || 'repeating-conic-gradient(#444 0% 25%, #222 0% 50%) 50% / 10px 10px'),
              border: color === i ? '3px solid var(--color-accent)' : '1px solid var(--color-border)',
            }}
          />
        ))}
      </div>

      {/* 選択中の色を大きく変える */}
      <div style={{ display: 'flex', gap: '0.5em', alignItems: 'center', marginBottom: '0.5em', fontSize: '0.8em' }}>
        {color === 0 ? (
          <span style={{ color: 'var(--color-muted)' }}>透明 (消しゴム) を選択中</span>
        ) : (
          <>
            <span>いろ {color} を変える</span>
            <input
              type="color"
              value={art.palette[color] || '#000000'}
              onChange={(e) => setPaletteColor(color, e.target.value)}
              style={{ width: 56, height: 34, padding: 0, border: '1px solid var(--color-border)', background: 'none' }}
            />
            <code style={{ color: 'var(--color-muted)' }}>{art.palette[color] || '未設定'}</code>
          </>
        )}
        <label style={{ marginLeft: 'auto' }}>
          <input type="checkbox" checked={trace} onChange={(e) => setTrace(e.target.checked)} /> 下敷き
        </label>
      </div>

      {/* 画素グリッド */}
      <div
        onMouseLeave={() => { painting.current = false; }}
        onMouseUp={() => { painting.current = false; }}
        style={{
          position: 'relative',
          display: 'grid',
          gridTemplateColumns: `repeat(${art.size}, ${CELL}px)`,
          width: art.size * CELL,
          border: '2px solid var(--color-border)',
          background: 'repeating-conic-gradient(#3a3a3a 0% 25%, #2a2a2a 0% 50%) 50% / 12px 12px',
          touchAction: 'none',
        }}
      >
        {/* **既存の SVG を下敷きに敷く。** 上からドットでなぞれば、ゼロから描くより早い。
            透明の画素からは下敷きが透けて見える (置いた画素で隠れる)。 */}
        {trace && subject.underlay && (
          <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', opacity: 0.85 }}>
            {subject.underlay}
          </div>
        )}
        {Array.from({ length: art.size * art.size }, (_, i) => {
          const x = i % art.size;
          const y = Math.floor(i / art.size);
          const c = tileArtColorAt(art, x, y);
          return (
            <div
              key={i}
              onPointerDown={(e) => {
                painting.current = true;
                (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
                paint(x, y);
              }}
              onPointerEnter={() => { if (painting.current) paint(x, y); }}
              onPointerUp={() => { painting.current = false; }}
              style={{
                width: CELL, height: CELL, background: c || 'transparent',
                cursor: 'crosshair', position: 'relative', touchAction: 'none',
              }}
            />
          );
        })}
      </div>

      <div style={{ display: 'flex', gap: '0.4em', marginTop: '0.5em', flexWrap: 'wrap', alignItems: 'center' }}>
        <button type="button" onClick={save} style={{ fontSize: '0.85em' }}>この地形に反映</button>
        <button type="button" onClick={() => void publish()} disabled={!session.agent} style={{ fontSize: '0.85em' }}>保存する</button>
        <button type="button" onClick={() => void resetToBundled()} style={{ fontSize: '0.85em' }}>同梱の絵に戻す</button>
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

    </section>
  );
}

/**
 * 新規作成: **画素は透明のまま**、パレットにだけ代表色を入れておく。
 * 下敷き (既存 SVG) をなぞる前提なので、べた塗りすると下敷きが見えなくなる。
 * 色が 1 つも無いと「色が選べない」ので、代表色は最初から入れる。
 */
function blankWithSeed(seedColor: string, size: number): TileArt {
  const art = emptyTileArt(size);
  art.palette = ['', seedColor, '#ffffff', '#000000'];
  return art;
}
