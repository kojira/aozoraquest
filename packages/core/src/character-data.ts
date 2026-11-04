/**
 * **人物の名前** (D-CHAR-001)。管理者 PDS の `world.characters` に 1 人 1 行で持つ。
 * プレイヤーに見える管理データの文には名前を直接書かず `{c:<id>}` を書き、**表示する直前に**
 * `withCharacterNames` で今の名前へ置き換える。改名は characters の 1 行を変えるだけになる。
 *
 * - 保存データはトークンのまま (読み込みで置き換えると、管理画面の保存で名前が書き戻される)。
 * - 形の検証 (`characterTokenIssue`) は各レコードの読み込みで見る。id の有無は**保存のときだけ**
 *   (`missingCharacterRef`)。読み込みで見ると、characters が 1 回読めないだけで他のレコードが落ちる。
 * - 表示で id が見つからなければ id をそのまま出す (黙って空にしない = 漏れに気づける)。
 * - 同じ文字でも意味が違えば別の id (鳥の homura / 町の homura-town)。人物以外の固有名も置いてよい。
 */

import type { AdminWorldRecordName } from './admin-nsid.js';

export class CharacterDataError extends Error {}

export interface CharacterDef {
  id: string;
  name: string;
}
/** world.characters の中身 (updatedAt を除く)。 */
export interface CharactersData { characters: CharacterDef[] }

export const MAX_CHARACTERS = 200;
export const MAX_CHARACTER_NAME = 16;
const CHARACTER_ID = /^[a-z0-9-]{1,32}$/;
/** `{c:` で始まる差し込み。中身の形は CHARACTER_ID で見る。 */
const TOKEN = /\{c:([^{}]*)\}/g;

/** 壊れた 1 人で全体を落とす (他の定義と同じ流儀)。 */
export function validateCharacters(list: readonly CharacterDef[] | null): void {
  const next = list ?? [];
  if (!Array.isArray(next)) throw new CharacterDataError('characters が配列でない');
  if (next.length > MAX_CHARACTERS) throw new CharacterDataError(`人物が多すぎる (${next.length} > ${MAX_CHARACTERS})`);
  const ids = new Set<string>();
  for (const c of next) {
    if (!c || typeof c.id !== 'string' || !CHARACTER_ID.test(c.id)) throw new CharacterDataError(`人物の id が不正 (${c?.id}。英小文字・数字・- で 32 字まで)`);
    if (ids.has(c.id)) throw new CharacterDataError(`人物の id が重複 (${c.id})`);
    ids.add(c.id);
    if (typeof c.name !== 'string' || c.name.trim() === '' || c.name.length > MAX_CHARACTER_NAME) {
      throw new CharacterDataError(`${c.id}: 名前が不正 (空 or ${MAX_CHARACTER_NAME} 字超)`);
    }
  }
}

let byId = new Map<string, string>();

/** 検証して差し替える。`null` で全解除。 */
export function setCharacters(list: readonly CharacterDef[] | null): void {
  validateCharacters(list);
  byId = new Map((list ?? []).map((c) => [c.id, c.name]));
}

/** いま読み込まれている人物 (管理画面・保存の参照チェック用)。 */
export function currentCharacters(): CharacterDef[] {
  return [...byId].map(([id, name]) => ({ id, name }));
}

/** 表示する直前に `{c:id}` を今の名前へ。知らない id は id をそのまま出す。 */
export function withCharacterNames(text: string): string {
  if (!text.includes('{c:')) return text;
  return text.replace(TOKEN, (_m, id: string) => byId.get(id) ?? id);
}

/** 文の中の `{c:` の形が壊れていれば理由、問題なければ null (読み込みの検証で使う)。 */
export function characterTokenIssue(text: string): string | null {
  for (const m of text.matchAll(TOKEN)) {
    if (!CHARACTER_ID.test(m[1] ?? '')) return `人物の差し込みが不正 ({c:${m[1]}}。英小文字・数字・- で 32 字まで)`;
  }
  return null;
}

/** 文の並びに出てくる人物 id (重複なし、出てきた順)。 */
export function characterTokenIds(texts: Iterable<string>): string[] {
  const out = new Set<string>();
  for (const t of texts) for (const m of t.matchAll(TOKEN)) if (m[1]) out.add(m[1]);
  return [...out];
}

/** 保存のときだけ見る: 無い人物を指していれば説明、無ければ null。 */
export function missingCharacterRef(texts: Iterable<string>, ids: ReadonlySet<string>): string | null {
  const missing = characterTokenIds(texts).find((id) => !ids.has(id));
  return missing === undefined ? null : `人物「${missing}」が characters に無い (先に人物を作る)`;
}

/** レコードの値から、人物の名前 {c:id} を書ける文を取り出す (保存のときの id の確認用。edge の PUT と web の保存で共有)。
 *  欄は world-refs の characterTexts (読み込み済みの定義から引く側) と同じ。 */
export function characterTextsInRecord(name: AdminWorldRecordName, value: unknown): string[] {
  const str = (v: unknown): string[] => (typeof v === 'string' ? [v] : []);
  const strs = (v: unknown): string[] => (Array.isArray(v) ? v.flatMap(str) : []);
  const rows = (key: string): Array<Record<string, unknown>> => {
    const v = (value as Record<string, unknown> | null)?.[key];
    return Array.isArray(v) ? v.filter((r): r is Record<string, unknown> => !!r && typeof r === 'object') : [];
  };
  const field = (o: unknown, k: string): string[] => str((o as Record<string, unknown> | undefined)?.[k]);
  switch (name) {
    case 'npcs': return rows('npcs').flatMap((n) => [...str(n.name), ...strs(n.lines), ...(Array.isArray(n.altLines) ? n.altLines.flatMap((a) => strs((a as { lines?: unknown })?.lines)) : [])]);
    case 'quests': return rows('quests').flatMap((q) => [...str(q.title), ...strs(q.intro), ...strs(q.done), ...strs(q.progress), ...field(q.objective, 'line')]);
    case 'scenario': return rows('events').flatMap((e) => str(e.notice));
    case 'dialogue': return rows('scenes').flatMap((s) => (Array.isArray(s.lines) ? s.lines.flatMap((l) => [...field(l, 'text'), ...field(l, 'speaker')]) : []));
    case 'items': return rows('items').flatMap((it) => str(it.name));
    case 'monsters': return rows('monsters').flatMap((m) => [...str(m.name), ...str(m.intro)]);
    case 'interiors': return rows('interiors').flatMap((m) => [...str(m.name), ...field(m.inn, 'name'), ...field(m.shop, 'name')]);
    case 'shops': return rows('shops').flatMap((s) => Object.values((s.keeper ?? {}) as Record<string, unknown>).flatMap(str));
    default: return [];
  }
}
