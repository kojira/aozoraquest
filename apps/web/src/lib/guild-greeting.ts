import type { NpcDef } from '@aozoraquest/core';
import type { NpcTalk } from '@/lib/npc-talk';
import { npcImageUrl } from '@/lib/npc-image';
import { ONBOARDING_PORTRAIT } from '@/lib/world-opening';

/** 村のギルド受付 (従来のあいさつ・印・同梱の会話イラストを持つ唯一の受付)。 */
const FUTABA_GUILD_NPC = 'futaba-bluesky';

/** ギルドで初めて会ったかの印 (localStorage)。受付 NPC ごとに別 (D-STORY-008)。
 *  ふたばは従来のキーのまま = 既に会った人に再び初対面のあいさつを出さない。 */
export function guildMetKey(did: string | null, npcId: string): string {
  return npcId === FUTABA_GUILD_NPC ? `aq-futaba-guild-met:${did}` : `aq-guild-met:${npcId}:${did}`;
}

/** NPC 会話の会話イラスト。登録が無ければ出さない (文字だけ)。同梱の Blueskyちゃんの絵に
 *  倒すのは Blueskyちゃん本人のギルド会話だけ (他の受付に別人の絵を出さない。D-STORY-008)。 */
export function npcTalkPortrait(npc: NpcDef, guild: boolean): { src: string; name: string } | undefined {
  if (npc.portraitImage) return { src: npcImageUrl(npc.id, 'portrait', npc.portraitImage), name: npc.name };
  return guild && npc.id === FUTABA_GUILD_NPC ? ONBOARDING_PORTRAIT : undefined;
}

/** ギルドの扉の前でぶつかったときの最初の段 (初回は再会、2 回目以降は受付メニュー)。 */
export function guildEntryTalk(npc: NpcDef, met: boolean): NpcTalk {
  return { npc, guild: met ? 'menu' : 'reunion', lines: [
    ...(met ? ['おかえり。冒険者ギルドへ ようこそ。'] : [
      '来てくれたんだね。からだの ぐあいは どう？',
      // 「村」はふたばの村だけ。ほかの町の受付は町を名指ししない共通の言い回し。
      npc.id === FUTABA_GUILD_NPC ? 'ここが 村の 冒険者ギルドだよ。すこし やすんでいってね。' : 'ここが この まちの 冒険者ギルドだよ。すこし やすんでいってね。',
    ]),
  ] };
}
