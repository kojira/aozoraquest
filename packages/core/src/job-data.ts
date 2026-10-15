/**
 * **ジョブのパラメータ上書き** (#544)。エディタで数値を触れるようにする。
 *
 * 数値 (ステータス比・たいりょく・レベル曲線・装備適性) は編集できるが、
 * **とくぎ・パッシブの効果は編集できない** — 効果は `EFFECT_HANDLERS` の関数で、
 * データにするには DSL が要る (モンスター能力 #537 と同じ論点。必要になってから)。
 *
 * 保存先は管理者 PDS の `world.jobs` (モンスター #419・アイテム #420 と同じ流儀)。
 * **edge も読む** — 戦闘計算は edge が権威なので、web だけが編集後のジョブを見ていると
 * 画面の強さとサーバーの強さが食い違う。
 *
 * ## 参照を保ったまま差し替える
 *
 * `JOBS` / `JOBS_BY_ID` / `JOB_LEVEL_PACE` / `JOB_EQUIP_KINDS` は各所が
 * import 時に掴んでいるので、**中身を書き換える** (再代入しない)。
 * 診断 (`archetype-pair`) や表示も同じオブジェクトを見ているため、上書きは全経路に効く。
 */
import { JOBS, JOBS_BY_ID } from './jobs.js';
import { JOB_LEVEL_PACE } from './tuning.js';
import { JOB_EQUIP_KINDS, type EquipKind } from './equipment.js';
import type { Archetype, JobDefinition, StatArray } from './types.js';

export class JobDataError extends Error {}

/** 1 職ぶんの上書き。指定したフィールドだけ差し替える (未指定はコード値のまま)。 */
export interface JobOverride {
  id: Archetype;
  /** [atk, def, agi, int, luk]。**合計 100** (診断の比率としての意味を保つ)。 */
  stats?: StatArray;
  /** たいりょく (HP の元)。 */
  vit?: number;
  /** レベル曲線の係数。小さいほど早く上がる。 */
  pace?: number;
  /** 装備できるカテゴリ。 */
  equipKinds?: EquipKind[];
}

export interface JobsRecord {
  jobs: JobOverride[];
  updatedAt: string;
}

/** stats 合計の許容 (丸め誤差を吸収。ズレると診断の比率が壊れる)。 */
export const JOB_STATS_SUM = 100;
export const MIN_VIT = 1;
export const MAX_VIT = 99;
/** pace の範囲。0 以下や極端な値は XP 曲線を壊す (0 で除算・レベルが動かない)。 */
export const MIN_PACE = 0.1;
export const MAX_PACE = 5;

const KNOWN_KINDS = new Set<string>(['common', 'exclusive', 'sword', 'axe', 'shield', 'dagger', 'staff', 'lucky', 'heavy', 'light', 'robe', 'cloth', 'charm']);

/** コード直書きの値 (上書きを解除するときに戻す先)。最初の setJobOverrides で撮る。 */
let baseline: Map<Archetype, { stats: StatArray; vit: number; pace: number; equipKinds: readonly EquipKind[] }> | null = null;

function snapshot(): void {
  if (baseline) return;
  baseline = new Map(
    JOBS.map((j) => [
      j.id,
      {
        stats: [...j.stats] as StatArray,
        vit: j.vit,
        pace: JOB_LEVEL_PACE[j.id] ?? 1,
        equipKinds: [...JOB_EQUIP_KINDS[j.id]],
      },
    ]),
  );
}

/**
 * 上書きを適用する。`null` で全解除 (コード値へ戻す)。
 * **壊れた 1 件で全体を落とす** (部分適用しない。他エディタと同じ流儀)。
 */
export function setJobOverrides(list: readonly JobOverride[] | null): void {
  snapshot();
  const seen = new Set<string>();
  for (const o of list ?? []) {
    const where = o?.id ?? '(id なし)';
    if (!o || !JOBS_BY_ID[o.id]) throw new JobDataError(`ジョブが存在しない (${where})`);
    if (seen.has(o.id)) throw new JobDataError(`ジョブの上書きが重複 (${where})`);
    seen.add(o.id);
    if (o.stats !== undefined) {
      if (!Array.isArray(o.stats) || o.stats.length !== 5) throw new JobDataError(`${where}: stats は 5 要素`);
      for (const v of o.stats) {
        if (!Number.isFinite(v) || v < 0) throw new JobDataError(`${where}: stats に負や非数がある`);
      }
      const sum = o.stats.reduce((a, b) => a + b, 0);
      // 合計 100 を崩すと**職間の強さの物差しが消える** (全部 999 にすれば最強になる)。
      if (Math.abs(sum - JOB_STATS_SUM) > 0.01) throw new JobDataError(`${where}: stats の合計は ${JOB_STATS_SUM} (いまは ${sum})`);
    }
    if (o.vit !== undefined && (!Number.isFinite(o.vit) || o.vit < MIN_VIT || o.vit > MAX_VIT)) {
      throw new JobDataError(`${where}: たいりょくは ${MIN_VIT}〜${MAX_VIT}`);
    }
    if (o.pace !== undefined && (!Number.isFinite(o.pace) || o.pace < MIN_PACE || o.pace > MAX_PACE)) {
      throw new JobDataError(`${where}: レベル曲線は ${MIN_PACE}〜${MAX_PACE}`);
    }
    if (o.equipKinds !== undefined) {
      if (!Array.isArray(o.equipKinds)) throw new JobDataError(`${where}: equipKinds が配列でない`);
      for (const k of o.equipKinds) {
        if (!KNOWN_KINDS.has(k)) throw new JobDataError(`${where}: 未知の装備カテゴリ (${k})`);
      }
    }
  }

  // 検証を全部通してから適用する (途中で落ちて半分だけ効いた状態を作らない)。
  const byId = new Map((list ?? []).map((o) => [o.id, o]));
  for (const job of JOBS) {
    const base = baseline!.get(job.id)!;
    const o = byId.get(job.id);
    const m = job as JobDefinition; // 中身だけ書き換える (配列の参照は保つ)
    m.stats = [...(o?.stats ?? base.stats)] as StatArray;
    m.vit = o?.vit ?? base.vit;
    JOB_LEVEL_PACE[job.id] = o?.pace ?? base.pace;
    (JOB_EQUIP_KINDS as Record<Archetype, readonly EquipKind[]>)[job.id] = [...(o?.equipKinds ?? base.equipKinds)];
  }
}

/**
 * **コード値と違うところだけ**を上書き形式で返す (#544 レビュー ★★)。
 *
 * 全職のフル値を保存すると、後日コード側で `JOB_LEVEL_PACE` を引き直しても
 * レコードが常に勝って**恒久的に無視される** (tuning.ts の pace は計測条件が
 * 変われば引き直す前提のデータなので、実際に踏む)。差分だけ保存すれば、
 * 触っていない職はコードの再調整がそのまま効く。
 */
export function jobOverridesDiff(params: readonly JobOverride[]): JobOverride[] {
  snapshot();
  const out: JobOverride[] = [];
  for (const p of params) {
    const base = baseline!.get(p.id);
    if (!base) continue;
    const o: JobOverride = { id: p.id };
    if (p.stats && p.stats.some((v, i) => v !== base.stats[i])) o.stats = [...p.stats] as StatArray;
    if (p.vit !== undefined && p.vit !== base.vit) o.vit = p.vit;
    if (p.pace !== undefined && p.pace !== base.pace) o.pace = p.pace;
    if (p.equipKinds && (p.equipKinds.length !== base.equipKinds.length || p.equipKinds.some((k, i) => k !== base.equipKinds[i]))) {
      o.equipKinds = [...p.equipKinds];
    }
    if (Object.keys(o).length > 1) out.push(o);
  }
  return out;
}

/** エディタ用: 現在値をそのまま上書き形式で読み出す (コード値 + 適用済みの上書き)。 */
export function currentJobParams(): JobOverride[] {
  return JOBS.map((j) => ({
    id: j.id,
    stats: [...j.stats] as StatArray,
    vit: j.vit,
    pace: JOB_LEVEL_PACE[j.id] ?? 1,
    equipKinds: [...JOB_EQUIP_KINDS[j.id]],
  }));
}
