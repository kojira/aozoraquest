/**
 * サーバーが PDS に書く権威の記録 (gameState・battleGuard・townStock) の**小数を文字列で持つ** (#998)。
 *
 * AT Protocol の記録は整数以外の数値を持てず、PDS は putRecord を 400 で拒む。戦闘の state には
 * 防具の染まり (armorDye 0.5) などの小数があり、遭遇が「encounter failed (移動は通す)」で黙って消えていた。
 * monsters / items の記録 (#740) と同じく文字列にするが、ここは欄を決め打ちしない — 戦闘の state は
 * 機能が増えるたびに小数の欄が増えるので、欄ごとの表だと次の欄でまた同じ事故が起きる。
 *
 * 形: 整数以外の数値 `0.5` → `"~n:0.5"`。もとから `~` で始まる文字列は `~` を 1 つ足して `"~~…"` にする
 * (名前などに `~n:` で始まる文字列があっても、読みで数値に化けない)。読みは逆にたどり、数値は
 * `String(n)` → `Number(s)` で元と同じ値に戻る。印の無い記録 (これより前に書いたもの) はそのまま読める。
 */
const NUM = '~n:';
const ESC = '~';

export function encodeRecordNumbers<T>(value: T): T {
  return walk(value, (v) => {
    if (typeof v === 'number' && !Number.isInteger(v)) return NUM + String(v);
    if (typeof v === 'string' && v.startsWith(ESC)) return ESC + v;
    return v;
  }) as T;
}

export function decodeRecordNumbers<T>(value: T): T {
  return walk(value, (v) => {
    if (typeof v !== 'string' || !v.startsWith(ESC)) return v;
    if (v.startsWith(ESC + ESC)) return v.slice(1);
    if (v.startsWith(NUM)) return Number(v.slice(NUM.length));
    return v;
  }) as T;
}

function walk(v: unknown, leaf: (v: unknown) => unknown): unknown {
  if (Array.isArray(v)) return v.map((x) => walk(x, leaf));
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x, leaf)]));
  return leaf(v);
}
