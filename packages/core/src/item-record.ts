/**
 * `world.items` レコードの小数の欄を 10 進の文字列で保存する (D-ITEM-001。monsters の #740 と同じ)。
 *
 * AT Protocol のレコードは整数以外の数値を持てない (PDS が putRecord を拒否する)。
 * 戦闘で使うどうぐの効果 (`battle.effects`) の小数の欄だけを、書く時に文字列へ、読む時に数値へ戻す。
 * 読みは文字列と数値の両方を受ける (同梱データ・テスト)。ゲーム側の `ItemDefData` は数値のまま。
 */
import { ItemDataError, type ItemDefData } from './item-data.js';

/** 文字列で保存する、効果 (SkillEffect) の欄。 */
const EFFECT_DECIMAL_FIELDS = ['chance', 'magnitude', 'ratio', 'intBonus', 'luckScale', 'scaleFactor'] as const;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);

function mapItem(it: unknown, f: (v: unknown, key: string, id: string) => unknown): unknown {
  if (!isObj(it) || !isObj(it.battle) || !Array.isArray(it.battle.effects)) return it;
  const id = String(it.id);
  const effects = it.battle.effects.map((e) => {
    if (!isObj(e)) return e;
    const out = { ...e };
    for (const k of EFFECT_DECIMAL_FIELDS) if (out[k] !== undefined) out[k] = f(out[k], k, id);
    return out;
  });
  return { ...it, battle: { ...it.battle, effects } };
}

/** レコードに書ける形 (小数の欄を文字列に) へ写す。元の配列は変えない。 */
export function encodeItemsForRecord(items: readonly ItemDefData[]): unknown[] {
  return items.map((it) => mapItem(it, (v) => (typeof v === 'number' ? String(v) : v)));
}

/** レコードの `items` を `ItemDefData[]` に戻す。数値にできない文字列は ItemDataError。配列でなければ空配列。 */
export function decodeItemsFromRecord(raw: unknown): ItemDefData[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((it) => mapItem(it, (v, key, id) => {
    if (typeof v !== 'string') return v;
    const n = Number(v);
    if (v.trim() === '' || !Number.isFinite(n)) throw new ItemDataError(`${id}: ${key} が数値でない (${v})`);
    return n;
  })) as ItemDefData[];
}
