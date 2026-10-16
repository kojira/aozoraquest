import { allNpcs, parseNpcLine, sceneLines, type DialogueSceneId, type DialogueVars, type NpcDef, type SceneLine } from '@aozoraquest/core';
import type { DialogueLine } from './dialogue';
import { npcDialogueLines, npcImageUrl } from './npc-image';

/**
 * 会話データ (world.dialogue。D-DIALOGUE-006) の行を会話窓の行にする。
 * 話者: `npcId` → NPC の名前と会話イラスト (表情タグ [name] は登録済みの表情画像)。NPC が見つからなければ地の文。
 * `speaker` → 名前だけ。`here` → その場の人 (宿屋の名前・ギルドの受付 NPC・店主。呼出側が決める)。
 */
export type HereSpeaker = (raw: string) => DialogueLine;

/** NPC が話す行。表情画像が無ければ通常の会話イラスト (行ごとに付ける。窓全体の絵は使わない)。 */
export function npcSceneLine(npc: NpcDef, raw: string): DialogueLine {
  const line = npcDialogueLines(npc, [raw])[0]!;
  if (line.portrait || !npc.portraitImage) return line;
  return { ...line, portrait: { src: npcImageUrl(npc.id, 'portrait', npc.portraitImage), name: npc.name } };
}

export const hereNpc = (npc: NpcDef): HereSpeaker => (raw) => npcSceneLine(npc, raw);
export const hereName = (name: string): HereSpeaker => (raw) => ({ speaker: name, text: parseNpcLine(raw).text });

export function sceneDialogueLine(line: SceneLine, here?: HereSpeaker, npcs: readonly NpcDef[] = allNpcs()): DialogueLine {
  const npc = line.npcId !== undefined ? npcs.find((n) => n.id === line.npcId) : undefined;
  const base: DialogueLine = npc ? npcSceneLine(npc, line.text)
    : line.here && here ? here(line.text)
    : line.speaker ? { speaker: line.speaker, text: parseNpcLine(line.text).text }
    : { text: parseNpcLine(line.text).text };
  return line.effects ? { ...base, effects: line.effects } : base;
}

/** その場面の行 (無ければ空 = 呼出側はその会話を出さない。コード側に代わりの文は持たない)。 */
export function sceneDialogue(id: DialogueSceneId, opts: { vars?: DialogueVars; npcId?: string; here?: HereSpeaker } = {}): DialogueLine[] {
  return sceneLines(id, opts.vars, opts.npcId).map((l) => sceneDialogueLine(l, opts.here));
}
