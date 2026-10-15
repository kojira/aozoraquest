/**
 * 戦闘参加者 (Combatant) とプレイヤーの戦闘値・レベルアップ差分。
 * (battle.ts から責務ごとに分割。公開 API は battle.ts から再エクスポート)
 */

import { type Archetype, type StatArray } from './types.js';
import { JOBS_BY_ID } from './jobs.js';
import { gearBonus, gearBonusFromGear, type GearBonus, type GearSelection } from './equipment.js';
import { type Element } from './elements.js';
import { type StatusInstance } from './statuses.js';
import { BATTLE_TUNING } from './battle-tuning.js';
import { jobPassives } from './battle-job-skills.js';

// ─── 戦闘参加者 ─────────────────────────────────────────────

export interface Combatant {
  name: string;
  maxHp: number;
  hp: number;
  /** MP。特技で消費。プレイヤーは MP 特性 (JOB_MP_TRAITS) を持つジョブのみ回復。
   *  モンスターも int から MP を持ち (fromStats)、ため/回復の特技コストに使う
   *  (尽きると通常攻撃に落ちる = 資源の読み合い)。 */
  maxMp: number;
  mp: number;
  atk: number;
  def: number;
  agi: number;
  int: number;
  luk: number;
  /** たいりょく (#518)。**HP の元になるだけで、命中/ダメージ式には出てこない**表示用の値。
   *  「HP がなぜその数字なのか」をプレイヤーに見せるために持つ。
   *  モンスターは 0 (プレイヤーのステータス画面でしか使わない)。 */
  vit: number;
  /** このターン防御中 (被ダメ半減) */
  guarding: boolean;
  /** 見切り (parry) 構え中: 防御 + 被弾時に反撃 */
  parrying: boolean;
  /** ため中 (モンスター用): 次ターンに chargedPower のため攻撃を放つ。
   *  予告が出るので、プレイヤーは防御で応じるのが正解 (防御の存在意義)。 */
  charging: boolean;
  /** ぼうぎょの余韻 (残りターン数)。>0 の間は回避 +guardFocusDodge。
   *  防御した次のターンまで「相手の動きを読めている」状態。 */
  focus: number;
  /** **守備が桁違い (メタル系)**。`MonsterDef.flatDef` を持つ敵だけに立つ。
   *  この旗が立っている相手にだけ「ダメージ 0」が起きてよい (かすりダメージの対象外。
   *  BATTLE_TUNING.scratchRatio 参照)。 */
  ironDef?: boolean;
  /** 状態異常 (#452 / docs/25 §3)。省略可 (旧 sealed state 互換)。エンジンが空/未定義を no-op 扱い。 */
  statuses?: StatusInstance[];
  /** ジョブ innate パッシブ id (#452 / docs/25 §4)。省略可。 */
  passives?: string[];
  /** 防御属性 (#452 / docs/25 §1)。被弾時の属性相性に使う。未設定 (無属性) は等倍。
   *  モンスターへの付与は #455 (monsterCombatant で def.element から)、プレイヤー装備由来は後続。 */
  element?: Element;
  /** すべての魔法を無効化 (メタル系。#455)。true だと fixedDamage/doMagic が最小 1。 */
  resistAllMagic?: boolean;
  /** onLethal (覇王/不動) を戦闘中に発動済みか (#456)。物理致死を耐える切り札は 1 戦闘 1 回のみ。
   *  playerCombatant で毎戦闘 undefined から始まり、初回発動でハンドラが true にする。 */
  lethalGuardUsed?: boolean;
  /** モンスター個体の def id (#453 マルチ戦闘で敵ごとに ability/spell を引くため)。プレイヤー/召喚は未設定。
   *  monsterCombatant が def.id を載せる。1v1 では state.monsterId と一致する。 */
  monsterId?: string;
}

/** stats と HP/MP から Combatant を組む。HP/MP の導出は呼び出し側の責務 (プレイヤーと
 *  モンスターで式が違うため — #518)。 */
export function makeCombatant(name: string, stats: StatArray, maxHp: number, maxMp: number, vit = 0): Combatant {
  const [atk, def, agi, int, luk] = stats;
  return {
    name,
    maxHp,
    hp: maxHp,
    maxMp,
    mp: maxMp,
    atk,
    def,
    agi,
    int,
    luk,
    vit,
    guarding: false,
    parrying: false,
    charging: false,
    focus: 0,
    statuses: [],
    passives: [],
  };
}

/** モンスターの戦闘値。stats は tier 係数の**乗算**でスケールする (プレイヤーとは別式)。
 *  HP/MP は MonsterDef の明示値 (全モンスターが持つ) を使い、無い場合だけ def/int から導出。 */
export function monsterStats(stats: StatArray, tierFactor: number): StatArray {
  // モンスターは防具を持たないので def にも下駄を掛ける (プレイヤーとの非対称は statFloor 参照)。
  // 下駄はモンスター専用の小さい値 (monsterStatFloor) — 詳細はその doc を参照 (#536)。
  const s = (v: number) => Math.round(BATTLE_TUNING.monsterStatFloor + v * tierFactor);
  return [s(stats[0]), s(stats[1]), s(stats[2]), s(stats[3]), s(stats[4])];
}

/**
 * 装備の平坦ボーナスを 1 箇所で解決する (#511)。**gear (GearSelection) と equipIds が両方来たら
 * gear を優先し equipIds は無視する** — 両方を加算すると同じ装備が二重に効くため (実測: def 15 →
 * 単一 17 → 両方 19)。gear がアプリ本則 (強化値つき個体)、equipIds は sim 用の簡易形。
 * どちらも無ければ null (呼び出し側は加算をスキップ)。
 */
function gearFlatBonus(archetype: Archetype, equipIds?: readonly string[], gear?: GearSelection): GearBonus | null {
  // 「中身のある方」を採る。空の gear ({}) で equipIds を無視すると、両方渡した呼び出しで装備が
  // 黙って消える (実測 def 17 → 15)。空判定を equipIds 側と対称にしてこの罠を構造的に潰す。
  if (gear && Object.keys(gear).length > 0) return gearBonusFromGear(archetype, gear);
  if (equipIds && equipIds.length > 0) return gearBonus(archetype, equipIds);
  return null;
}

/**
 * 成長式の**単一の出所** (#520)。`playerCombatant` (丸めて Combatant にする) と
 * `playerStatsAt` (丸めずに上昇量表示に使う) の両方がこれを使う。
 *
 * 以前は同じ規則を 2 箇所で別々に書いており (配列リテラルの index1 別扱い / `i === 1` の三項)、
 * 片方だけ直す事故が実際に起きた (#518 の実装中に playerStatsAt 側へ statFloor を入れ忘れ、
 * 「丸めの点まで同期している」テストが検出)。表現を 1 つにして構造的に防ぐ。
 *
 * 式の意味は docs/19-overworld.md §6.4.5 を参照。
 */
function growthOf(archetype: Archetype, jobLevel: number, baseStats?: StatArray) {
  const t = BATTLE_TUNING;
  const job = JOBS_BY_ID[archetype].stats;
  // 個人 rpgStats はジョブ基準値とブレンドして使う (baseStatsPersonalWeight)。
  // 個人値 100% は極端プロフィールで勝率 0〜100% に割れる (issue #279)。
  const w = t.baseStatsPersonalWeight;
  const base: StatArray = baseStats
    ? [
        job[0] + (baseStats[0] - job[0]) * w,
        job[1] + (baseStats[1] - job[1]) * w,
        job[2] + (baseStats[2] - job[2]) * w,
        job[3] + (baseStats[3] - job[3]) * w,
        job[4] + (baseStats[4] - job[4]) * w,
      ]
    : job;
  const lv = Math.max(0, jobLevel - 1);
  const gr = t.statBase + t.statGrow * lv;
  const dr = t.defBase + t.defGrow * lv;
  /** 5 ステータスの生値。**まもり (index 1) だけ statFloor 無し・def 系統の伸び率** — 守備は
   *  防具が主役という設計を下駄で薄めないため (docs/19 §6.4.5)。 */
  const stat = (i: 0 | 1 | 2 | 3 | 4): number => (i === 1 ? base[i]! * dr : t.statFloor + base[i]! * gr);
  return {
    stat,
    /** たいりょく。**丸めた値**を返す — ステータス画面に出す たいりょく が HP を説明できる
     *  必要があるため (「たいりょく 4」なのに HP 13 では表示の意味が無い)。 */
    vit: Math.round(JOBS_BY_ID[archetype].vit * gr),
    /** MP の**生値** (装備ボーナス適用**前**の素の かしこさ 基準)。丸めるかどうかは呼び出し側が
     *  決める (playerCombatant だけが丸める)。`stat(3)` をそのまま使うので式は 1 つしかなく、
     *  `round(playerStatsAt.maxMp) === playerCombatant.maxMp` が `mpIntScale` の値に依らず
     *  構造的に成立する。 */
    maxMp: (): number => t.mpBase + stat(3) * t.mpIntScale,
  };
}

/**
 * プレイヤーの戦闘値を導出。
 * 基底 = **ジョブ基準値と個人 rpgStats (プロフィールの 5 パラメータ、合計 100) の
 * ブレンド** (baseStatsPersonalWeight = 0.5)。個人値 100% は診断の min-max 正規化で
 * 極端ビルドが常態化し勝率が 0〜100% に割れるため (issue #279)。未診断は
 * ジョブ基準値のみ。
 * レベル補正は `growthOf` が持つ (**ジョブ Lv のみ**。旧 flatLevelGain / levelScale による
 * プレイヤー Lv 追従は #507 で撤廃済み)。W4 のサーバー権威化ではこの関数を
 * Worker 側で同じ入力 (analysis レコード) から再導出する。
 */
export function playerCombatant(
  archetype: Archetype,
  jobLevel: number,
  playerLevel: number,
  displayName: string,
  baseStats?: StatArray,
  /** 装備中の装備 id 列 (EQUIPMENT)。丸めの後に平坦加算 (docs/20)。sim 用の簡易形。
   *  **gear を渡した場合は無視される** (下記 gearFlatBonus 参照 — 二重加算の防止)。 */
  equipIds?: readonly string[],
  /** 装備中の個体 (強化値つき)。アプリ本則はこちら (gear/self の解決結果)。equipIds より優先。 */
  gear?: GearSelection,
): Combatant {
  const t = BATTLE_TUNING;
  // **成長軸はジョブ Lv のみ** (#507)。プレイヤー Lv 由来の倍率・平坦加算は撤廃した
  // (同じ Lv1 賢者がプレイヤー Lv で HP 20→65 に変わる = 「その職の強さ」が定まらなかった)。
  void playerLevel; // 引数は呼び出し文脈として残す (強さには使わない。#507)
  const g = growthOf(archetype, jobLevel, baseStats);
  const grown: StatArray = [
    Math.round(g.stat(0)), Math.round(g.stat(1)), Math.round(g.stat(2)),
    Math.round(g.stat(3)), Math.round(g.stat(4)),
  ];
  // HP は たいりょく の 2 倍 (DQ 準拠)、MP は かしこさ から。**HP だけ丸めた たいりょく を
  // 基準にする** — 画面に出す たいりょく が HP を説明できる必要があるため (「たいりょく 4」
  // なのに HP 13 では表示の意味が無い)。MP は生値から丸めるので playerStatsAt と厳密に一致する。
  const c = makeCombatant(
    displayName,
    grown,
    Math.round(t.hpBase + g.vit * t.hpVitScale),
    Math.round(g.maxMp()), // grown[3] を使うと mpIntScale 非整数時に playerStatsAt と割れる
    g.vit,
  );
  const bonus = gearFlatBonus(archetype, equipIds, gear);
  if (bonus) {
    // 装備はすべての導出 (ブレンド・成長・丸め) の後に平坦加算 — 低ステータス
    // ほど相対効果が大きく「装備で差をつける」が成立する (docs/20)
    c.atk += bonus.atk;
    c.def += bonus.def;
    c.agi += bonus.agi;
    c.int += bonus.int;
    c.luk += bonus.luk;
    c.maxHp += bonus.maxHp;
    c.hp = c.maxHp;
  }
  c.passives = jobPassives(archetype, jobLevel); // ジョブ Lv30 の innate パッシブ
  return c;
}

/** 丸め前の戦闘ステータス (レベルアップの上昇量表示用)。 */
export interface CombatStatsRaw {
  atk: number;
  def: number;
  agi: number;
  int: number;
  luk: number;
  maxHp: number;
  maxMp: number;
}

/**
 * playerCombatant と同じ導出 (ブレンド + 平坦成長 + レベル係数) を **丸めずに** 返す。
 * レベルアップの上昇量は 1 レベルあたり +0.2〜1.5 程度の小数なので、丸めた
 * Combatant 同士の差分では 0 か 1 しか出ない。同期は「round(playerStatsAt) ==
 * playerCombatant」のテストで固定する。
 */
export function playerStatsAt(
  archetype: Archetype,
  jobLevel: number,
  playerLevel: number,
  baseStats?: StatArray,
  equipIds?: readonly string[],
  gear?: GearSelection,
): CombatStatsRaw {
  const t = BATTLE_TUNING;
  // playerCombatant と**同じ growthOf** を使う (#520)。違うのは丸めるかどうかだけで、
  // ここは丸める前の生値を返す (レベルアップの上昇量を小数 1 桁で見せるため)。
  void playerLevel; // 成長はジョブ Lv のみ (#507)
  const g = growthOf(archetype, jobLevel, baseStats);
  // 装備は gearFlatBonus で 1 箇所解決 (gear 優先・二重加算なし。#511)。playerCombatant と同じ規則。
  const bonus = gearFlatBonus(archetype, equipIds, gear);
  const eq = (k: 'atk' | 'def' | 'agi' | 'int' | 'luk' | 'maxHp') => bonus?.[k] ?? 0;
  return {
    atk: g.stat(0) + eq('atk'),
    def: g.stat(1) + eq('def'),
    agi: g.stat(2) + eq('agi'),
    int: g.stat(3) + eq('int'),
    luk: g.stat(4) + eq('luk'),
    // HP は playerCombatant と同じく丸めた たいりょく 基準 (画面表示との整合)。
    // MP は生値のまま — この関数の存在理由が「上昇量を小数 1 桁で見せる」ことなので、
    // ここで整数に量子化すると「毎レベル +1.5」が「+2 / +1」とガタつき、表示から MP 行が
    // 消えるケースも出る (レビューで実測 4,464/4,704 ケースが変化)。
    maxHp: t.hpBase + g.vit * t.hpVitScale + eq('maxHp'),
    maxMp: g.maxMp(),
  };
}

/** レベルアップの上昇量表示で、これ未満の上昇は出さない。 */
export const STAT_GAIN_MIN_DISPLAY = 0.1;

export interface StatGain {
  key: keyof CombatStatsRaw;
  /** 表示名 (DQ 風かな) */
  label: string;
  /** 上昇量 (小数 1 桁に丸め済み) */
  delta: number;
}

const STAT_GAIN_LABELS: Array<[keyof CombatStatsRaw, string]> = [
  ['maxHp', 'さいだいHP'],
  ['maxMp', 'さいだいMP'],
  ['atk', 'こうげき'],
  ['def', 'まもり'],
  ['agi', 'すばやさ'],
  ['int', 'かしこさ'],
  ['luk', 'うん'],
];

/**
 * レベルアップ (from → to) によるステータス上昇量。0.1 未満の上昇は出さない。
 * ジョブとプレイヤーが同時に上がった場合は呼び出し側が区間を分ける
 * (job: (jF,pF)→(jT,pF) / player: (jT,pF)→(jT,pT)) と二重計上しない。
 */
export function levelUpGains(
  archetype: Archetype,
  from: { jobLevel: number; playerLevel: number },
  to: { jobLevel: number; playerLevel: number },
  baseStats?: StatArray,
): StatGain[] {
  const a = playerStatsAt(archetype, from.jobLevel, from.playerLevel, baseStats);
  const b = playerStatsAt(archetype, to.jobLevel, to.playerLevel, baseStats);
  const gains: StatGain[] = [];
  for (const [key, label] of STAT_GAIN_LABELS) {
    // **画面に出るのは丸めた値なので、上昇量も丸めた差で出す。** 生値の差を小数 1 桁で
    // 出していたため「まもりが 0.4 あがった!」と言われてステータス画面を見ても
    // **何も変わっていない** (実測: 戦士 Lv1→2 まもり 表示 0.4 / 実差 0、Lv3→4
    // さいだいMP 表示 1.1 / 実差 2) という食い違いが起きていた。
    const delta = Math.round(b[key]) - Math.round(a[key]);
    if (delta < 1) continue; // 丸めて変わらない項目は出さない (嘘の行を作らない)
    gains.push({ key, label, delta });
  }
  return gains;
}

// StatVector → StatArray 変換は jobs.ts の statVectorToArray を使う (重複定義しない)。
