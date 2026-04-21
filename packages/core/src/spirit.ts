/**
 * 精霊セリフテンプレート (06-spirit.md §実装の階層 の層 1)。
 * 本文は spirit-lines.ts に 600 件、ここはロジックのみ。
 */

import { SPIRIT_LINES } from './spirit-lines.js';

export type SpiritSituation =
  | 'greeting.morning' | 'greeting.daytime' | 'greeting.night'
  | 'quest.new' | 'quest.progress' | 'quest.complete' | 'quest.failed'
  | 'levelup' | 'stat.shift.significant' | 'job.match.increase'
  | 'job.eligible' | 'streak.milestone' | 'companion.added'
  | 'empty.timeline' | 'first.time';

/**
 * 外部ソース (spirit-lines.ts) からのセリフプールを既定にする。
 * 個別に override したいときは pickSpiritLine に渡せばよい。
 */
export const SPIRIT_TEMPLATES: Partial<Record<SpiritSituation, readonly string[]>> = SPIRIT_LINES;


export interface SpiritContext {
  userName: string;
  currentJob?: string;
  targetJob?: string;
  statName?: string;
  statGap?: number;
  questName?: string;
  levelNum?: number;
  streakDays?: number;
  partnerName?: string;
  date?: string; // YYYY-MM-DD
  userDid: string;
}

/**
 * ハッシュで決定的にテンプレを選ぶ。同じ日・同じユーザーなら同じセリフ (ブレない)。
 */
export function pickSpiritLine(
  situation: SpiritSituation,
  context: SpiritContext,
  templates: Partial<Record<SpiritSituation, readonly string[]>> = SPIRIT_TEMPLATES,
): string | null {
  const pool = templates[situation];
  if (!pool || pool.length === 0) return null;
  const date = context.date ?? new Date().toISOString().slice(0, 10);
  const seed = hashStr(`${context.userDid}:${situation}:${date}`);
  const tmpl = pool[seed % pool.length]!;
  return expandVariables(tmpl, context);
}

function expandVariables(template: string, context: SpiritContext): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => {
    const v = (context as unknown as Record<string, unknown>)[key];
    return v == null ? `{${key}}` : String(v);
  });
}

function hashStr(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}
