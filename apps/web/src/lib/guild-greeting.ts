import type { NpcDef } from '@aozoraquest/core';
import { guildReception, type NpcTalk } from '@/lib/npc-talk';
import { npcImageUrl } from '@/lib/npc-image';
import { hereNpc, sceneDialogue } from '@/lib/scene-dialogue';

/** 村のギルド受付 (従来のキーの印を持つ受付)。 */
const FUTABA_GUILD_NPC = 'futaba-bluesky';

/** ギルドで初めて会ったかの印 (localStorage)。受付 NPC ごとに別 (D-STORY-008)。
 *  ふたばは従来のキーのまま = 既に会った人に再び初対面のあいさつを出さない。 */
export function guildMetKey(did: string | null, npcId: string): string {
  return npcId === FUTABA_GUILD_NPC ? `aq-futaba-guild-met:${did}` : `aq-guild-met:${npcId}:${did}`;
}

/** NPC 会話の会話イラスト。登録が無ければ出さない (文字だけ。別人の絵に倒さない。D-STORY-008)。 */
export function npcTalkPortrait(npc: NpcDef): { src: string; name: string } | undefined {
  return npc.portraitImage ? { src: npcImageUrl(npc.id, 'portrait', npc.portraitImage), name: npc.name } : undefined;
}

/**
 * ギルドの扉の前でぶつかったときの最初の段 (初回は再会、2 回目以降は「おかえり」)。文は会話データの
 * `guild.first` / `guild.return` (受付ごとの上書き `guild.first:<npcId>` が先。D-DIALOGUE-006)。
 * 場面が無ければあいさつを飛ばしてギルドのメニューを出す。話者はその受付 NPC (here)。
 */
export function guildEntryTalk(npc: NpcDef, met: boolean): NpcTalk {
  const dialogue = sceneDialogue(met ? 'guild.return' : 'guild.first', { npcId: npc.id, here: hereNpc(npc) });
  if (dialogue.length === 0) return guildReception(npc);
  // 2 回目以降はあいさつに続けてメニューを出す (従来どおり)。初回は読み終えてメニューへ。
  return { npc, guild: met ? 'menu' : 'reunion', lines: dialogue.map((l) => l.text), dialogue };
}
