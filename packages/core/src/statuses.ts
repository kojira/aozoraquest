/**
 * 状態異常 + パッシブのフック機構 (戦闘刷新 #452 / docs/25 §3・§4)。
 *
 * 状態異常もパッシブも「戦闘ライフサイクルのフック点に反応する `CombatHook` 実装」という
 * 同じ枠組みで扱う (オーナー方針 2026-07-22: 首狩り専用メソッドを作らず汎用フックにする)。
 * エンジンは各フック点で「いま有効なフック (statuses→STATUS_REGISTRY + passives→PASSIVES) を
 * 全部集めて回す」だけ。`if (status==='poison')` の分岐は書かない。
 *
 * **重要 (behavior-preserving)**: どのディスパッチ関数も、対象が状態異常・パッシブを持たない
 * (空配列 or undefined) 場合は入力値をそのまま返す no-op。既存戦闘は挙動不変。
 */

import type { Combatant, TurnEvent } from './battle.js';

export type StatusId =
  | 'poison' // 毒: turnEnd で magnitude ダメージ
  | 'sleep' // 眠り: beforeAct 行動不可 + 被弾で起床
  | 'stun' // 麻痺: beforeAct 行動不可 (短い)
  | 'tumble' // 転倒: beforeAct 行動不可 + 被ダメ 1.2 倍
  | 'restraint' // 束縛: beforeAct 行動不可・被弾では解けない
  | 'hidden' // かくれみ: 回避↑・行動 or 被弾で解除
  | 'critCharge' // 九字切り: 次の攻撃を確定会心
  | 'atkUp'
  | 'atkDown' // 攻撃威力 magnitude 倍
  | 'defUp'
  | 'defDown' // 被ダメ magnitude 倍
  | 'agiUp'
  | 'agiDown'; // 回避 magnitude 倍

/** 付与時に turns 未指定なら使う既定持続 (毒手/デバフ等の共通デフォルト)。 */
export const DEFAULT_STATUS_TURNS = 2;

export interface StatusInstance {
  id: StatusId;
  /** 残りターン数。ターン終了で 1 減り、0 で除去。 */
  turns: number;
  /** 効果量。**単位は状態ごとに異なる**: poison=1 ターンあたりのダメージ量 (絶対値) /
   *  atk・def・agi の Up/Down=倍率 (例 1.3)。付与側は取り違えに注意。未指定は各状態のデフォルト。 */
  magnitude?: number;
}

/** フック呼び出しの文脈。ディスパッチャが「処理中の状態インスタンス」と「c 側」を差し込む。 */
export interface HookCtx {
  rng: () => number;
  events: TurnEvent[];
  /** いま処理中の状態インスタンス (magnitude 参照用)。パッシブでは undefined。 */
  status?: StatusInstance;
  /** c がどちら側か (イベント文の話者)。 */
  actor?: 'player' | 'monster';
}

/**
 * 戦闘の各タイミングで呼ばれる任意ハンドラ群 (docs/25 §4)。状態異常もパッシブもこれを実装する。
 * §14.3 の拡張フック (overrideAction/modifyHit/onIncomingMagic/onEnemyCast/onLethal) は
 * マルチ戦闘・魔法系で使うため #453 以降で追加する (現段階では 7 コアフックのみ)。
 */
export interface CombatHook {
  /** 行動直前。block=true で行動不可 (眠り/麻痺/転倒/束縛)。 */
  beforeAct?(c: Combatant, ctx: HookCtx): { block?: boolean } | void;
  /** 回避率の補正 (c=回避する側)。かくれみ/agi バフ。 */
  dodgeCalc?(dodge: number, c: Combatant, ctx: HookCtx): number;
  /** 攻撃威力の倍率補正 (c=攻撃側)。atkUp/atkDown。 */
  powerCalc?(power: number, c: Combatant, ctx: HookCtx): number;
  /** 会心の可否 (c=攻撃側)。九字切り=確定会心。 */
  critCalc?(willCrit: boolean, c: Combatant, ctx: HookCtx): boolean;
  /** 命中時 (atk→def)。首狩り等の即死パッシブ。 */
  onHit?(atk: Combatant, def: Combatant, ctx: HookCtx): { instakill?: boolean } | void;
  /** 被ダメージの倍率補正 (c=被弾側)。defUp/defDown/転倒。 */
  incomingCalc?(power: number, c: Combatant, ctx: HookCtx): number;
  /** ターン終了。毒ダメージ等。 */
  turnEnd?(c: Combatant, ctx: HookCtx): void;
}

/** 状態異常 = 一時的フック (turns で消える) + 重ね方/解除条件のメタ。 */
export interface StatusDef extends CombatHook {
  id: StatusId;
  name: string;
  /** 同 id を再付与したときの扱い。未指定は refresh (turns 上書き)。 */
  restack?: 'refresh' | 'ignore' | 'stack';
  /** 免疫判定 (毒無効の敵など)。true なら付与されない。 */
  immuneIf?(c: Combatant): boolean;
  /** 自分が行動したら解除 (かくれみ/九字切り)。 */
  clearOnAct?: boolean;
  /** 被弾したら解除 (かくれみ)。 */
  clearOnHit?: boolean;
  /** 被弾で起床 (眠り)。 */
  wakeOnHit?: boolean;
}

/** パッシブ = ジョブ innate な常時フック (turns なし)。 */
export interface PassiveDef extends CombatHook {
  id: string;
  name: string;
}

function blockedActing(c: Combatant, ctx: HookCtx, label: string): { block?: boolean } {
  ctx.events.push({ actor: ctx.actor ?? 'player', text: `${c.name}は${label}` });
  return { block: true };
}

/** 状態異常レジストリ。新しい状態は CombatHook を実装してここに 1 エントリ足すだけ。 */
export const STATUS_REGISTRY: Record<StatusId, StatusDef> = {
  poison: {
    id: 'poison',
    name: '毒',
    restack: 'refresh',
    turnEnd: (c, ctx) => {
      const dmg = ctx.status?.magnitude ?? 2;
      c.hp = Math.max(0, c.hp - dmg);
      ctx.events.push({ actor: ctx.actor ?? 'player', text: `${c.name}は毒のダメージ! ${dmg} のダメージ`, damage: dmg });
    },
  },
  sleep: {
    id: 'sleep',
    name: '眠り',
    wakeOnHit: true,
    beforeAct: (c, ctx) => blockedActing(c, ctx, 'ねむっている…'),
  },
  stun: {
    id: 'stun',
    name: '麻痺',
    beforeAct: (c, ctx) => blockedActing(c, ctx, 'しびれて動けない!'),
  },
  tumble: {
    id: 'tumble',
    name: '転倒',
    restack: 'ignore',
    beforeAct: (c, ctx) => blockedActing(c, ctx, 'ころんで動けない!'),
    incomingCalc: (p) => p * 1.2, // 起き上がりざまは被弾が痛い
  },
  restraint: {
    id: 'restraint',
    name: '束縛',
    clearOnAct: true,
    clearOnHit: false, // 被弾では解けない (sleep/stun と区別)
    beforeAct: (c, ctx) => blockedActing(c, ctx, 'しばられて動けない!'),
  },
  hidden: {
    id: 'hidden',
    name: 'かくれみ',
    clearOnAct: true,
    clearOnHit: true,
    // 注意: agiUp/agiDown が乗算なのに対し hidden は「下限床」で異質。回避 cap (dodgeMax≒0.32)
    // を意図的に踏み越えて確実に隠れる。agiDown と重なると hooksOf の順序依存になる (床 vs 乗算は
    // 非可換)。値と床/乗算のどちらにするかは #456 パイロット (忍者) で sim 確定 (レビュー ★)。
    dodgeCalc: (dodge) => Math.max(dodge, 0.75),
  },
  critCharge: {
    id: 'critCharge',
    name: '九字切り',
    clearOnAct: true,
    critCalc: () => true, // 次の一撃を確定会心
  },
  atkUp: { id: 'atkUp', name: '攻撃力上昇', restack: 'refresh', powerCalc: (p, _c, ctx) => p * (ctx.status?.magnitude ?? 1.3) },
  atkDown: { id: 'atkDown', name: '攻撃力低下', restack: 'refresh', powerCalc: (p, _c, ctx) => p * (ctx.status?.magnitude ?? 0.7) },
  defUp: { id: 'defUp', name: '守備力上昇', restack: 'refresh', incomingCalc: (p, _c, ctx) => p * (ctx.status?.magnitude ?? 0.7) },
  defDown: { id: 'defDown', name: '守備力低下', restack: 'refresh', incomingCalc: (p, _c, ctx) => p * (ctx.status?.magnitude ?? 1.3) },
  agiUp: { id: 'agiUp', name: '素早さ上昇', restack: 'refresh', dodgeCalc: (d, _c, ctx) => d * (ctx.status?.magnitude ?? 1.5) },
  agiDown: { id: 'agiDown', name: '素早さ低下', restack: 'refresh', dodgeCalc: (d, _c, ctx) => d * (ctx.status?.magnitude ?? 0.6) },
};

/** パッシブレジストリ (ジョブ innate)。#456 で首狩り等を追加。今は枠だけ。 */
export const PASSIVES: Record<string, PassiveDef> = {};

/** ctx にいま処理中の status を差し込む (exactOptional: undefined は明示せず省略)。 */
function ctxFor(ctx: HookCtx, inst?: StatusInstance): HookCtx {
  return inst ? { ...ctx, status: inst } : ctx;
}

/** c に有効なフック (状態異常 + パッシブ) を、参照インスタンス付きで集める。 */
function hooksOf(c: Combatant): Array<{ def: CombatHook; inst?: StatusInstance }> {
  const out: Array<{ def: CombatHook; inst?: StatusInstance }> = [];
  for (const inst of c.statuses ?? []) {
    const def = STATUS_REGISTRY[inst.id];
    if (def) out.push({ def, inst });
  }
  for (const pid of c.passives ?? []) {
    const def = PASSIVES[pid];
    if (def) out.push({ def });
  }
  return out;
}

// ─── フック点ディスパッチ (空なら入力そのまま = no-op) ───────────────

/** 行動直前: いずれかのフックが block を返したら true (行動不可)。 */
export function applyBeforeAct(c: Combatant, ctx: HookCtx): boolean {
  let blocked = false;
  for (const { def, inst } of hooksOf(c)) {
    if (def.beforeAct?.(c, ctxFor(ctx, inst))?.block) blocked = true;
  }
  return blocked;
}

/** 回避率補正 (c=回避側)。 */
export function applyDodgeCalc(dodge: number, c: Combatant, ctx: HookCtx): number {
  let v = dodge;
  for (const { def, inst } of hooksOf(c)) v = def.dodgeCalc?.(v, c, ctxFor(ctx, inst)) ?? v;
  return v;
}

/** 攻撃威力倍率 (c=攻撃側)。基準 1 に対する乗数を返す。 */
export function applyPowerCalc(base: number, c: Combatant, ctx: HookCtx): number {
  let v = base;
  for (const { def, inst } of hooksOf(c)) v = def.powerCalc?.(v, c, ctxFor(ctx, inst)) ?? v;
  return v;
}

/** 会心の可否 (c=攻撃側)。 */
export function applyCritCalc(willCrit: boolean, c: Combatant, ctx: HookCtx): boolean {
  let v = willCrit;
  for (const { def, inst } of hooksOf(c)) v = def.critCalc?.(v, c, ctxFor(ctx, inst)) ?? v;
  return v;
}

/** 被ダメ倍率 (c=被弾側)。基準 1 に対する乗数を返す。 */
export function applyIncomingCalc(base: number, c: Combatant, ctx: HookCtx): number {
  let v = base;
  for (const { def, inst } of hooksOf(c)) v = def.incomingCalc?.(v, c, ctxFor(ctx, inst)) ?? v;
  return v;
}

/** 命中時: いずれかのパッシブ/状態が即死を返したら true。 */
export function applyOnHit(atk: Combatant, def_: Combatant, ctx: HookCtx): boolean {
  let kill = false;
  for (const { def, inst } of hooksOf(atk)) {
    if (def.onHit?.(atk, def_, ctxFor(ctx, inst))?.instakill) kill = true;
  }
  return kill;
}

/** ターン終了: turnEnd フック (毒等) → turns-- → 0 で除去。生存者のみ turnEnd を受ける。 */
export function tickStatuses(c: Combatant, ctx: HookCtx): void {
  if (!c.statuses || c.statuses.length === 0) return;
  for (const inst of c.statuses) {
    if (c.hp <= 0) break;
    STATUS_REGISTRY[inst.id]?.turnEnd?.(c, ctxFor(ctx, inst));
  }
  for (const inst of c.statuses) inst.turns -= 1;
  c.statuses = c.statuses.filter((s) => s.turns > 0);
}

/** 自分が行動したときに clearOnAct 状態を除去 (かくれみ/九字切り)。 */
export function clearActedStatuses(c: Combatant): void {
  if (!c.statuses || c.statuses.length === 0) return;
  c.statuses = c.statuses.filter((s) => !STATUS_REGISTRY[s.id]?.clearOnAct);
}

/** 被弾したときに clearOnHit / wakeOnHit 状態を除去 (かくれみ解除・眠り起床)。 */
export function clearHitStatuses(c: Combatant): void {
  if (!c.statuses || c.statuses.length === 0) return;
  c.statuses = c.statuses.filter((s) => {
    const d = STATUS_REGISTRY[s.id];
    return !(d?.clearOnHit || d?.wakeOnHit);
  });
}

/** 状態を付与 (restack で重ね方を制御・免疫を尊重)。 */
export function applyStatus(c: Combatant, inst: StatusInstance): void {
  const def = STATUS_REGISTRY[inst.id];
  if (!def) return;
  if (def.immuneIf?.(c)) return;
  if (!c.statuses) c.statuses = [];
  const existing = c.statuses.find((s) => s.id === inst.id);
  if (existing) {
    const mode = def.restack ?? 'refresh';
    if (mode === 'ignore') return;
    if (mode === 'refresh') {
      existing.turns = Math.max(existing.turns, inst.turns);
      if (inst.magnitude !== undefined) existing.magnitude = inst.magnitude;
      return;
    }
    // stack: 別インスタンスとして追加
  }
  c.statuses.push({ ...inst });
}
