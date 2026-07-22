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
  | 'agiDown' // 回避 magnitude 倍
  | 'doomMark' // 破滅の予言: turnEnd でカウントダウン、0 で magnitude の大ダメージ
  | 'thorns' // とげの盾: 物理被弾時に攻撃者へ magnitude 割合を反射
  | 'ironWall' // 仁王立ち: 被ダメをほぼ 0 に (incomingCalc ×magnitude、既定 0.05)
  | 'accDown'; // 命中低下 (煙玉/かく乱/幻惑): 保持者の攻撃が当たりにくくなる (modifyHit)

/** 付与時に turns 未指定なら使う既定持続 (毒手/デバフ等の共通デフォルト)。 */
export const DEFAULT_STATUS_TURNS = 2;

export interface StatusInstance {
  id: StatusId;
  /** 残りターン数。ターン終了で 1 減り、0 で除去。 */
  turns: number;
  /** 効果量。**単位は状態ごとに異なる**: poison=1 ターンあたりのダメージ量 (絶対値) /
   *  atk・def・agi の Up/Down=倍率 (例 1.3)。付与側は取り違えに注意。未指定は各状態のデフォルト。 */
  magnitude?: number;
  /** 付与された当ターンだけ true。そのターンの tickStatuses では turnEnd 発火・turns 減衰を
   *  スキップする (turns:1 の麻痺が「付与ターン末に即消え」で無効化されるのを防ぐ)。これにより
   *  turns=N が「対象の以後 N ターンに効く」の直感どおりになる。applyStatus が立て、最初の tick が畳む。 */
  fresh?: boolean;
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
  /** 命中補正 (c=攻撃側)。accDown: hitBonus を下げて当てにくく。 */
  modifyHit?(hitBonus: number, c: Combatant, ctx: HookCtx): number;
  /** 会心の可否 (c=攻撃側)。九字切り=確定会心。 */
  critCalc?(willCrit: boolean, c: Combatant, ctx: HookCtx): boolean;
  /** 命中時 (atk→def)。首狩り等の即死パッシブ。 */
  onHit?(atk: Combatant, def: Combatant, ctx: HookCtx): { instakill?: boolean } | void;
  /** 被ダメージの倍率補正 (c=被弾側)。defUp/defDown/転倒。 */
  incomingCalc?(power: number, c: Combatant, ctx: HookCtx): number;
  /** 物理被弾後 (c=被弾側)。とげの盾: 攻撃者 atk へ反射。damage=食らった最終ダメージ。 */
  onDamaged?(c: Combatant, atk: Combatant, damage: number, ctx: HookCtx): void;
  /** 物理致死の直前 (c=倒れかけている側)。survive=true で HP1 生存 (覇王/不動)。魔法致死には効かない
   *  (doAttack の物理経路からのみ呼ばれる)。反射など攻撃者への副作用はハンドラ内で atk を直接操作。 */
  onLethal?(c: Combatant, atk: Combatant, damage: number, ctx: HookCtx): { survive?: boolean } | void;
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
  // 破滅の予言 (予言者): turnEnd でカウントダウン、最終ターン (turns===1) に magnitude の大ダメージ。
  // fresh スキップにより付与ターンは進まず、以後 N ターンかけて破滅が訪れる (予告 → 炸裂の緊張)。
  // とげの盾 (守護者): 物理被弾で攻撃者に反射 (magnitude=反射割合、既定 0.3)。
  thorns: {
    id: 'thorns',
    name: 'とげの盾',
    restack: 'refresh',
    onDamaged: (c, atk, damage, ctx) => {
      if (atk.hp <= 0) return;
      const reflect = Math.max(1, Math.round(damage * (ctx.status?.magnitude ?? 0.3)));
      atk.hp = Math.max(0, atk.hp - reflect);
      ctx.events.push({ actor: ctx.actor ?? 'player', text: `${atk.name}は とげに ${reflect} のダメージを受けた!`, damage: reflect });
    },
  },
  // 仁王立ち (守護者): 被ダメをほぼ 0 に (incomingCalc ×0.05)。turns 1 の完全防御。
  ironWall: { id: 'ironWall', name: '仁王立ち', incomingCalc: (p, _c, ctx) => p * (ctx.status?.magnitude ?? 0.05) },
  // 命中低下 (煙玉/かく乱/幻惑): 保持者が攻撃する際 hitBonus を下げて当てにくく (magnitude=低下量、既定 0.2)。
  accDown: { id: 'accDown', name: '命中低下', restack: 'refresh', modifyHit: (hb, _c, ctx) => hb - (ctx.status?.magnitude ?? 0.2) },
  doomMark: {
    id: 'doomMark',
    name: '破滅の予言',
    // ignore: 既に刻まれた予言は上書きしない (再詠唱でカウントダウンが巻き戻り永久に炸裂しない自己
    // 妨害を防ぐ。「予言は一度告げたら覆らない」像とも一致。レビュー ★★)。
    restack: 'ignore',
    turnEnd: (c, ctx) => {
      const remaining = ctx.status?.turns ?? 1;
      if (remaining <= 1) {
        const dmg = ctx.status?.magnitude ?? 20;
        c.hp = Math.max(0, c.hp - dmg);
        ctx.events.push({ actor: ctx.actor ?? 'player', text: `${c.name}に 破滅が訪れた! ${dmg} のダメージ`, damage: dmg });
      } else {
        ctx.events.push({ actor: ctx.actor ?? 'player', text: `${c.name}に 破滅の刻が近づいている… (あと${remaining - 1})` });
      }
    },
  },
};

/** 自己バフとみなす状態異常 (詩心の「自己バフ中 与ダメ↑」判定用)。「自分を強化した状態」= 攻撃/
 *  守備/素早さ up・会心チャージ・隠密のみ。守護スタンス系 (thorns=とげの盾 / ironWall=仁王立ち) は
 *  守護者の防御姿勢であって「盛って撃つ」詩人の自己強化とは概念が別なので**含めない** (将来マルチで
 *  他職の状態が混ざったときの誤発火も避ける。レビュー ★)。デバフ (atkDown 等) は当然含めない。 */
const SELF_BUFF_IDS: ReadonlySet<StatusId> = new Set<StatusId>([
  'atkUp',
  'defUp',
  'agiUp',
  'critCharge',
  'hidden',
]);
function hasSelfBuff(c: Combatant): boolean {
  return (c.statuses ?? []).some((s) => SELF_BUFF_IDS.has(s.id));
}

/** 回避パッシブ (全知/旅の勘) の実効回避上限。通常の dodgeMax(0.32) は回避職の identity として超える
 *  が、ここで頭打ちにして「絶対に当たらない」化を防ぐ (レビュー ★★: かくれみ 0.75 と積んで 0.9 化する
 *  懸念への対処)。数値は sim 前提の暫定値。 */
const EVASION_PASSIVE_CAP = 0.55;
/** 回避を bonus ぶん底上げするが EVASION_PASSIVE_CAP を超えさせない。ただし既に cap 超の高回避は
 *  下げない (max 保護: パッシブが既存の高回避状態を弱めてはならない)。 */
function boostDodge(dodge: number, bonus: number): number {
  return Math.max(dodge, Math.min(EVASION_PASSIVE_CAP, dodge + bonus));
}

/**
 * パッシブレジストリ (ジョブ innate な常時フック。docs/25 §12 の各職 Lv30)。エンジンは
 * hooksOf でこれを状態異常と同じフック点に流すだけ (専用分岐なし)。フック実装済みの9職を
 * ここで登録 (基本7職 + onLethal 追加で覇王/不動)。onIncomingMagic (清き心)・属性シナジー (慧眼)・
 * 対象状態参照 (審美眼)・MP消費割引 (発明家)・非戦闘 (巫女の直感/名演) は追加フック待ちで後続 (#483)。
 */
export const PASSIVES: Record<string, PassiveDef> = {
  // 忍者 首狩り: 自分より明確に弱い敵 (メタル除く) を luk 補正つき低確率で一撃 (§7/§12 Lv30)。
  // isWeaker は maxHp 比で判定 (中ボス/敵は maxHp が高く成立しない = 事故ワンパン防止)。
  kubikari: {
    id: 'kubikari',
    name: '首狩り',
    onHit(atk, def, ctx) {
      if (def.resistAllMagic) return; // メタル系は即死無効 (高防御ザコの存在意義)
      if (def.maxHp > atk.maxHp * 0.6) return; // 明確に格下でなければ発動しない
      const chance = Math.min(0.35, Math.max(0.05, 0.2 + (atk.luk - def.luk) * 0.004));
      if (ctx.rng() < chance) return { instakill: true };
    },
  },
  // 魔法使い 魔力障壁: 常時被ダメ軽減 (§12「常時10-20%軽減」→ ×0.85)。脆い大砲の生存補助。
  'mage-barrier': {
    id: 'mage-barrier',
    name: '魔力障壁',
    incomingCalc: (power) => power * 0.85,
  },
  // 戦士 剣豪: 会心率↑ (§12 Lv30)。critCalc は bool なので rng で確率的に会心へ引き上げる。
  // 注: base 会心が外れたときだけ ctx.rng() を追加 1 消費する (短絡評価)。剣豪持ちの戦士は同 seed でも
  // 乱数系列が変わるが、client/edge とも同じ playerCombatant でパッシブを再導出するため replay は一致。
  'warrior-blademaster': {
    id: 'warrior-blademaster',
    name: '剣豪',
    critCalc: (willCrit, _c, ctx) => willCrit || ctx.rng() < 0.15,
  },
  // 隊長 名将: 常時 atk/def +10% (§12 Lv30)。攻撃は powerCalc ×1.1、被弾は incomingCalc ×0.9。
  'captain-command': {
    id: 'captain-command',
    name: '名将',
    powerCalc: (power) => power * 1.1,
    incomingCalc: (power) => power * 0.9,
  },
  // 予言者 全知: 常時回避↑ (§12 Lv30)。低 agi を補い「当たらなければどうということはない」型。
  // 回避職の identity として通常の回避上限 (dodgeMax=0.32) は意図的に超えるが、EVASION_PASSIVE_CAP
  // で頭打ちにし「絶対当たらない」化は防ぐ。既に上限超の高回避 (将来のかくれみ等) は下げない (max 保護)。
  'seer-omniscience': {
    id: 'seer-omniscience',
    name: '全知',
    dodgeCalc: (dodge) => boostDodge(dodge, 0.15),
  },
  // 冒険者 旅の勘: 回避↑ (§12 Lv30 の戦闘部分。ドロップ↑/逃走↑は非戦闘のため別途)。
  'explorer-instinct': {
    id: 'explorer-instinct',
    name: '旅の勘',
    dodgeCalc: (dodge) => boostDodge(dodge, 0.12),
  },
  // 詩人 詩心: 自己バフ中 与ダメ↑ (§12 Lv30)。バフ orbiter 型の詩人が撃つときだけ乗る。
  'poet-muse': {
    id: 'poet-muse',
    name: '詩心',
    powerCalc: (power, c) => (hasSelfBuff(c) ? power * 1.25 : power),
  },
  // 将軍 覇王: 物理致死をHP1で耐え、受けた分を攻撃者へ反射 (§12 Lv30)。**1 戦闘 1 回だけ**の切り札
  // (オーナー判断 2026-07-22: 毎回発動だと敵が物理のみの現状で対モンスター完全不死になるため)。魔法致死は
  // doAttack を通らず耐えられない (int28 の魔法耐性で対キャスターを補う設計)。2 回目以降の物理致死は普通に死ぬ。
  'shogun-overlord': {
    id: 'shogun-overlord',
    name: '覇王',
    onLethal(self, atk, damage, ctx) {
      if (self.lethalGuardUsed) return; // 発動済み: 2 回目の物理致死は耐えられない
      self.lethalGuardUsed = true;
      atk.hp = Math.max(0, atk.hp - damage); // 同ダメージ反射
      ctx.events.push({ actor: ctx.actor ?? 'player', text: `${self.name}は 覇王の意地で耐えた! ${atk.name}に ${damage} 反射!`, damage });
      return { survive: true };
    },
  },
  // 守護者 不動: 物理致死を **1 戦闘 1 回だけ確定で** HP1 耐える (§12 Lv30。オーナー判断 2026-07-22: 壁役の
  // capstone に 50% 運要素は噛み合わないため確定 1 回に。once-per-battle で対モンスター完全不死も防ぐ)。反射なし。
  'guardian-immovable': {
    id: 'guardian-immovable',
    name: '不動',
    onLethal(self, _atk, _damage, ctx) {
      if (self.lethalGuardUsed) return; // 発動済み: 2 回目の物理致死は耐えられない
      self.lethalGuardUsed = true;
      ctx.events.push({ actor: ctx.actor ?? 'player', text: `${self.name}は 不動の構えで持ちこたえた!` });
      return { survive: true };
    },
  },
};

/** 状態付与時の告知テキスト (対象名の後に続ける)。プレイヤーが状態変化を認識できるように
 *  (無告知だと忍者のかくれみ/九字切り等が「何も起きていない」ように見える。レビュー ★★)。 */
const STATUS_APPLY_TEXT: Record<StatusId, string> = {
  poison: 'は毒におかされた!',
  sleep: 'は眠ってしまった!',
  stun: 'は麻痺した!',
  tumble: 'は転倒した!',
  restraint: 'は束縛された!',
  hidden: 'は かくれみ に身を隠した!',
  critCharge: 'は精神を研ぎ澄ませた!',
  atkUp: 'の攻撃力があがった!',
  atkDown: 'の攻撃力がさがった!',
  defUp: 'の守備力があがった!',
  defDown: 'の守備力がさがった!',
  agiUp: 'の素早さがあがった!',
  agiDown: 'の素早さがさがった!',
  doomMark: 'に 破滅の刻印が刻まれた…!',
  thorns: 'は とげの盾をかまえた!',
  ironWall: 'は 仁王立ちした! (被ダメージ激減)',
  accDown: 'の命中が下がった!',
};

/** 状態付与の告知文 (対象名 + テキスト)。 */
export function statusApplyText(id: StatusId, targetName: string): string {
  return `${targetName}${STATUS_APPLY_TEXT[id]}`;
}

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

/** 命中補正 (c=攻撃側)。accDown で hitBonus を下げる。 */
export function applyModifyHit(hitBonus: number, c: Combatant, ctx: HookCtx): number {
  let v = hitBonus;
  for (const { def, inst } of hooksOf(c)) v = def.modifyHit?.(v, c, ctxFor(ctx, inst)) ?? v;
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

/** 物理被弾後: 被弾側のフック (とげの盾) を回す (攻撃者へ反射など)。 */
export function applyOnDamaged(c: Combatant, atk: Combatant, damage: number, ctx: HookCtx): void {
  for (const { def, inst } of hooksOf(c)) def.onDamaged?.(c, atk, damage, ctxFor(ctx, inst));
}

/** 物理致死の直前: 被弾側のフック (覇王/不動) を回し、いずれかが survive を返したら true (HP1 生存)。
 *  反射等の攻撃者への副作用はハンドラ内で atk を操作する (ここでは生存可否だけ集約)。複数の onLethal
 *  が共存する場合は全ハンドラが走る (副作用も全部発火) — 現状 1 職 1 パッシブなので単一発火。 */
export function applyOnLethal(c: Combatant, atk: Combatant, damage: number, ctx: HookCtx): boolean {
  let survive = false;
  for (const { def, inst } of hooksOf(c)) {
    if (def.onLethal?.(c, atk, damage, ctxFor(ctx, inst))?.survive) survive = true;
  }
  return survive;
}

/** 命中時: いずれかのパッシブ/状態が即死を返したら true。 */
export function applyOnHit(atk: Combatant, def_: Combatant, ctx: HookCtx): boolean {
  let kill = false;
  for (const { def, inst } of hooksOf(atk)) {
    if (def.onHit?.(atk, def_, ctxFor(ctx, inst))?.instakill) kill = true;
  }
  return kill;
}

/** ターン終了: turnEnd フック (毒等) → turns-- → 0 で除去。生存者のみ turnEnd を受ける。
 *  付与された当ターン (fresh) は turnEnd・減衰をスキップし fresh を畳む (次ターンから効き始める)。 */
export function tickStatuses(c: Combatant, ctx: HookCtx): void {
  if (!c.statuses || c.statuses.length === 0) return;
  for (const inst of c.statuses) {
    if (c.hp <= 0) break;
    if (inst.fresh) continue; // 付与ターンは turnEnd を発火しない (毒は次ターンから)
    STATUS_REGISTRY[inst.id]?.turnEnd?.(c, ctxFor(ctx, inst));
  }
  for (const inst of c.statuses) {
    if (inst.fresh) {
      inst.fresh = false; // 付与ターンの tick は「消費」せず fresh だけ畳む
      continue;
    }
    inst.turns -= 1;
  }
  c.statuses = c.statuses.filter((s) => s.turns > 0);
}

/**
 * clearOnAct 状態を一律除去するユーティリティ。
 *
 * **非推奨 (resolveTurn では使わない)**: 「行動したら即消す」は、行動中に付与した自己バフ
 * (かくれみ/九字切りを張る等) まで同ターンに消してしまう。resolveTurn は行動前スナップショット
 * (`consumedOnAct`) 方式で「前ターンから持ち越した clearOnAct のみ消費」する。この関数は
 * clearOnAct セマンティクスの単体テスト用途にのみ残す。
 */
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
      existing.fresh = true; // 再付与も当ターンは効かせ始めない (直感的な turns 意味を維持)
      return;
    }
    // stack: 別インスタンスとして追加
  }
  c.statuses.push({ ...inst, fresh: true });
}
