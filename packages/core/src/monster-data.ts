/**
 * **モンスターを管理者 PDS のレコードで差し替える** (#419 / #537)。
 *
 * `MONSTERS` はコード直書きで、リポジトリが公開なので**未実装の敵まで手の内が全部見える**
 * (ネタバレ)。データをレコードへ移し、エディタで編集できるようにする。
 *
 * ## 適用のしかた
 *
 * `MONSTERS` / `MONSTERS_BY_ID` は 14 箇所以上から import されている。呼び出し側を
 * 全部書き換える代わりに、**配列/オブジェクトの参照を保ったまま中身を差し替える**
 * (`splice` / キーの入れ替え)。`MAX_POPULATED_TIER` は ESM の live binding で更新される。
 *
 * ## フォールバック (戦闘を止めない)
 *
 * コード直書きの `MONSTERS` は**そのまま残し、レコードが読めたら差し替える**:
 *
 * ```
 * レコード (管理者 PDS) ?? コード直書き
 * ```
 *
 * 読めない/壊れていても今の敵で戦闘は続く。ネタバレ解消は移行完了後にコードから
 * 消した時点で達成される (それまでの二重管理は許容。レコード優先なので調整は
 * レコード側だけで効く)。
 */
import {
  MONSTERS,
  MONSTERS_BY_ID,
  recomputeMaxPopulatedTier,
  type MonsterDef,
  type Tier,
} from './battle.js';

export class MonsterDataError extends Error {}

/** ability として受け付ける id (#537 論点 1: 列挙にとどめる。実装は core に残す)。 */
const ABILITIES = ['charger', 'healer', 'fleer', 'caster'] as const;

/** 起動時 (コード直書き) の敵。解除 (`null`) でここへ戻す。 */
const baseline: readonly MonsterDef[] = MONSTERS.map((m) => ({ ...m }));

let overridden = false;

/** レコード由来の差し替えが効いているか。 */
export function hasMonsterOverrides(): boolean {
  return overridden;
}

/**
 * 全モンスターを検証して差し替える。`null` でコード直書きへ戻す。
 *
 * **壊れた 1 体で全体を落とす** — 部分適用すると、どの敵が落ちたのか誰にも分からず、
 * 「いるはずの敵が出ない」を追えなくなる (マップの流儀と同じ)。
 */
export function setMonsterOverrides(defs: readonly MonsterDef[] | null): void {
  const next = defs === null ? baseline : validate(defs);
  (MONSTERS as MonsterDef[]).splice(0, MONSTERS.length, ...next.map((m) => ({ ...m })));
  for (const k of Object.keys(MONSTERS_BY_ID)) delete MONSTERS_BY_ID[k];
  for (const m of MONSTERS) MONSTERS_BY_ID[m.id] = m;
  recomputeMaxPopulatedTier();
  overridden = defs !== null;
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
    if (m.ability !== undefined && !(ABILITIES as readonly string[]).includes(m.ability)) {
      throw new MonsterDataError(`${where}: ability が不正 (${m.ability})`);
    }
    if (m.ability === 'caster' && !m.spell) throw new MonsterDataError(`${where}: caster には spell が要る`);
    if (m.healRatio !== undefined && !(m.healRatio > 0 && m.healRatio <= 1)) {
      throw new MonsterDataError(`${where}: healRatio は 0〜1 (${m.healRatio})`);
    }
    if (m.spell) {
      const sp = m.spell as { name?: unknown; min?: unknown; max?: unknown };
      if (typeof sp.name !== 'string' || typeof sp.min !== 'number' || typeof sp.max !== 'number' || (sp.min as number) > (sp.max as number)) {
        throw new MonsterDataError(`${where}: spell が不正 (name/min/max)`);
      }
    }
  }
  // **tier1 は 3 体を下回れない。** spawn 近辺のプールが痩せると summonMonster が
  // 選べる敵を失い、move が 500 になってその街から出られなくなる (既知の事故経路)。
  const tier1 = defs.filter((m) => m.tier === 1).length;
  if (tier1 < 3) throw new MonsterDataError(`tier1 が ${tier1} 体 (3 体未満は遭遇が壊れる)`);
  return defs;
}

/** エディタが一覧を読むため (常に現在有効な敵。差し替え前ならコード直書き)。 */
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
