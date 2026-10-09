/**
 * `world.monsters` レコードの小数の欄を 10 進の文字列で保存する (#740)。
 *
 * AT Protocol のレコードは整数以外の数値を持てない (PDS が putRecord を拒否する)。
 * `MonsterDef` の小数の欄だけを書く時に文字列へ、読む時に数値へ戻す。
 * 読みは文字列と数値の両方を受ける (文字列化より前のレコード・同梱データ)。
 * ゲーム側の `MonsterDef` は数値のまま。
 */
import type { MonsterDef } from './battle.js';
import { MonsterDataError } from './monster-data.js';

/** 文字列で保存する `MonsterDef` 直下の欄。 */
const TOP_FIELDS = ['spawnWeight', 'healRatio'] as const;
/** 文字列で保存する `abilityParams` の欄。 */
const ABILITY_PARAM_FIELDS = ['chargeChance', 'healChance', 'lowHpRatio', 'castChance', 'fleeBase'] as const;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);

function mapFields(o: Obj, keys: readonly string[], f: (v: unknown, key: string) => unknown): Obj {
  const out = { ...o };
  for (const k of keys) if (out[k] !== undefined) out[k] = f(out[k], k);
  return out;
}

function mapMonster(m: unknown, f: (v: unknown, key: string) => unknown): unknown {
  if (!isObj(m)) return m;
  const out = mapFields(m, TOP_FIELDS, f);
  if (Array.isArray(m.drops)) out.drops = m.drops.map((d) => (isObj(d) ? mapFields(d, ['chance'], f) : d));
  if (isObj(m.spell)) out.spell = mapFields(m.spell, ['intScale'], f);
  if (isObj(m.abilityParams)) out.abilityParams = mapFields(m.abilityParams, ABILITY_PARAM_FIELDS, f);
  return out;
}

const toDecimalString = (v: unknown) => (typeof v === 'number' ? String(v) : v);

/** レコードに書ける形 (小数の欄を文字列に) へ写す。元の配列は変えない。 */
export function encodeMonstersForRecord(monsters: readonly MonsterDef[]): unknown[] {
  return monsters.map((m) => mapMonster(m, toDecimalString));
}

/** レコードの `monsters` を `MonsterDef[]` に戻す。数値にできない文字列は MonsterDataError。
 *  配列でなければ空配列 (呼び出し側の「レコードが空」の扱いに任せる)。 */
export function decodeMonstersFromRecord(raw: unknown): MonsterDef[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((m) => mapMonster(m, (v, key) => {
    if (typeof v !== 'string') return v;
    const n = Number(v);
    if (v.trim() === '' || !Number.isFinite(n)) throw new MonsterDataError(`${isObj(m) ? String(m.id) : '(id なし)'}: ${key} が数値でない (${v})`);
    return n;
  })) as MonsterDef[];
}
