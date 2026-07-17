import { useEffect, useMemo, useRef, useState } from 'react';
import { REGIONS_PER_SIDE, REGION_COUNT, REGION_SIZE, WORLD_SIZE, regionOf, terrainAt, worldOverlay, type Terrain, type Town } from '@aozoraquest/core';

/**
 * 世界地図モーダル (docs/19 — 地図確認機能)。
 *
 * 「地図がないとどこに街があるのか全く分からない」(オーナー報告 2026-07-17、
 * 本番リリース必須要件 #3)。開示範囲は「ちずのかけら」(解禁済みリージョン、
 * world/self の regions — docs/19 W5)。未解禁リージョンはフォグで覆い、
 * その中の街・橋は描かずタップにも反応しない (全図が見えるとリリースできない —
 * オーナー指摘 2026-07-18)。
 *
 * - 1024×1024 → 256×256 canvas。各ピクセルは 2 点サンプリングで水を優先
 *   (細い川がサンプル格子から漏れて「渡れそうな陸」に見える誤読を防ぐ)。
 * - 描画は 32 行ずつ rAF 分割 (同期一括だと実測 ~200ms、モバイルは数倍の
 *   ロングタスクになる — レビュー指摘)。結果はモジュールキャッシュ。
 * - 橋 = 茶のドット (渡河点はこの地図の主目的)、街 = 金ドット、現在地 = 点滅。
 * - タップの街判定は **画面 px 基準** (ワールド固定半径だとモバイルで実質
 *   7px になり当たらない — レビュー ★★★)。
 */

const SAMPLE = 4;
const MAP_PX = WORLD_SIZE / SAMPLE; // 256
const ROWS_PER_CHUNK = 32;
/** タップの街ヒット判定半径 (CSS px。指の接地面相当)。 */
const PICK_RADIUS_CSS_PX = 24;

const TERRAIN_COLORS: Record<Terrain, string> = {
  plains: '#9dd07f',
  grove: '#98cc79',
  forest: '#4f9a4f',
  pond: '#57b7ee',
  water: '#57b7ee',
  mountain: '#a8a294',
  town: '#9dd07f', // 街はドットで別描画 (下地は平地色)
  bridge: '#c98d5a',
};

const TOWN_DOT = '#f5d442';
const BRIDGE_DOT = '#c98d5a';
/** 未解禁リージョンのフォグ (地形色と紛れない暗色。dq-window の下地に馴染む) */
const FOG_COLOR = '#23252e';
const REGION_PX = REGION_SIZE / SAMPLE; // 32

let cachedMap: ImageData | null = null;

/** 1 ピクセル分の地形色 (2 点サンプリング、水優先)。 */
function samplePixel(px: number, py: number): Terrain {
  const t1 = terrainAt(px * SAMPLE, py * SAMPLE);
  const t2 = terrainAt(px * SAMPLE + 2, py * SAMPLE + 2);
  if (t1 === 'water' || t1 === 'pond') return t1;
  if (t2 === 'water' || t2 === 'pond') return t2;
  return t1;
}

/** 解禁済みリージョンにある街だけ (フォグ内の街は描かない・タップさせない)。純関数 (テスト対象)。 */
export function revealedTowns(towns: readonly Town[], regions: readonly number[]): Town[] {
  const set = new Set(regions);
  return towns.filter((t) => set.has(t.region));
}

/** 最寄りの街 (トーラス距離)。radiusWorld タイル以内、無ければ null。純関数 (テスト対象)。 */
export function nearestTown(wx: number, wy: number, towns: readonly Town[], radiusWorld: number): Town | null {
  let best: { town: Town; d: number } | null = null;
  for (const t of towns) {
    const dx = Math.min(Math.abs(t.x - wx), WORLD_SIZE - Math.abs(t.x - wx));
    const dy = Math.min(Math.abs(t.y - wy), WORLD_SIZE - Math.abs(t.y - wy));
    const d = Math.hypot(dx, dy);
    if (d <= radiusWorld && (!best || d < best.d)) best = { town: t, d };
  }
  return best ? best.town : null;
}

export function WorldMapModal({
  x,
  y,
  regions,
  onClose,
}: {
  /** プレイヤーの現在地 (ワールド座標) */
  x: number;
  y: number;
  /** ちずのかけらで解禁済みのリージョン */
  regions: readonly number[];
  onClose: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const [picked, setPicked] = useState<Town | null>(null);
  const [pickMiss, setPickMiss] = useState<'no-town' | 'fog' | null>(null);
  const overlay = useMemo(() => worldOverlay(), []);
  const regionSet = useMemo(() => new Set(regions), [regions]);
  const towns = useMemo(() => revealedTowns(overlay.towns, regions), [overlay, regions]);

  // Escape で閉じる (既存モーダル群と同じ規約) + 開いた時に「とじる」へフォーカス
  useEffect(() => {
    closeBtnRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // 地形 + 街/橋の描画。地形は 32 行ずつ rAF 分割してメインスレッドを塞がない
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    let raf = 0;
    // 未解禁リージョンをフォグで塗る。cachedMap は地形のみ (regions に依存させない —
    // かけら入手のたびに 256×256 を再サンプリングしない) ので、putImageData の後に毎回かける
    const drawFog = () => {
      ctx.fillStyle = FOG_COLOR;
      for (let r = 0; r < REGION_COUNT; r++) {
        if (regionSet.has(r)) continue;
        ctx.fillRect((r % REGIONS_PER_SIDE) * REGION_PX, Math.floor(r / REGIONS_PER_SIDE) * REGION_PX, REGION_PX, REGION_PX);
      }
    };
    const drawOverlays = () => {
      drawFog();
      // 橋 (渡河点はこの地図の主目的のひとつ。1 タイル幅はサンプリングで消えるため明示描画)
      ctx.fillStyle = BRIDGE_DOT;
      for (const b of overlay.bridgeTiles) {
        if (!regionSet.has(regionOf(b.x, b.y))) continue;
        ctx.fillRect(Math.round(b.x / SAMPLE) % MAP_PX, Math.round(b.y / SAMPLE) % MAP_PX, 2, 2);
      }
      // 街 (金のドット。フォグ内の街は revealedTowns で除外済み)
      ctx.fillStyle = TOWN_DOT;
      ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      for (const t of towns) {
        ctx.beginPath();
        ctx.arc(Math.round(t.x / SAMPLE) % MAP_PX, Math.round(t.y / SAMPLE) % MAP_PX, 2.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    };
    if (cachedMap) {
      ctx.putImageData(cachedMap, 0, 0);
      drawOverlays();
      return;
    }
    const img = new ImageData(MAP_PX, MAP_PX);
    const data = img.data;
    const colorCache = new Map<string, [number, number, number]>();
    const rgb = (hex: string): [number, number, number] => {
      let c = colorCache.get(hex);
      if (!c) {
        c = [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
        colorCache.set(hex, c);
      }
      return c;
    };
    let row = 0;
    const chunk = () => {
      const end = Math.min(row + ROWS_PER_CHUNK, MAP_PX);
      for (; row < end; row++) {
        for (let px = 0; px < MAP_PX; px++) {
          const [r, g, b] = rgb(TERRAIN_COLORS[samplePixel(px, row)] ?? '#000000');
          const i = (row * MAP_PX + px) * 4;
          data[i] = r;
          data[i + 1] = g;
          data[i + 2] = b;
          data[i + 3] = 255;
        }
      }
      ctx.putImageData(img, 0, 0); // 途中経過も見せる (上から順に現れる)
      drawFog(); // 描画途中でも未解禁地方は見せない
      if (row < MAP_PX) {
        raf = requestAnimationFrame(chunk);
      } else {
        cachedMap = img;
        drawOverlays();
      }
    };
    raf = requestAnimationFrame(chunk);
    return () => cancelAnimationFrame(raf);
  }, [overlay, towns, regionSet]);

  const pick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const wx = ((e.clientX - rect.left) / rect.width) * WORLD_SIZE;
    const wy = ((e.clientY - rect.top) / rect.height) * WORLD_SIZE;
    // ヒット半径は画面 px を基準にワールド距離へ換算 (端末サイズに依存しない指相当)
    const radiusWorld = (PICK_RADIUS_CSS_PX / rect.width) * WORLD_SIZE;
    const t = nearestTown(wx, wy, towns, radiusWorld);
    setPicked(t);
    setPickMiss(t ? null : regionSet.has(regionOf(Math.floor(wx), Math.floor(wy))) ? 'no-town' : 'fog');
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="世界地図"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 300,
        background: 'rgba(0, 0, 0, 0.72)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1em',
      }}
    >
      <div
        className="dq-window"
        onClick={(e) => e.stopPropagation()}
        style={{
          padding: 8,
          // 横向き/低い窓でも正方形 canvas + ヘッダー + 凡例が収まる幅に
          // (幅だけで縛ると「とじる」が画面外に出る — レビュー指摘)
          width: 'min(92vw, 520px, calc(92svh - 110px))',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
          <strong style={{ fontSize: '0.95em' }}>せかいちず</strong>
          <button ref={closeBtnRef} type="button" onClick={onClose} style={{ fontSize: '0.8em', padding: '0.3em 0.9em' }}>
            とじる
          </button>
        </div>
        {/* border は wrapper 側 (canvas に付けると rect が border 込みになり座標が歪む) */}
        <div style={{ position: 'relative', border: '2px solid var(--color-border)', borderRadius: 4, overflow: 'hidden' }}>
          <canvas
            ref={canvasRef}
            width={MAP_PX}
            height={MAP_PX}
            onClick={pick}
            style={{ display: 'block', width: '100%', imageRendering: 'pixelated', cursor: 'crosshair' }}
          />
          {/* 選択中の街のリング (どのドットの名前かを地図上でも示す) */}
          {picked && (
            <div
              aria-hidden
              style={{
                position: 'absolute',
                left: `${(picked.x / WORLD_SIZE) * 100}%`,
                top: `${(picked.y / WORLD_SIZE) * 100}%`,
                width: 16,
                height: 16,
                transform: 'translate(-50%, -50%)',
                borderRadius: '50%',
                border: '2px solid #fff',
                boxShadow: '0 0 0 1px rgba(0,0,0,0.7)',
                pointerEvents: 'none',
              }}
            />
          )}
          {/* 現在地マーカー (canvas 外の HTML で点滅。reduced-motion では点滅停止) */}
          <div
            aria-hidden
            className="aq-map-here"
            style={{
              position: 'absolute',
              left: `${(x / WORLD_SIZE) * 100}%`,
              top: `${(y / WORLD_SIZE) * 100}%`,
              width: 10,
              height: 10,
              transform: 'translate(-50%, -50%)',
              borderRadius: '50%',
              background: '#e8566a',
              border: '2px solid #fff',
              boxShadow: '0 0 6px rgba(232, 86, 106, 0.9)',
              pointerEvents: 'none',
            }}
          />
          <style>{`
@keyframes aq-map-blink { 0%, 60% { opacity: 1; } 61%, 100% { opacity: 0.35; } }
.aq-map-here { animation: aq-map-blink 1.1s step-end infinite; }
@media (prefers-reduced-motion: reduce) { .aq-map-here { animation: none; } }
`}</style>
        </div>
        <p style={{ margin: '0.5em 0 0', fontSize: '0.75em', color: 'var(--color-muted)', lineHeight: 1.6 }}>
          <span style={{ color: '#e8566a' }}>●</span> いまここ ({x}, {y}) /{' '}
          <span style={{ color: TOWN_DOT, textShadow: '0 0 1px rgba(0,0,0,0.7)' }}>●</span> 街 ({towns.length}) /{' '}
          <span style={{ color: BRIDGE_DOT }}>▪</span> 橋。くらい所は まだ ちずが ない (街に入ると ひろがる)。
          {picked ? (
            <strong style={{ color: 'var(--color-fg)', marginLeft: '0.4em' }}>🏘 {picked.name}</strong>
          ) : pickMiss === 'fog' ? (
            <span style={{ marginLeft: '0.4em' }}>まだ ちずに ない ばしょだ。</span>
          ) : pickMiss === 'no-town' ? (
            <span style={{ marginLeft: '0.4em' }}>ちかくに 街は ない。</span>
          ) : (
            <span style={{ marginLeft: '0.4em' }}>ちずのかけら: {regions.length}/{REGION_COUNT} ちほう</span>
          )}
        </p>
      </div>
    </div>
  );
}
