/**
 * **会話データ** (D-DIALOGUE-006)。管理者 PDS の `world.dialogue` に置く。
 * 場面 ID はコードで決まった一覧 (どの場面をいつ出すかはコード)、文はデータが持つ。
 * データが無ければ `sceneLines` は空を返す (コード側に代わりの文は持たない)。
 *
 * 読み込みは最後 (story の後)。NPC の実在は読み込みでは見ない (参照切れで全体が消えないように)。
 * 保存のときだけ `missingDialogueNpc` で見る。
 */
import { MAX_NPC_LINE, parseNpcLine } from './npc-data.js';
import { isStoryEffectList, MAX_STORY_EFFECTS, type StoryEffect } from './story-effect.js';

export class DialogueDataError extends Error {}

/** 決まった場面。すべて 1 行以上ないと保存できない。 */
export const DIALOGUE_SCENE_IDS = [
  'opening.prologue', 'opening.rescue', 'opening.invitation', 'opening.handoff', 'opening.blessing',
  'guild.first', 'guild.return', 'inn.ask', 'inn.thanks', 'inn.decline', 'shop.tutorial',
] as const;
export type DialogueSceneId = (typeof DIALOGUE_SCENE_IDS)[number];

/** 受付 NPC ごとの上書き (`guild.first:<npcId>`) を持てる場面。 */
const OVERRIDABLE: readonly DialogueSceneId[] = ['guild.first', 'guild.return'];
/** 場面ごとに使える差し込み。ここに無い `{name}` は保存で弾く。 */
const PLACEHOLDERS: Partial<Record<DialogueSceneId, readonly string[]>> = { 'opening.blessing': ['power'], 'inn.ask': ['price'] };
export type DialogueVars = Partial<Record<'price' | 'power', number | string>>;

export const MAX_SCENE_LINES = 20;

export interface SceneLine {
  /** 120 字まで。先頭に表情タグ [name] を書ける (D-DIALOGUE-005)。 */
  text: string;
  /** 話者はその NPC (名前・絵は npcs レコードから)。 */
  npcId?: string;
  /** 名前だけを出す話者 (絵は出さない)。 */
  speaker?: string;
  /** 話者は「その場の人」(宿屋・ギルドの受付・店主)。 */
  here?: true;
  effects?: StoryEffect[];
}
export interface DialogueScene { id: string; lines: SceneLine[] }
/** world.dialogue の中身 (updatedAt を除く)。 */
export interface DialogueData { scenes: DialogueScene[] }
export interface DialogueRecord extends DialogueData { updatedAt: string }

/** `guild.first:<npcId>` → ['guild.first', '<npcId>']。上書きでなければ npcId は undefined。 */
function splitSceneId(id: string): { base: string; npcId?: string } {
  const at = id.indexOf(':');
  return at < 0 ? { base: id } : { base: id.slice(0, at), npcId: id.slice(at + 1) };
}

function validateLine(line: SceneLine, where: string, allowed: readonly string[]): void {
  if (!line || typeof line !== 'object') throw new DialogueDataError(`${where}: 行が不正`);
  if (typeof line.text !== 'string' || parseNpcLine(line.text).text.trim() === '' || line.text.length > MAX_NPC_LINE) {
    throw new DialogueDataError(`${where}: 本文が不正 (空 or ${MAX_NPC_LINE} 文字超)`);
  }
  const speakers = [line.npcId, line.speaker, line.here].filter((v) => v !== undefined).length;
  if (speakers > 1) throw new DialogueDataError(`${where}: 話者の欄は 1 つまで`);
  if (line.npcId !== undefined && (typeof line.npcId !== 'string' || line.npcId.trim() === '')) throw new DialogueDataError(`${where}: 話者の NPC id が不正`);
  if (line.speaker !== undefined && (typeof line.speaker !== 'string' || line.speaker.trim() === '')) throw new DialogueDataError(`${where}: 話者の名前が不正`);
  if (line.here !== undefined && line.here !== true) throw new DialogueDataError(`${where}: here は true だけ`);
  if (line.effects !== undefined && !isStoryEffectList(line.effects)) throw new DialogueDataError(`${where}: 演出が不正 (${MAX_STORY_EFFECTS} 件まで)`);
  for (const m of line.text.matchAll(/\{([^{}]*)\}/g)) {
    if (!allowed.includes(m[1]!)) throw new DialogueDataError(`${where}: この場面で使えない差し込み ({${m[1]}})`);
  }
}

/** 検証する。**壊れた 1 行で全体を落とす**。決まった場面がすべて 1 行以上あること。 */
export function validateDialogue(data: DialogueData): void {
  const scenes = data?.scenes;
  if (!Array.isArray(scenes)) throw new DialogueDataError('scenes が配列でない');
  const ids = new Set<string>();
  for (const s of scenes) {
    if (!s || typeof s.id !== 'string') throw new DialogueDataError('場面の id が不正');
    const { base, npcId } = splitSceneId(s.id);
    const known = (DIALOGUE_SCENE_IDS as readonly string[]).includes(base);
    if (!known || (npcId !== undefined && (npcId.trim() === '' || !OVERRIDABLE.includes(base as DialogueSceneId)))) {
      throw new DialogueDataError(`知らない場面 (${s.id})`);
    }
    if (ids.has(s.id)) throw new DialogueDataError(`場面が重複 (${s.id})`);
    ids.add(s.id);
    if (!Array.isArray(s.lines) || s.lines.length === 0) throw new DialogueDataError(`${s.id}: 行が無い`);
    if (s.lines.length > MAX_SCENE_LINES) throw new DialogueDataError(`${s.id}: 行が多すぎる (${MAX_SCENE_LINES} 行まで)`);
    const allowed = PLACEHOLDERS[base as DialogueSceneId] ?? [];
    s.lines.forEach((l, i) => validateLine(l, `${s.id} ${i + 1} 行目`, allowed));
  }
  for (const id of DIALOGUE_SCENE_IDS) if (!ids.has(id)) throw new DialogueDataError(`場面が無い (${id})`);
}

/**
 * 行の npcId と上書きの `<npcId>` が指す NPC が無ければ、その説明を返す。
 * 保存のときだけ見る: dialogue の保存 (無い NPC を指す) と NPC の保存 (参照中の NPC を消す)。
 */
export function missingDialogueNpc(data: DialogueData, npcIds: ReadonlySet<string>): string | null {
  for (const s of data.scenes) {
    const { npcId } = splitSceneId(s.id);
    if (npcId !== undefined && !npcIds.has(npcId)) return `会話の場面「${s.id}」が NPC「${npcId}」を参照している (NPC が存在しない)`;
    for (const l of s.lines) if (l.npcId !== undefined && !npcIds.has(l.npcId)) return `会話の場面「${s.id}」が NPC「${l.npcId}」を参照している (NPC が存在しない)`;
  }
  return null;
}

let sceneById = new Map<string, SceneLine[]>();

/** 検証して差し替える。`null` で全解除。 */
export function setDialogue(data: DialogueData | null): void {
  if (data) validateDialogue(data);
  sceneById = new Map((data?.scenes ?? []).map((s) => [s.id, s.lines.map((l) => ({ ...l, ...(l.effects ? { effects: l.effects.map((e) => ({ ...e })) } : {}) }))]));
}

/** いま読み込まれている会話 (保存済みの参照チェック用)。 */
export function currentDialogue(): DialogueData {
  return { scenes: [...sceneById].map(([id, lines]) => ({ id, lines })) };
}

/**
 * その場面の行。差し込み `{price}` などを `vars` で埋める。
 * `npcId` を渡すと、上書き (`guild.first:<npcId>`) があればそれを使う。無ければ空。
 */
export function sceneLines(id: DialogueSceneId, vars: DialogueVars = {}, npcId?: string): SceneLine[] {
  const lines = (npcId !== undefined ? sceneById.get(`${id}:${npcId}`) : undefined) ?? sceneById.get(id) ?? [];
  return lines.map((l) => ({ ...l, text: l.text.replace(/\{(price|power)\}/g, (m, k: keyof DialogueVars) => (vars[k] !== undefined ? String(vars[k]) : m)) }));
}
