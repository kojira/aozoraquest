/**
 * **シナリオ (イベント列 + フラグ)** (#545 / #426)。世界に筋書きを入れる。
 *
 * オーナー判断で粒度は **(a) イベント列**。「条件が揃ったら何が起きる」を並べ、
 * NPC のセリフ・クエストの解禁をフラグでゲートする。選択肢つき会話ツリー (b) や
 * 章立てによる地域解禁 (c) は、この土台の上に後から乗る。
 *
 * ## フラグが単一の進行状態
 *
 * 進行は `GameState.flags` (文字列の集合) だけで表す。**フラグを立てるのは
 * サーバー (edge)** — 条件の判定も付与も権威側でやる (client の自己申告で
 * 章が進むと、クエスト解禁も報酬も破られる)。
 *
 * ## 条件はサーバーが検証できるものだけ
 *
 * - questDone: そのクエストを達成済み
 * - flag / notFlag: 別のフラグの有無 (章の順序はこれで表す)
 * - jobLevel: そのジョブが指定 Lv 以上
 * - itemCount: 素材を指定個数以上持っている
 *
 * 「特定の場所に行った」は位置を毎ターン見る必要があるので入れていない
 * (必要になったら move の権威経路で拾う)。
 *
 * ## 結果もデータで表せるものだけ
 *
 * - flag: フラグを立てる (これが本体。NPC/クエストの出し分けが変わる)
 * - notice: 一度だけ出すお知らせ (「東の橋が直ったらしい」)
 *
 * ネタバレを避けるため、定義は**コードでなく管理者 PDS** (`world.scenario`) に置く
 * (モンスター #419 と同じ流儀)。
 */
import { gameQuestById } from './quest-data.js';
import { ITEMS } from './battle.js';
import { JOBS_BY_ID } from './jobs.js';
import type { Archetype } from './types.js';

export class ScenarioError extends Error {}

export type ScenarioCondition =
  | { kind: 'questDone'; questId: string }
  | { kind: 'flag'; flag: string }
  | { kind: 'notFlag'; flag: string }
  | { kind: 'jobLevel'; job: Archetype; level: number }
  | { kind: 'itemCount'; itemId: string; count: number };

export interface ScenarioEvent {
  id: string;
  /** 管理画面での見出し (プレイヤーには出ない)。 */
  title: string;
  /** **すべて**満たしたら発火する (AND)。空なら即発火 = 開始直後のイベント。 */
  when: ScenarioCondition[];
  /** 発火で立てるフラグ。 */
  setFlags: string[];
  /** 発火時に一度だけ出すお知らせ (省略可)。 */
  notice?: string;
}

export interface ScenarioRecord {
  events: ScenarioEvent[];
  updatedAt: string;
}

export const MAX_SCENARIO_EVENTS = 200;
export const MAX_FLAGS = 500;
export const MAX_NOTICE_LEN = 120;
/** フラグ名に使える文字 (レコードのキーや UI で扱いやすい範囲に絞る)。 */
const FLAG_RE = /^[a-z0-9][a-z0-9_-]{0,47}$/;

/** フラグ名として使えるか。クエストの解禁・NPC の分岐も同じ書式で検証する
 *  (書式が揃っていないと、typo したフラグが永久に立たない設定を無言で作れる)。 */
export function isFlagName(v: unknown): v is string {
  return typeof v === 'string' && FLAG_RE.test(v);
}

let events: ScenarioEvent[] = [];

/**
 * イベント定義を差し替える。`null` で全解除。
 * **壊れた 1 件で全体を落とす** (部分適用しない。他エディタと同じ流儀)。
 *
 * questId の実在を見るので、**クエスト (#423) を読んだ後に呼ぶ**こと。
 */
export function setScenario(list: readonly ScenarioEvent[] | null): void {
  const next = list ?? [];
  if (next.length > MAX_SCENARIO_EVENTS) throw new ScenarioError(`イベントが多すぎる (${next.length} > ${MAX_SCENARIO_EVENTS})`);
  const ids = new Set<string>();
  for (const e of next) {
    const where = e?.id ?? '(id なし)';
    if (!e || typeof e.id !== 'string' || e.id.trim() === '') throw new ScenarioError('イベントの id が空');
    if (ids.has(e.id)) throw new ScenarioError(`イベントの id が重複 (${e.id})`);
    ids.add(e.id);
    if (typeof e.title !== 'string' || e.title.trim() === '') throw new ScenarioError(`${where}: タイトルが空`);
    if (!Array.isArray(e.when)) throw new ScenarioError(`${where}: 条件が配列でない`);
    for (const c of e.when) {
      if (!c) throw new ScenarioError(`${where}: 条件が空`);
      switch (c.kind) {
        case 'questDone':
          if (!gameQuestById(c.questId)) throw new ScenarioError(`${where}: クエストが存在しない (${c.questId})`);
          break;
        case 'flag':
        case 'notFlag':
          if (!FLAG_RE.test(c.flag)) throw new ScenarioError(`${where}: フラグ名が不正 (${c.flag})`);
          break;
        case 'jobLevel':
          if (!JOBS_BY_ID[c.job]) throw new ScenarioError(`${where}: ジョブが存在しない (${c.job})`);
          if (!Number.isInteger(c.level) || c.level < 1 || c.level > 99) throw new ScenarioError(`${where}: レベルは 1〜99`);
          break;
        case 'itemCount':
          if (!ITEMS[c.itemId]) throw new ScenarioError(`${where}: アイテムが存在しない (${c.itemId})`);
          if (!Number.isInteger(c.count) || c.count < 1) throw new ScenarioError(`${where}: 個数は 1 以上`);
          break;
        default:
          throw new ScenarioError(`${where}: 条件の種類が不正`);
      }
    }
    if (!Array.isArray(e.setFlags) || e.setFlags.length === 0) throw new ScenarioError(`${where}: 立てるフラグが無い`);
    for (const f of e.setFlags) {
      if (!FLAG_RE.test(f)) throw new ScenarioError(`${where}: フラグ名が不正 (${f})`);
    }
    if (e.notice !== undefined && (typeof e.notice !== 'string' || e.notice.trim() === '' || e.notice.length > MAX_NOTICE_LEN)) {
      throw new ScenarioError(`${where}: お知らせが不正 (${MAX_NOTICE_LEN} 文字まで)`);
    }
    // **自分が立てるフラグを自分の条件にしない** (一度発火したら二度と成立しない
    // イベントになり、書いた人の意図とほぼ確実に食い違う)。
    for (const c of e.when) {
      if (c.kind === 'flag' && e.setFlags.includes(c.flag)) throw new ScenarioError(`${where}: 自分が立てるフラグを条件にしている (${c.flag})`);
    }
  }
  // **総フラグ数を保存時に弾く。** pendingScenario は上限で古いフラグを切り捨てるが、
  // 捨てられたフラグのイベントは「未発火」に戻り、条件を満たす限り毎回再発火して
  // お知らせが出続ける。定義側で超えさせないのが唯一の確実な防ぎ方。
  const allFlags = new Set(next.flatMap((e) => e.setFlags));
  if (allFlags.size > MAX_FLAGS) throw new ScenarioError(`フラグが多すぎる (${allFlags.size} > ${MAX_FLAGS})`);
  events = next.map((e) => ({ ...e, when: e.when.map((c) => ({ ...c })), setFlags: [...e.setFlags] }));
}

/** 全イベント (エディタ・判定用)。 */
export function scenarioEvents(): readonly ScenarioEvent[] {
  return events;
}

/** 判定に渡す進行状況 (edge の GameState から作る)。 */
export interface ScenarioProgress {
  flags: readonly string[];
  questsDone: readonly string[];
  jobXpLevels: Readonly<Record<string, number>>;
  materials: Readonly<Record<string, number>>;
}

function meets(c: ScenarioCondition, p: ScenarioProgress): boolean {
  switch (c.kind) {
    case 'questDone': return p.questsDone.includes(c.questId);
    case 'flag': return p.flags.includes(c.flag);
    case 'notFlag': return !p.flags.includes(c.flag);
    case 'jobLevel': return (p.jobXpLevels[c.job] ?? 0) >= c.level;
    case 'itemCount': return (p.materials[c.itemId] ?? 0) >= c.count;
  }
}

/**
 * 今の進行で新しく発火するイベントを返す。**既に全フラグが立っているものは出さない**
 * (毎回同じお知らせが出るのを防ぐ)。
 *
 * 連鎖 (A が立てたフラグで B が発火) も 1 回の呼び出しで解決する — そうしないと
 * 「1 歩歩くごとに 1 段ずつ進む」という不自然な出方になる。
 */
export function pendingScenario(p: ScenarioProgress): { fired: ScenarioEvent[]; flags: string[] } {
  const flags = new Set(p.flags);
  const fired: ScenarioEvent[] = [];
  // 連鎖の解決。イベント数を上限にすれば、どんな依存関係でも必ず止まる
  // (フラグは増える一方なので、1 周で 1 つも発火しなければそこで終わり)。
  for (let round = 0; round < events.length; round++) {
    // **1 周ぶんはこの周の開始時点のフラグで判定する。** 直前に立ったフラグを
    // 即座に反映すると、`notFlag` のイベントが「同じ回に条件を満たした別のイベント」に
    // 潰される (「章が進む前だけ見られる話」が定義の並び順で発火したりしなかったり
    // する)。まとめて発火 → 次の周で連鎖、なら順序に依存しない。
    const snapshot: ScenarioProgress = { ...p, flags: [...flags] };
    const firedThisRound: ScenarioEvent[] = [];
    for (const e of events) {
      if (fired.includes(e)) continue;
      // 全部のフラグが既に立っている = 発火済み。
      if (e.setFlags.every((f) => flags.has(f))) continue;
      if (!e.when.every((c) => meets(c, snapshot))) continue;
      firedThisRound.push(e);
    }
    if (firedThisRound.length === 0) break;
    for (const e of firedThisRound) {
      fired.push(e);
      for (const f of e.setFlags) flags.add(f);
    }
  }
  return { fired, flags: [...flags].slice(-MAX_FLAGS) };
}

/** そのフラグ条件を満たしているか (NPC のセリフ出し分け等、表示側の判定に使う)。 */
export function flagsSatisfied(required: readonly string[] | undefined, forbidden: readonly string[] | undefined, flags: readonly string[]): boolean {
  if (required?.some((f) => !flags.includes(f))) return false;
  if (forbidden?.some((f) => flags.includes(f))) return false;
  return true;
}
