/**
 * **ギルドで紹介される冒険者** (D-PARTY-001)。管理者 PDS の `world.story` の `recruits` に置く。
 *
 * 物語には出てこない、名前のある冒険者。受付 (guildReception の NPC) が紹介し、主人公のパーティに
 * 入る。強さは職と主人公のジョブ Lv で決まる (battle-party の partyCombatants)。名前に `{c:id}` は使わない。
 * ギルドの NPC の実在は読み込みでは見ない (NPC が先に読めないと story 全体が消えるため)。保存のときだけ
 * `recruitGuildIssue` で見る。
 */
import { isArchetype, type Archetype } from './types.js';
import { isFlagName } from './scenario.js';
import type { NpcDef } from './npc-data.js';

export interface RecruitDef {
  id: string;
  /** ふつうの名前 (`{c:id}` は使わない)。 */
  name: string;
  archetype: Archetype;
  /** 紹介するギルドの受付 (guildReception の NPC id)。 */
  guild: string;
  /** すべて立っているときだけ紹介される (その街に着いたことを表すフラグ)。 */
  requireFlags?: string[];
  /** ひとこと (1 行・40 字まで)。紹介の一覧に出す。 */
  line: string;
}

export const MAX_RECRUITS = 60;
export const MAX_RECRUIT_NAME = 12;
export const MAX_RECRUIT_LINE = 40;

const oneLine = (v: unknown, max: number): boolean => typeof v === 'string' && v.trim() !== '' && v.length <= max && !/[\r\n{}]/.test(v);

/** 1 人ぶんの問題 (無ければ null)。重複は呼び出し側で見る。 */
export function recruitIssue(r: RecruitDef): string | null {
  if (!r || typeof r.id !== 'string' || r.id.trim() === '') return '冒険者の id が空';
  if (!oneLine(r.name, MAX_RECRUIT_NAME)) return `${r.id}: 名前は 1 行・${MAX_RECRUIT_NAME} 字まで ({c:…} は使えない)`;
  if (!isArchetype(r.archetype)) return `${r.id}: 職が不正 (${String(r.archetype)})`;
  if (typeof r.guild !== 'string' || r.guild.trim() === '') return `${r.id}: ギルドが空`;
  if (r.requireFlags !== undefined && (!Array.isArray(r.requireFlags) || !r.requireFlags.every(isFlagName))) return `${r.id}: 条件のフラグ名が不正`;
  if (!oneLine(r.line, MAX_RECRUIT_LINE)) return `${r.id}: ひとことは 1 行・${MAX_RECRUIT_LINE} 字まで`;
  return null;
}

/** 保存のときだけ見る: 冒険者のギルドが、受付 (guildReception) の NPC であること。 */
export function recruitGuildIssue(recruits: readonly RecruitDef[], npcs: readonly NpcDef[]): string | null {
  for (const r of recruits) {
    if (!npcs.some((n) => n.id === r.guild && n.guildReception === true)) return `冒険者「${r.name}」のギルド「${r.guild}」が受付の NPC でない`;
  }
  return null;
}

/** そのギルドで、いま紹介できる冒険者 (定義の順)。 */
export function recruitsFor(list: readonly RecruitDef[], guild: string, flags: readonly string[]): RecruitDef[] {
  return list.filter((r) => r.guild === guild && (r.requireFlags ?? []).every((f) => flags.includes(f)));
}
