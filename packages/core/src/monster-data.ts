/**
 * **モンスターは管理者 PDS のレコードだけが正** (#419 / #537 / D-MONSTER-001)。
 *
 * コードにはゲームのモンスターを持たない (二重管理をやめる)。`MONSTERS` は空の器で始まり、
 * 読み込み (`loadAdminWorld` → `setMonsterOverrides`) が中身を入れる。レコードも
 * キャッシュも無ければ 0 体のままで、戦闘は起きない (遭遇は飛ばし、移動は止めない)。
 *
 * ## 適用のしかた
 *
 * `MONSTERS` / `MONSTERS_BY_ID` は 14 箇所以上から import されている。呼び出し側を
 * 全部書き換える代わりに、**配列/オブジェクトの参照を保ったまま中身を差し替える**
 * (`splice` / キーの入れ替え)。`MAX_POPULATED_TIER` は ESM の live binding で更新される。
 *
 * 空にするのは `clearMonsters()` だけ (検証は 0 体を拒否するので `setMonsterOverrides` では空にできない)。
 */
import {
  MONSTERS,
  MONSTERS_BY_ID,
  recomputeMaxPopulatedTier,
  type MonsterDef,
  type Tier,
} from './battle.js';

import { characterTokenIssue } from './character-data.js';
import { STATUS_REGISTRY } from './statuses.js';
import { ELEMENT_LABELS } from './elements.js';

export class MonsterDataError extends Error {}

/** ability として受け付ける id (#537 論点 1: 列挙にとどめる。実装は core に残す)。 */
const ABILITIES = ['charger', 'healer', 'fleer', 'caster', 'debuffer', 'selfDestruct'] as const;
/** debuffs の数の上限 (D-PARTY-002 §12a: 弱体 1 つと自分への強化 1 つまで)。 */
const MAX_DEBUFFS = 2;
const MOVE_TARGETS = ['one', 'all'];

/**
 * 全モンスターを検証して差し替える。
 *
 * **壊れた 1 体で全体を落とす** — 部分適用すると、どの敵が落ちたのか誰にも分からず、
 * 「いるはずの敵が出ない」を追えなくなる (マップの流儀と同じ)。
 */
export function setMonsterOverrides(defs: readonly MonsterDef[]): void {
  replaceMonsters(validate(defs));
}

/** 0 体に戻す (テストの後片付けと、検証のための一時適用を「何も無かった」状態へ戻すとき)。 */
export function clearMonsters(): void {
  replaceMonsters([]);
}

function replaceMonsters(next: readonly MonsterDef[]): void {
  (MONSTERS as MonsterDef[]).splice(0, MONSTERS.length, ...next.map((m) => ({ ...m })));
  for (const k of Object.keys(MONSTERS_BY_ID)) delete MONSTERS_BY_ID[k];
  for (const m of MONSTERS) MONSTERS_BY_ID[m.id] = m;
  recomputeMaxPopulatedTier();
}

import type { PatternStep } from './battle-boss-pattern.js';
const PATTERN_MOVES = ['attack', 'cast', 'debuff', 'heal', 'strike', 'smash', 'drain'];
/** ボスの型 (D-ENDGAME-001)。大技 (smash・drain) には前ぶれが要り、前ぶれは手ごとにちがう文。
 *  戦いのはじめの手には前ぶれを出せないので、はじめの段の列の 1 手めは前ぶれの要らない手 (tell なし) にする。 */
function validatePatternSets(m: MonsterDef, where: string): void {
  const sets = m.patternSets!;
  if (!Array.isArray(sets) || sets.length === 0) throw new MonsterDataError(`${where}: patternSets が空`);
  const tellOf = new Map<string, string>();
  let below = 1;
  sets.forEach((ps, k) => {
    if (k > 0 && !(typeof ps.below === 'number' && ps.below > 0 && ps.below < below)) throw new MonsterDataError(`${where}: patternSets[${k}].below は前の段より小さい 0〜1`);
    if (k > 0) below = ps.below!;
    if (!Array.isArray(ps.patterns) || ps.patterns.length === 0 || ps.patterns.length > 3) throw new MonsterDataError(`${where}: patternSets[${k}].patterns は 1〜3 通り`);
    for (const p of ps.patterns) {
      if (!(typeof p.weight === 'number' && p.weight > 0)) throw new MonsterDataError(`${where}: pattern の weight は正の数`);
      if (!Array.isArray(p.steps) || p.steps.length < 2) throw new MonsterDataError(`${where}: pattern の steps は 2 手以上`);
      (p.steps as readonly PatternStep[]).forEach((st, i) => {
        if (!PATTERN_MOVES.includes(st.move)) throw new MonsterDataError(`${where}: pattern の move が不正 (${st.move})`);
        if (st.move === 'debuff' && !m.debuffs?.[st.index ?? 0]) throw new MonsterDataError(`${where}: pattern の debuff の index が無い`);
        if (st.move === 'cast' && !m.spell) throw new MonsterDataError(`${where}: pattern の cast には spell が要る`);
        if (st.target !== undefined && !['one', 'all', 'mate'].includes(st.target)) throw new MonsterDataError(`${where}: pattern の target が不正 (${st.target})`);
        const big = st.move === 'strike' || st.move === 'smash' || st.move === 'drain';
        if (big && !st.tell) throw new MonsterDataError(`${where}: 大技 (${st.name ?? st.move}) には tell (前ぶれ) が要る`);
        if (st.tell && k === 0 && i === 0) throw new MonsterDataError(`${where}: はじめの段の 1 手めは前ぶれの要らない手にする (戦いの頭には前ぶれが出せない)`);
        if (st.tell) { const key = `${st.move}:${st.name ?? ''}`; const seen = tellOf.get(st.tell); if (seen && seen !== key) throw new MonsterDataError(`${where}: ちがう手に同じ前ぶれ (${st.tell})`); tellOf.set(st.tell, key); }
        for (const t of [st.name ?? '', st.tell ?? '']) { const issue = characterTokenIssue(t); if (issue) throw new MonsterDataError(`${where}: ${issue}`); }
      });
    }
    if (ps.say) { const issue = characterTokenIssue(ps.say); if (issue) throw new MonsterDataError(`${where}: ${issue}`); }
  });
}

function validate(defs: readonly MonsterDef[]): readonly MonsterDef[] {
  if (defs.length === 0) throw new MonsterDataError('モンスターが 0 体');
  const ids = new Set<string>();
  for (const m of defs) {
    const where = `${m?.id ?? '(id なし)'}`;
    if (!m || typeof m.id !== 'string' || m.id.trim() === '') throw new MonsterDataError('id が空');
    if (ids.has(m.id)) throw new MonsterDataError(`id が重複 (${m.id})`);
    ids.add(m.id);
    if (typeof m.name !== 'string' || m.name.trim() === '') throw new MonsterDataError(`${where}: 名前が空`);
    for (const t of [m.name, m.intro ?? '']) { const issue = characterTokenIssue(t); if (issue) throw new MonsterDataError(`${where}: ${issue}`); }
    if (typeof m.species !== 'string' || m.species.trim() === '') throw new MonsterDataError(`${where}: species が空`);
    if (!Number.isInteger(m.tier) || m.tier < 1 || m.tier > 8) throw new MonsterDataError(`${where}: tier が不正 (${m.tier})`);
    if (!Array.isArray(m.stats) || m.stats.length !== 5 || m.stats.some((v) => typeof v !== 'number' || !Number.isFinite(v) || v < 0)) {
      throw new MonsterDataError(`${where}: stats が不正`);
    }
    // **hp は必須。** 省略時の導出フォールバックは「書き忘れで意図しない HP/XP になる」ため
    // テストで到達不能に固定されている (battle.test)。レコード経由でも同じ規律を守る。
    if (typeof m.hp !== 'number' || !(m.hp > 0)) throw new MonsterDataError(`${where}: hp が必須 (正の数)`);
    if (!Array.isArray(m.drops)) throw new MonsterDataError(`${where}: drops が不正`);
    for (const d of m.drops) {
      if (!d || typeof d.item !== 'string' || typeof d.chance !== 'number' || d.chance < 0 || d.chance > 1) {
        throw new MonsterDataError(`${where}: drop が不正`);
      }
    }
    if (m.gearDrop !== undefined) {
      const g = m.gearDrop;
      // 品の実在と「貴重な装備か」は保存の検査 (preciousIssue)。モンスターは どうぐ より先に読むので、ここでは形だけ。
      if (!g || typeof g.equipment !== 'string' || g.equipment.trim() === '' || !Number.isInteger(g.permille) || g.permille < 1 || g.permille > 1000) {
        throw new MonsterDataError(`${where}: gearDrop は {equipment, permille 1〜1000 の整数}`);
      }
    }
    if (m.ability !== undefined && !(ABILITIES as readonly string[]).includes(m.ability)) {
      throw new MonsterDataError(`${where}: ability が不正 (${m.ability})`);
    }
    if (m.abilities !== undefined) {
      if (!Array.isArray(m.abilities) || m.abilities.length === 0) {
        throw new MonsterDataError(`${where}: abilities が不正 (空にするなら省略する)`);
      }
      for (const a of m.abilities) {
        if (!(ABILITIES as readonly string[]).includes(a)) throw new MonsterDataError(`${where}: abilities に不正な id (${a})`);
      }
      if (new Set(m.abilities).size !== m.abilities.length) {
        throw new MonsterDataError(`${where}: abilities が重複している`);
      }
    }
    const hasCaster = m.ability === 'caster' || (m.abilities ?? []).includes('caster');
    if (hasCaster && !m.spell) throw new MonsterDataError(`${where}: caster には spell が要る`);
    const hasDebuffer = m.ability === 'debuffer' || (m.abilities ?? []).includes('debuffer');
    if (hasDebuffer && !m.debuffs?.length) throw new MonsterDataError(`${where}: debuffer には debuffs が要る`);
    if (m.debuffs !== undefined) {
      if (!Array.isArray(m.debuffs) || m.debuffs.length === 0 || m.debuffs.length > MAX_DEBUFFS) throw new MonsterDataError(`${where}: debuffs は 1〜${MAX_DEBUFFS} 個`);
      for (const d of m.debuffs) {
        if (!d || typeof d.name !== 'string' || d.name.trim() === '') throw new MonsterDataError(`${where}: debuffs の name が空`);
        if (!(d.status in STATUS_REGISTRY)) throw new MonsterDataError(`${where}: debuffs の status が不正 (${d.status})`);
        if (!(typeof d.chance === 'number' && d.chance >= 0 && d.chance <= 1)) throw new MonsterDataError(`${where}: debuffs の chance は 0〜1`);
        if (!(Number.isInteger(d.turns) && d.turns >= 1 && d.turns <= 5)) throw new MonsterDataError(`${where}: debuffs の turns は 1〜5`);
        if (d.magnitude !== undefined && !(typeof d.magnitude === 'number' && Number.isFinite(d.magnitude))) throw new MonsterDataError(`${where}: debuffs の magnitude が数値でない`);
        if (d.target !== undefined && ![...MOVE_TARGETS, 'self', 'allies'].includes(d.target)) throw new MonsterDataError(`${where}: debuffs の target が不正 (${d.target})`);
      }
    }
    const hasSelfDestruct = m.ability === 'selfDestruct' || (m.abilities ?? []).includes('selfDestruct');
    if (hasSelfDestruct && !m.selfDestruct) throw new MonsterDataError(`${where}: selfDestruct の能力には selfDestruct (name・tell) が要る`);
    if (m.selfDestruct !== undefined) {
      const sd = m.selfDestruct;
      if (!sd || typeof sd.name !== 'string' || sd.name.trim() === '' || typeof sd.tell !== 'string' || sd.tell.trim() === '') throw new MonsterDataError(`${where}: selfDestruct の name・tell が空`);
      if (sd.below !== undefined && !(typeof sd.below === 'number' && sd.below > 0 && sd.below < 1)) throw new MonsterDataError(`${where}: selfDestruct の below は 0〜1`);
      if (sd.power !== undefined && !(typeof sd.power === 'number' && sd.power > 0 && sd.power <= 5)) throw new MonsterDataError(`${where}: selfDestruct の power は 0〜5`);
    }
    if (m.immune !== undefined) {
      if (!Array.isArray(m.immune) || m.immune.length === 0 || m.immune.some((e) => !(e in ELEMENT_LABELS))) throw new MonsterDataError(`${where}: immune に不正な属性`);
      if (new Set(m.immune).size !== m.immune.length) throw new MonsterDataError(`${where}: immune が重複している`);
    }
    if (m.patternSets !== undefined) validatePatternSets(m, where);
    if (m.chargedTarget !== undefined && !MOVE_TARGETS.includes(m.chargedTarget)) throw new MonsterDataError(`${where}: chargedTarget が不正 (${m.chargedTarget})`);
    if (m.healRatio !== undefined && !(m.healRatio > 0 && m.healRatio <= 1)) {
      throw new MonsterDataError(`${where}: healRatio は 0〜1 (${m.healRatio})`);
    }
    if (m.healAmount !== undefined && !(Number.isInteger(m.healAmount) && m.healAmount > 0)) {
      throw new MonsterDataError(`${where}: healAmount は正の整数 (${m.healAmount})`);
    }
    if (m.abilityParams) {
      for (const [k, v] of Object.entries(m.abilityParams)) {
        if (v !== undefined && !(typeof v === 'number' && v >= 0 && v <= 1)) {
          throw new MonsterDataError(`${where}: abilityParams.${k} は 0〜1 (${v})`);
        }
      }
    }
    if (m.statusResist !== undefined) {
      if (!Array.isArray(m.statusResist) || m.statusResist.some((id) => !(id in STATUS_REGISTRY))) throw new MonsterDataError(`${where}: statusResist に不正な状態`);
      if (new Set(m.statusResist).size !== m.statusResist.length) throw new MonsterDataError(`${where}: statusResist が重複している`);
    }
    if (m.storyOnly !== undefined && typeof m.storyOnly !== 'boolean') throw new MonsterDataError(`${where}: storyOnly が真偽値でない`);
    if (m.spell) {
      const sp = m.spell as { name?: unknown; min?: unknown; max?: unknown; target?: unknown };
      if (typeof sp.name !== 'string' || typeof sp.min !== 'number' || typeof sp.max !== 'number' || (sp.min as number) > (sp.max as number)) {
        throw new MonsterDataError(`${where}: spell が不正 (name/min/max)`);
      }
      if (sp.target !== undefined && !MOVE_TARGETS.includes(sp.target as string)) throw new MonsterDataError(`${where}: spell の target が不正 (${String(sp.target)})`);
    }
  }
  // **tier1 は 3 体を下回れない。** spawn 近辺のプールが痩せると summonMonster が
  // 選べる敵を失い、move が 500 になってその街から出られなくなる (既知の事故経路)。
  // ストーリー専用の敵はランダム遭遇に出ないので数えない (D-STORY-009)。
  const tier1 = defs.filter((m) => m.tier === 1 && !m.storyOnly).length;
  if (tier1 < 3) throw new MonsterDataError(`tier1 が ${tier1} 体 (3 体未満は遭遇が壊れる)`);
  return defs;
}

/** エディタが一覧を読むため (常に現在有効な敵。読み込み前は 0 体)。 */
export function activeMonsters(): readonly MonsterDef[] {
  return MONSTERS;
}

/** 保存レコードの形。 */
export interface MonstersRecord {
  monsters: MonsterDef[];
  updatedAt: string;
}

/** tier ごとの頭数 (エディタの検証表示用)。 */
export function monsterCountByTier(defs: readonly MonsterDef[] = MONSTERS): Partial<Record<Tier, number>> {
  const out: Partial<Record<Tier, number>> = {};
  for (const m of defs) out[m.tier] = (out[m.tier] ?? 0) + 1;
  return out;
}
