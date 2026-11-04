/**
 * めいれい の仲間の手 (`POST /api/battle/turn` の allies[]) を確かめる (D-PARTY-004 §2)。handleTurn からは 1 回呼ぶだけ。
 * - 形がおかしい (配列でない・id の重複・知らない command・flee) → 400
 * - この戦闘に出ていて、封印の時点で めいれい だった仲間 (sealed.manual) でない id → 400
 * - skillIndex はその仲間の skillsForJob (その Lv) の範囲、targetIndex は生きている敵／味方の範囲に clamp (範囲外は 0。主人公と同じ)
 * - MP 不足・どうぐ切れ・相手が先に倒れた は core が たたかう に落とす (400 にしない)
 * 送られなかった めいれい の仲間は おまかせ で埋める (allyOrders に入れない)。
 */
import { isBattleItem, skillsForJob, type AllyOrder, type BattleState } from '@aozoraquest/core';
import { ResolverError, VALID_COMMANDS } from './battle-resolver';

const bad = (message: string) => new ResolverError(message, 400, 'bad_ally_order');

/** allies[] を allies と同じ並びの AllyOrder に。無ければ undefined (今までどおり全員おまかせ)。 */
export function allyOrdersOf(raw: unknown, state: BattleState, fought: readonly string[], manual: readonly string[]): Array<AllyOrder | undefined> | undefined {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw)) throw bad('allies が不正');
  const allies = state.allies ?? [state.player];
  const enemies = state.enemies ?? [state.monster];
  const out: Array<AllyOrder | undefined> = allies.map(() => undefined);
  const seen = new Set<string>();
  for (const o of raw as Array<Record<string, unknown>>) {
    if (!o || typeof o !== 'object' || typeof o.id !== 'string') throw bad('allies の形が不正');
    if (seen.has(o.id)) throw bad('同じ仲間が ふたつ');
    seen.add(o.id);
    const command = o.command;
    if (typeof command !== 'string' || !VALID_COMMANDS.includes(command as never) || command === 'flee') throw bad('仲間の コマンドが不正');
    const at = fought.indexOf(o.id);
    if (at < 0 || !manual.includes(o.id)) throw bad('その仲間には めいれい できない');
    const actor = allies[at + 1];
    if (!actor?.job) throw bad('その仲間には めいれい できない');
    if (command === 'item' && (typeof o.itemId !== 'string' || !isBattleItem(o.itemId))) throw bad('どうぐが不正');
    const skills = skillsForJob(actor.job.archetype, actor.job.level);
    const within = (v: unknown, n: number) => (Number.isInteger(v) && (v as number) >= 0 && (v as number) < n ? (v as number) : 0);
    out[at + 1] = {
      command: command as AllyOrder['command'],
      skillIndex: within(o.skillIndex, skills.length),
      targetIndex: within(o.targetIndex, Math.max(enemies.filter((e) => e.hp > 0).length, allies.filter((a) => a.hp > 0).length)),
      ...(command === 'item' ? { itemId: o.itemId as string } : {}),
    };
  }
  return out;
}
