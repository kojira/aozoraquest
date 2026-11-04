/**
 * **アイテムと装備を管理者 PDS のレコードで差し替える** (#420)。
 *
 * モンスター (#419 / monster-data.ts) と同じ流儀:
 * - `ITEMS` / `EQUIPMENT` / `EQUIPMENT_BY_ID` は多数の箇所から import されているので、
 *   **参照を保ったまま中身を差し替える**。呼び出し側は無変更
 * - フォールバックは `レコード ?? コード直書き`。読めなくてもゲームは止まらない
 * - **壊れた 1 件で全体を落とす** (部分適用しない)
 */
import { ITEMS } from './battle.js';
import { type ItemDef } from './battle-monsters.js';
import { STATUS_REGISTRY } from './statuses.js';
import type { SkillEffect } from './skills.js';
import { EQUIPMENT, EQUIPMENT_BY_ID, JOB_EQUIP_KINDS, type EquipmentDef } from './equipment.js';
import { JOBS_BY_ID } from './jobs.js';
import { characterTokenIssue } from './character-data.js';

export class ItemDataError extends Error {}

/** どうぐ・素材 1 件 (ITEMS の 1 エントリ)。key = **だいじなもの** (ひきとってもらえず、負けても失わない)。
 *  desc / price / shopTier / battle は戦闘用のどうぐ・店で買える品だけ (D-ITEM-001)。 */
export interface ItemDefData extends ItemDef {
  id: string;
}

/** 保存レコードの形。 */
export interface ItemsRecord {
  items: ItemDefData[];
  equipment: EquipmentDef[];
  updatedAt: string;
}

const baselineItems: ReadonlyArray<ItemDefData> = Object.entries(ITEMS).map(([id, v]) => ({ id, ...v }));
const baselineEquipment: readonly EquipmentDef[] = EQUIPMENT.map((e) => ({ ...e }));

let overridden = false;

export function hasItemOverrides(): boolean {
  return overridden;
}

const SLOTS = ['weapon', 'shield', 'head', 'armor', 'feet', 'charm'] as const;
const KINDS = new Set<string>([
  'common', 'cloth', 'charm', 'exclusive',
  ...new Set(Object.values(JOB_EQUIP_KINDS).flat()),
]);
const BONUS_KEYS = new Set(['atk', 'def', 'agi', 'int', 'luk', 'maxHp']);

/**
 * 検証して差し替える。`null` でコード直書きへ戻す。
 * どうぐと装備は**同じレコードで一緒に**差し替える (別々だと片方だけ古い、が起きる)。
 */
export function setItemOverrides(rec: { items: readonly ItemDefData[]; equipment: readonly EquipmentDef[] } | null): void {
  const items = rec === null ? baselineItems : validateItems(rec.items);
  const equipment = rec === null ? baselineEquipment : validateEquipment(rec.equipment);

  for (const k of Object.keys(ITEMS)) delete ITEMS[k];
  for (const { id, ...def } of items) ITEMS[id] = def;

  (EQUIPMENT as EquipmentDef[]).splice(0, EQUIPMENT.length, ...equipment.map((e) => ({ ...e })));
  for (const k of Object.keys(EQUIPMENT_BY_ID)) delete EQUIPMENT_BY_ID[k];
  for (const e of EQUIPMENT) EQUIPMENT_BY_ID[e.id] = e;

  overridden = rec !== null;
}

function validateItems(items: readonly ItemDefData[]): readonly ItemDefData[] {
  const ids = new Set<string>();
  for (const it of items) {
    if (!it || typeof it.id !== 'string' || it.id.trim() === '') throw new ItemDataError('どうぐの id が空');
    if (ids.has(it.id)) throw new ItemDataError(`どうぐの id が重複 (${it.id})`);
    ids.add(it.id);
    if (typeof it.name !== 'string' || it.name.trim() === '') throw new ItemDataError(`${it.id}: 名前が空`);
    const issue = characterTokenIssue(it.name);
    if (issue) throw new ItemDataError(`${it.id}: 名前の${issue}`);
    validateItemShopAndBattle(it);
  }
  return items;
}

const ITEM_DESC_MAX = 60;
/** どうぐに使える効果と、その効果で使える target (damage は使う人の攻撃力、recoil は反動なので不可)。 */
const ITEM_EFFECT_TARGETS: Partial<Record<SkillEffect['kind'], readonly (string | undefined)[]>> = {
  status: ['self', 'enemy', 'allEnemies', 'allAllies'],
  heal: [undefined, 'self', 'allAllies'],
  cleanse: ['self', 'allAllies'],
  restoreMp: [undefined],
  fixedDamage: [undefined, 'oneEnemy', 'allEnemies'],
};

/** 店で買える品と戦闘で使えるどうぐの欄 (D-ITEM-001 §1)。 */
function validateItemShopAndBattle(it: ItemDefData): void {
  const where = it.id;
  if (it.desc !== undefined && (typeof it.desc !== 'string' || it.desc.length > ITEM_DESC_MAX)) {
    throw new ItemDataError(`${where}: desc は ${ITEM_DESC_MAX} 字まで`);
  }
  if (it.price !== undefined) {
    const p = it.price;
    if (!p || !Number.isInteger(p.power) || p.power < 0 || !Number.isInteger(p.materials) || p.materials < 0) {
      throw new ItemDataError(`${where}: price が不正`);
    }
  }
  if (it.shopTier !== undefined && ![1, 2, 3].includes(it.shopTier)) throw new ItemDataError(`${where}: shopTier は 1〜3`);
  if (it.battle === undefined) return;
  if (it.key) throw new ItemDataError(`${where}: だいじなもの (key) は戦闘で使えない`);
  const effects = it.battle?.effects;
  if (!Array.isArray(effects) || effects.length === 0) throw new ItemDataError(`${where}: battle.effects が空`);
  for (const e of effects) {
    const targets = e ? ITEM_EFFECT_TARGETS[e.kind] : undefined;
    if (!targets) throw new ItemDataError(`${where}: どうぐに使えない効果 (${e?.kind})`);
    if (!targets.includes((e as { target?: string }).target)) throw new ItemDataError(`${where}: ${e.kind} の target が不正`);
    if (e.kind === 'status') {
      if (!(e.status in STATUS_REGISTRY)) throw new ItemDataError(`${where}: 状態が不正 (${e.status})`);
      if (e.chance !== undefined && !(e.chance >= 0 && e.chance <= 1)) throw new ItemDataError(`${where}: chance は 0〜1`);
      if (e.turns !== undefined && !(Number.isInteger(e.turns) && e.turns >= 1 && e.turns <= 5)) throw new ItemDataError(`${where}: turns は 1〜5`);
      if (e.magnitude !== undefined && !Number.isFinite(e.magnitude)) throw new ItemDataError(`${where}: magnitude が数値でない`);
      if (e.magIntBonus !== undefined) throw new ItemDataError(`${where}: magIntBonus はどうぐに使えない`);
    } else if (e.kind === 'heal' || e.kind === 'restoreMp') {
      if (!(e.ratio > 0 && e.ratio <= 1)) throw new ItemDataError(`${where}: ratio は 0〜1`);
    } else if (e.kind === 'fixedDamage') {
      if (!(Number.isFinite(e.min) && Number.isFinite(e.max) && e.min >= 0 && e.max >= e.min)) throw new ItemDataError(`${where}: min/max が不正`);
    }
  }
}

function validateEquipment(defs: readonly EquipmentDef[]): readonly EquipmentDef[] {
  if (defs.length === 0) throw new ItemDataError('装備が 0 品');
  const ids = new Set<string>();
  for (const e of defs) {
    const where = e?.id ?? '(id なし)';
    if (!e || typeof e.id !== 'string' || e.id.trim() === '') throw new ItemDataError('装備の id が空');
    if (ids.has(e.id)) throw new ItemDataError(`装備の id が重複 (${e.id})`);
    ids.add(e.id);
    if (typeof e.name !== 'string' || e.name.trim() === '') throw new ItemDataError(`${where}: 名前が空`);
    if (!(SLOTS as readonly string[]).includes(e.slot)) throw new ItemDataError(`${where}: slot が不正 (${e.slot})`);
    if (e.hands !== undefined) {
      if (e.hands !== 1 && e.hands !== 2) throw new ItemDataError(`${where}: hands は 1 か 2`);
      if (e.slot !== 'weapon' && e.slot !== 'shield') throw new ItemDataError(`${where}: hands は武器と盾だけ`);
    }
    if (!KINDS.has(e.kind)) throw new ItemDataError(`${where}: kind が不正 (${e.kind})`);
    if (![1, 2, 3].includes(e.grade)) throw new ItemDataError(`${where}: grade は 1〜3 (${e.grade})`);
    if (!e.price || !(e.price.power >= 0) || !(e.price.materials >= 0)) {
      throw new ItemDataError(`${where}: price が不正`);
    }
    if (!e.bonus || typeof e.bonus !== 'object') throw new ItemDataError(`${where}: bonus が不正`);
    for (const [k, v] of Object.entries(e.bonus)) {
      if (!BONUS_KEYS.has(k)) throw new ItemDataError(`${where}: bonus に不正なキー (${k})`);
      if (typeof v !== 'number' || !Number.isFinite(v)) throw new ItemDataError(`${where}: bonus.${k} が数値でない`);
    }
    if (e.jobOnly !== undefined && !(e.jobOnly in JOBS_BY_ID)) {
      throw new ItemDataError(`${where}: jobOnly が不正 (${e.jobOnly})`);
    }
    // **exclusive なのに jobOnly が無い品は誰も装備できない** (canEquip が安全側に倒す)。
    // 静かに死に筋を作らないよう保存で弾く。
    if (e.kind === 'exclusive' && !e.jobOnly) throw new ItemDataError(`${where}: exclusive には jobOnly が要る`);
  }
  return defs;
}

/** エディタ用: 現在有効などうぐ一覧 (差し替え前ならコード直書き)。**全部の欄を返す** —
 *  名前だけだと、エディタで開いて保存したときに key・battle・price などが消える (#854)。
 *  エディタが書き換えても ITEMS が変わらないよう、複製して返す。 */
export function activeItems(): ItemDefData[] {
  return Object.entries(ITEMS).map(([id, v]) => structuredClone({ id, ...v }));
}

/** エディタ用: 現在有効な装備一覧。 */
export function activeEquipment(): readonly EquipmentDef[] {
  return EQUIPMENT;
}
