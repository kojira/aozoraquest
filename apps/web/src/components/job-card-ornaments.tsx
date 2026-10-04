/** JobCard の枠装飾 (4 隅オーナメント・中央装飾・スパークル)。 */

import { H, W } from './job-card-layout';

/**
 * 4 隅のオーナメント。L 字の二重線 + コーナーの宝石風ダイヤ + 沿線のドット。
 * cx,cy は L の内角 (= 内側トリムの角)。rotation で 4 隅に向きを合わせる。
 * trimId は silver/gold/rainbow から選び、宝石とダイヤの色味が rarity と合う。
 */
export function CornerOrnament({ cx, cy, rotation, trimId }: { cx: number; cy: number; rotation: number; trimId: string }) {
  const stroke = `url(#${trimId})`;
  return (
    <g transform={`translate(${cx},${cy}) rotate(${rotation})`}>
      <path d="M 4 38 L 4 4 L 38 4" fill="none"
            stroke="rgba(0,0,0,0.55)" strokeWidth="0.6" />
      <path d="M 0 40 L 0 0 L 40 0" fill="none"
            stroke={stroke} strokeWidth="1.8" strokeLinecap="round" />
      <path d="M 0 0 L 9 -9 L 18 0 L 9 9 Z"
            fill={stroke} stroke="#1a0e02" strokeWidth="0.7" />
      <path d="M 9 -5.5 L 14 0 L 9 5.5 L 4 0 Z"
            fill="rgba(255,255,255,0.7)" />
      <circle cx="24" cy="0" r="1.8" fill={stroke} />
      <circle cx="32" cy="0" r="1.2" fill={stroke} opacity="0.7" />
      <circle cx="0" cy="24" r="1.8" fill={stroke} />
      <circle cx="0" cy="32" r="1.2" fill={stroke} opacity="0.7" />
    </g>
  );
}

/**
 * 上下中央の小さな baroque 装飾。シンメトリな菱形 + 横線。
 * trimId は CornerOrnament と同じ色味系を共有させる。
 */
export function CenterFlourish({ cx, cy, rotation = 0, trimId }: { cx: number; cy: number; rotation?: number; trimId: string }) {
  const stroke = `url(#${trimId})`;
  return (
    <g transform={`translate(${cx},${cy}) rotate(${rotation})`}>
      <path d="M -28 0 L -8 0" stroke={stroke} strokeWidth="1.4" />
      <path d="M 28 0 L 8 0" stroke={stroke} strokeWidth="1.4" />
      <path d="M -8 0 L 0 -5 L 8 0 L 0 5 Z"
            fill={stroke} stroke="#1a0e02" strokeWidth="0.5" />
      <circle cx="-32" cy="0" r="1.4" fill={stroke} />
      <circle cx="32" cy="0" r="1.4" fill={stroke} />
    </g>
  );
}

/**
 * 枠帯にちりばめるスパークル星。
 *
 * 配置はパネル外 (x < PADX, x > W - PADX, y < PADY, y > H - PADY) の枠帯のみ。
 * 角オーナメント / 中央装飾 と被らないようにバッファを取って rejection sampling。
 * seed (rarity から導出) で決定的に位置決め → 同じ rarity は毎回同じ模様。
 *
 * bigSparkles=true なら 1/4 を + 字型の大粒に置き換える (SSR/UR で輝きを強める)。
 */
export function SparkleField({ count, seed, bigSparkles }: { count: number; seed: number; bigSparkles: boolean }) {
  const stars = generateSparkles(seed, count);
  return (
    <g>
      {stars.map((s, i) => {
        if (bigSparkles && i % 4 === 0) {
          // + 字型の大粒 (4-point star)
          const r = s.r * 1.4;
          const inner = r * 0.28;
          return (
            <path
              key={i}
              transform={`translate(${s.x},${s.y})`}
              d={`M 0 ${-r} L ${inner} ${-inner} L ${r} 0 L ${inner} ${inner} L 0 ${r} L ${-inner} ${inner} L ${-r} 0 L ${-inner} ${-inner} Z`}
              fill="#fffce8"
              opacity={s.op}
            />
          );
        }
        return (
          <circle key={i} cx={s.x} cy={s.y} r={s.r} fill="#fffce8" opacity={s.op} />
        );
      })}
    </g>
  );
}

/** rarity 文字列を deterministic な seed に潰す (FNV-1a 簡易版)。 */
export function hashRarity(r: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < r.length; i++) {
    h ^= r.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  return h;
}

/**
 * 枠帯 (パネルの外側) にスパークル星の座標を count 個生成。
 * - 上下のストリップ: y < 32 / y > H - 32
 * - 左右のストリップ: x < 32 / x > W - 32
 * - 角オーナメント (±50px) と中央装飾 (±36px) を避ける rejection sampling
 */
function generateSparkles(seed: number, count: number): Array<{ x: number; y: number; r: number; op: number }> {
  const stars: Array<{ x: number; y: number; r: number; op: number }> = [];
  let h = seed >>> 0;
  const rand = () => {
    h = (h * 1664525 + 1013904223) >>> 0;
    return h / 0x100000000;
  };
  const corners: Array<[number, number]> = [[18, 18], [W - 18, 18], [W - 18, H - 18], [18, H - 18]];
  const flourishes: Array<[number, number]> = [[W / 2, 14], [W / 2, H - 14]];
  let attempts = 0;
  while (stars.length < count && attempts < count * 12) {
    attempts++;
    const side = Math.floor(rand() * 4);
    let x: number;
    let y: number;
    if (side === 0) {        // top strip
      x = 30 + rand() * (W - 60);
      y = 3 + rand() * 28;
    } else if (side === 1) { // bottom strip
      x = 30 + rand() * (W - 60);
      y = H - 31 + rand() * 28;
    } else if (side === 2) { // left strip
      x = 3 + rand() * 28;
      y = 50 + rand() * (H - 100);
    } else {                 // right strip
      x = W - 31 + rand() * 28;
      y = 50 + rand() * (H - 100);
    }
    // reject if too close to corner ornaments or center flourishes
    let bad = false;
    for (const [cx, cy] of corners) {
      if (Math.hypot(x - cx, y - cy) < 50) { bad = true; break; }
    }
    if (!bad) {
      for (const [cx, cy] of flourishes) {
        if (Math.hypot(x - cx, y - cy) < 36) { bad = true; break; }
      }
    }
    if (bad) continue;
    const r = 1.5 + rand() * 2.2;
    const op = 0.55 + rand() * 0.4;
    stars.push({ x, y, r, op });
  }
  return stars;
}
