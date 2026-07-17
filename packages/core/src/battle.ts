/**
 * ブルスコンの試練 — バトルエンジン (docs/18-brusukon-trial.md)。
 *
 * ブルスコンが召喚した試練モンスターと 1 対 1 のターン制バトルを行う。
 * 1 戦 = あおぞらパワー 1 消費 (消費の記帳は web 側 points.ts / battle-log)。
 *
 * 設計方針:
 * - **決定的**: seed + コマンド列から結果が一意に決まる純関数エンジン。
 *   同じ seed で再生すれば同じ展開になる (テスト可能・記録の再現可能)。
 *   乱数はターン毎に hash(seed, turn) から作るので、state は JSON 化できる。
 * - **ジョブが戦い方に出る**: プレイヤーの戦闘値はジョブの 5 ステータス
 *   [atk, def, agi, int, luk] とレベルから導出。特技はジョブの支配ステータスで
 *   決まり (力型=強撃 / 守型=見切り / 速型=連撃 / 知型=魔撃 / 運型=大博打)、
 *   技名はジョブ固有。
 * - バランス値は本ファイルに集約 (BATTLE_TUNING)。
 */

import type { Archetype, StatArray } from './types.js';
import { JOBS_BY_ID } from './jobs.js';

// ─── チューニング ───────────────────────────────────────────

export const BATTLE_TUNING = {
  /** 1 戦のあおぞらパワー消費 */
  powerCost: 1,
  /** 勝利 XP (playerLevel/jobLevel 両方に加算する想定) */
  xpWin: 30,
  /** 敗北 XP (挑んだこと自体に少額) */
  xpLose: 5,
  /** HP = hpBase + def*hpDefScale + level*hpLevelScale */
  hpBase: 46,
  hpDefScale: 0.9,
  hpLevelScale: 2,
  /** レベルによるステータス補正 = 1 + (jobLv-1)*jobLevelScale + (playerLv-1)*playerLevelScale */
  jobLevelScale: 0.04,
  playerLevelScale: 0.015,
  /** プレイヤーの全ステータスに加わる平坦なレベル成長 (+flatLevelGain × (playerLv-1))。
   *  乗算補正だけだと低い値は低いままで「弱いジョブがレベルでちゃんと強くならない」
   *  (オーナー指摘 2026-07-17)。加算成長は低ステータスほど相対的に効く。 */
  flatLevelGain: 0.25,
  /** モンスターがプレイヤーの職業レベルを追いかける率 (jobLevelScale の半分)。
   *  0 だと jobLv20 で tier3 が全ポリシー 100% になり真剣勝負が作業化する。 */
  monsterJobChaseScale: 0.01,
  /** 個人 rpgStats とジョブ基準値のブレンド比 (0 = ジョブのみ / 1 = 個人のみ)。
   *  診断は min-max 正規化で全員が極端プロフィールになるため、個人値 100% だと
   *  atk 0〜80 のレンジになり勝率が 0〜100% に割れる (issue #279 実測)。
   *  50:50 でジョブの型を保ちつつ個人の傾きを乗せる。 */
  baseStatsPersonalWeight: 0.5,
  /** ダメージ = atk * roll(0.85..1.15) * damageScale / (damageSoften + def) */
  damageScale: 26,
  damageSoften: 14,
  /** 回避率 = clamp(base + (守る側agi - 攻める側agi)*agiDodgeScale, min, max) */
  dodgeBase: 0.04,
  agiDodgeScale: 0.006,
  dodgeMin: 0.02,
  dodgeMax: 0.25,
  /** クリティカル率 = critBase + luk*critLukScale (1.5 倍) */
  critBase: 0.04,
  critLukScale: 0.004,
  critMultiplier: 1.5,
  /** ぼうぎょ: 被ダメージ半減 */
  guardReduction: 0.5,
  /** ため攻撃 (tier2+ が 1 ターン予告してから放つ) の倍率。予告を見て防御するのが正解
   *  (2.6 → 防御で 1.3 まで軽減 = 節約 1.3 発分 > 機会費用の自攻撃 1 発分)。
   *  防御に存在意義を与える読み合いの核。バランステストで「予告に防御 > attack 連打」を固定。 */
  chargedPower: 2.6,
  /** MP: 特技のコスト。最大 MP = mpBase + int * mpIntScale (int 職は手数が多い)。
   *  戦闘中の MP 回復は **ジョブ特性 (JOB_MP_TRAITS) を持つジョブだけ** —
   *  全員一律の回復はジョブの差をぼやけさせる (オーナー決定 2026-07-17)。
   *  特性なしジョブは MP プール + そらのしずくでやりくりする。 */
  skillMpCost: 4,
  mpBase: 6,
  mpIntScale: 0.5,
  mpAttackGain: 0,
  mpGuardGain: 0,
  /** ぼうぎょの翌ターン回避ボーナス (身構えて相手の動きを読む)。 */
  guardFocusDodge: 0.15,
  /** やくそう: 使うと maxHp のこの割合を回復 (1 ターン消費)。持ち込み上限 herbCarryMax。
   *  0.4/3 個ではガード+薬草の tier3 勝率が 97% まで上がり真剣勝負が作業化した
   *  (レビューのシミュレーション実測) ため 0.3/2 個に抑制。天井はテストで固定。 */
  herbHealRatio: 0.3,
  herbCarryMax: 2,
  /** そらのしずく (MP 回復薬): maxMp のこの割合を回復。持ち込み上限 tonicCarryMax。 */
  tonicMpRatio: 0.5,
  tonicCarryMax: 2,
  /** にげる: 成功率 = clamp(fleeBase + (自agi − 敵agi) * fleeAgiScale, min, max)。
   *  失敗するとターンを失い敵の攻撃を受ける。成功してもパワーは返さない。 */
  fleeBase: 0.5,
  fleeAgiScale: 0.012,
  fleeMin: 0.25,
  fleeMax: 0.95,
  /** 最大ターン数 (超えたら判定 = 残 HP 割合勝負) */
  maxTurns: 30,
  /** ドロップ率の luk ボーナス = luk * dropLukScale (加算) */
  dropLukScale: 0.003,
  /** 敗北ペナルティ: 手持ち素材をランダムに落とす (オーナー決定 2026-07-18)。
   *  1 個は必ず落ち、以降は lossExtraBase − luk*lossExtraLukScale の確率で
   *  追加ドロップ (運が悪いと複数落ちる)。上限 lossMax。 */
  lossExtraBase: 0.35,
  lossExtraLukScale: 0.004,
  lossExtraMin: 0.05,
  lossMax: 3,
} as const;

// ─── 決定的乱数 (mulberry32) ────────────────────────────────

/** 32bit シードから [0,1) の決定的乱数列を作る。 */
export function createRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** seed とターン番号から、そのターン専用の乱数器を作る (state を JSON 化可能に保つ)。 */
export function turnRng(seed: number, turn: number): () => number {
  // 単純な混合 (定数は splitmix64 の黄金比由来)
  return createRng((seed ^ Math.imul(turn + 1, 0x9e3779b1)) >>> 0);
}

// ─── 特技 (ジョブの支配ステータスで決まる) ──────────────────

export type SkillKind = 'smash' | 'parry' | 'flurry' | 'spell' | 'gamble';

const STAT_TO_SKILL: readonly SkillKind[] = ['smash', 'parry', 'flurry', 'spell', 'gamble'];

/** ジョブ固有の特技名。kind はそのジョブの支配ステータスから導出。 */
export const JOB_SKILL_NAMES: Record<Archetype, string> = {
  sage: '天啓の一手',
  mage: '解式マギア',
  shogun: '号令一閃',
  bard: '即興のセレナーデ',
  seer: '未来視',
  poet: '心晴の韻',
  paladin: '聖光の誓い',
  explorer: '未踏の一歩',
  warrior: '鉄壁の構え',
  guardian: '大盾の護り',
  fighter: 'からくり仕掛け',
  artist: '色彩の閃き',
  captain: '突撃号令',
  miko: '神楽の祈り',
  ninja: '影分身',
  performer: '曲芸乱舞',
};

export interface JobSkill {
  kind: SkillKind;
  name: string;
}

/** ジョブの支配ステータス (最大値の軸) から特技種を決める。
 *  同値タイは後勝ち (statOrder 逆順)。現状タイは artist の def=luk=26 のみで、
 *  gamble になる (テストで固定)。技名「色彩の閃き」の趣も gamble であり、
 *  先勝ち (parry) だと防御空打ちしかできず tier3 で最弱に沈む (sim 実測 28%)。 */
export function skillForJob(archetype: Archetype): JobSkill {
  const stats = JOBS_BY_ID[archetype].stats;
  let maxI = 0;
  for (let i = 1; i < stats.length; i++) {
    if (stats[i]! >= stats[maxI]!) maxI = i;
  }
  return { kind: STAT_TO_SKILL[maxI]!, name: JOB_SKILL_NAMES[archetype] };
}

/** MP 回復のジョブ特性 (オーナー提案 2026-07-17「MP 回復はジョブの特別な要素に。
 *  強化して初期で弱いジョブに付ける。能力がジョブに合っているかも大事」)。
 *  **戦闘中に MP が回復するのは特性を持つジョブだけ** (全員一律の基本回復は
 *  「ジョブの差がぼやける」ためオーナー決定 2026-07-17 で廃止)。特性なしジョブは
 *  MP プール (int 由来) + そらのしずくでやりくりする。素の火力が低く特技依存に
 *  なるジョブ (luk/agi 型) に、世界観に沿った特性名で回復を与える。値は
 *  scripts/sim-battle-balance.ts の実測で調整。 */
export interface MpTrait {
  /** 特性名 (UI 表示用)。undefined = 特性なし (基本値) */
  name?: string;
  attackGain: number;
  guardGain: number;
}

export const JOB_MP_TRAITS: Partial<Record<Archetype, MpTrait>> = {
  bard: { name: '歌の余韻', attackGain: 3, guardGain: 4 },
  paladin: { name: '祈りの加護', attackGain: 3, guardGain: 4 },
  miko: { name: '神楽の集中', attackGain: 2, guardGain: 3 },
  poet: { name: '心晴の呼吸', attackGain: 2, guardGain: 3 },
  explorer: { name: '踏破の勘', attackGain: 2, guardGain: 3 },
  ninja: { name: '印の呼吸', attackGain: 2, guardGain: 3 },
  artist: { name: '色彩の集中', attackGain: 2, guardGain: 3 },
};

/** ジョブの MP 回復量 (特性がなければ基本値)。 */
export function mpGainsFor(archetype: Archetype): { attackGain: number; guardGain: number; traitName?: string } {
  const trait = JOB_MP_TRAITS[archetype];
  if (!trait) return { attackGain: BATTLE_TUNING.mpAttackGain, guardGain: BATTLE_TUNING.mpGuardGain };
  const r: { attackGain: number; guardGain: number; traitName?: string } = {
    attackGain: trait.attackGain,
    guardGain: trait.guardGain,
  };
  if (trait.name) r.traitName = trait.name;
  return r;
}

export const SKILL_KIND_LABELS: Record<SkillKind, string> = {
  smash: '強撃 (大ダメージ / 少し外れやすい)',
  parry: '見切り (防御 + 反撃)',
  flurry: '連撃 (2 回攻撃)',
  spell: '魔撃 (防御無視)',
  gamble: '大博打 (0〜2.6 倍)',
};

// ─── 戦闘参加者 ─────────────────────────────────────────────

export interface Combatant {
  name: string;
  maxHp: number;
  hp: number;
  /** MP (プレイヤー用)。特技で消費。戦闘中の回復は MP 特性 (JOB_MP_TRAITS) を持つ
   *  ジョブのみ (たたかう/ぼうぎょで回復)。モンスターは 0 固定
   *  (代わりに「ため」サイクルを持つ)。 */
  maxMp: number;
  mp: number;
  atk: number;
  def: number;
  agi: number;
  int: number;
  luk: number;
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
}

function fromStats(name: string, stats: StatArray, levelFactor: number, level: number): Combatant {
  const t = BATTLE_TUNING;
  const [atk, def, agi, int, luk] = stats;
  const s = (v: number) => Math.round(v * levelFactor);
  const maxHp = Math.round(t.hpBase + def * t.hpDefScale * levelFactor + level * t.hpLevelScale);
  const maxMp = Math.round(t.mpBase + int * t.mpIntScale * levelFactor);
  return {
    name,
    maxHp,
    hp: maxHp,
    maxMp,
    mp: maxMp,
    atk: s(atk),
    def: s(def),
    agi: s(agi),
    int: s(int),
    luk: s(luk),
    guarding: false,
    parrying: false,
    charging: false,
    focus: 0,
  };
}

/**
 * プレイヤーの戦闘値を導出。
 * 基底 = **ジョブ基準値と個人 rpgStats (プロフィールの 5 パラメータ、合計 100) の
 * ブレンド** (baseStatsPersonalWeight = 0.5)。個人値 100% は診断の min-max 正規化で
 * 極端ビルドが常態化し勝率が 0〜100% に割れるため (issue #279)。未診断は
 * ジョブ基準値のみ。
 * レベル補正 = 平坦加算 (+flatLevelGain × (playerLv−1)、レベル係数の乗算前に加算) の
 * 後に乗算 (jobLv/playerLv の levelScale)。W4 のサーバー権威化ではこの関数を
 * Worker 側で同じ入力 (analysis レコード) から再導出する。
 */
export function playerCombatant(
  archetype: Archetype,
  jobLevel: number,
  playerLevel: number,
  displayName: string,
  baseStats?: StatArray,
): Combatant {
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
  const factor = 1 + Math.max(0, jobLevel - 1) * t.jobLevelScale + Math.max(0, playerLevel - 1) * t.playerLevelScale;
  // 平坦なレベル成長 (プレイヤーのみ)。低ステータスほど相対的に効く
  const flat = t.flatLevelGain * Math.max(0, playerLevel - 1);
  const grown: StatArray = [base[0] + flat, base[1] + flat, base[2] + flat, base[3] + flat, base[4] + flat];
  return fromStats(displayName, grown, factor, playerLevel);
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
): CombatStatsRaw {
  const t = BATTLE_TUNING;
  const job = JOBS_BY_ID[archetype].stats;
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
  const factor = 1 + Math.max(0, jobLevel - 1) * t.jobLevelScale + Math.max(0, playerLevel - 1) * t.playerLevelScale;
  const flat = t.flatLevelGain * Math.max(0, playerLevel - 1);
  const g = (i: number) => (base[i]! + flat) * factor;
  return {
    atk: g(0),
    def: g(1),
    agi: g(2),
    int: g(3),
    luk: g(4),
    maxHp: t.hpBase + (base[1]! + flat) * t.hpDefScale * factor + playerLevel * t.hpLevelScale,
    maxMp: t.mpBase + (base[3]! + flat) * t.mpIntScale * factor,
  };
}

/** レベルアップの上昇量表示で、これ未満の上昇は出さない (オーナー指定 2026-07-17)。 */
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
    const raw = b[key] - a[key];
    if (raw < STAT_GAIN_MIN_DISPLAY) continue;
    gains.push({ key, label, delta: Math.round(raw * 10) / 10 });
  }
  return gains;
}

// StatVector → StatArray 変換は jobs.ts の statVectorToArray を使う (重複定義しない)。

// ─── モンスター ─────────────────────────────────────────────

/** SVG 描画のキー (UI 側が species ごとに絵を持つ)。 */
export type MonsterSpecies =
  | 'slime'
  | 'bat'
  | 'mushroom'
  | 'golem'
  | 'wisp'
  | 'serpent'
  | 'raven'
  | 'oni'
  | 'dragon';

export interface DropDef {
  /** 素材 ID (ITEMS のキー) */
  item: string;
  /** 基礎ドロップ率 (0..1)。luk で上振れ。 */
  chance: number;
}

export interface MonsterDef {
  id: string;
  name: string;
  species: MonsterSpecies;
  /** 試練の階級。1=手習い 2=修練 3=真剣勝負 */
  tier: 1 | 2 | 3;
  /** [atk, def, agi, int, luk] — 合計はおおむね 100 で職と同尺度 */
  stats: StatArray;
  drops: readonly DropDef[];
  /** ひとこと (召喚時の口上に使う) */
  intro: string;
  /** 強攻撃 (tier2+ の skill 行動) の技名。tier1 は skill を使わないので省略可。 */
  skillName?: string;
}

/** 素材カタログ (Step2 の装備素材)。 */
export const ITEMS: Record<string, { name: string }> = {
  herb: { name: 'やくそう' },
  'sky-dew': { name: 'そらのしずく' }, // MP 回復薬。青空の朝露 (世界観準拠の命名)
  'sky-feather': { name: 'そらのはね' }, // 最後に立ち寄った街へ帰還 (フィールド専用)
  'slime-drop': { name: 'スライムのしずく' },
  'bat-wing': { name: 'コウモリの翼膜' },
  'mush-spore': { name: 'ヒカリダケの胞子' },
  'golem-core': { name: 'ゴーレムの核片' },
  'wisp-ember': { name: '鬼火の残り火' },
  'serpent-scale': { name: '大蛇の鱗' },
  'raven-feather': { name: '夜鴉の風切羽' },
  'oni-horn': { name: '鬼の角' },
  'dragon-fang': { name: '竜の牙' },
};

export const MONSTERS: readonly MonsterDef[] = [
  // tier1: 手習い (初心者でも勝てる)
  { id: 'sky-slime', name: 'そらいろスライム', species: 'slime', tier: 1, stats: [14, 12, 10, 8, 16], drops: [{ item: 'slime-drop', chance: 0.7 }, { item: 'herb', chance: 0.35 }], intro: 'ぷるぷると跳ねている。' },
  { id: 'cave-bat', name: 'ほらあなコウモリ', species: 'bat', tier: 1, stats: [12, 8, 26, 6, 12], drops: [{ item: 'bat-wing', chance: 0.6 }, { item: 'herb', chance: 0.3 }, { item: 'sky-feather', chance: 0.12 }], intro: 'ばさばさと羽音を立てている。' },
  { id: 'glow-shroom', name: 'ヒカリダケ', species: 'mushroom', tier: 1, stats: [8, 20, 4, 18, 12], drops: [{ item: 'mush-spore', chance: 0.6 }, { item: 'herb', chance: 0.4 }, { item: 'sky-dew', chance: 0.25 }], intro: 'ほんのり光って動かない…?' },
  // tier2: 修練
  { id: 'moss-golem', name: 'こけむしゴーレム', species: 'golem', tier: 2, stats: [26, 36, 6, 10, 8], drops: [{ item: 'golem-core', chance: 0.5 }, { item: 'herb', chance: 0.2 }], intro: '地響きを立てて起き上がった。', skillName: 'いわなだれ' },
  { id: 'will-o-wisp', name: 'あおい鬼火', species: 'wisp', tier: 2, stats: [10, 12, 24, 34, 12], drops: [{ item: 'wisp-ember', chance: 0.5 }, { item: 'sky-dew', chance: 0.35 }], intro: 'ゆらゆらとこちらを見ている。', skillName: 'おにびのうず' },
  { id: 'river-serpent', name: 'かわながれ大蛇', species: 'serpent', tier: 2, stats: [30, 18, 22, 10, 10], drops: [{ item: 'serpent-scale', chance: 0.5 }, { item: 'herb', chance: 0.2 }], intro: '水面から鎌首をもたげた。', skillName: 'まきつき' },
  // tier3: 真剣勝負
  { id: 'night-raven', name: 'よるのおおガラス', species: 'raven', tier: 3, stats: [26, 14, 34, 16, 14], drops: [{ item: 'raven-feather', chance: 0.45 }, { item: 'sky-dew', chance: 0.3 }, { item: 'sky-feather', chance: 0.25 }], intro: '月を背に静かに舞い降りた。', skillName: 'かまいたち' },
  { id: 'blue-oni', name: 'あおおに', species: 'oni', tier: 3, stats: [40, 28, 12, 8, 12], drops: [{ item: 'oni-horn', chance: 0.45 }], intro: '金棒を担いで笑っている。', skillName: 'かなぼうふりまわし' },
  { id: 'sky-dragon', name: 'そらのりゅう', species: 'dragon', tier: 3, stats: [32, 24, 18, 26, 10], drops: [{ item: 'dragon-fang', chance: 0.4 }], intro: '雲を裂いて姿を現した!', skillName: 'ほのおのブレス' },
];

export const MONSTERS_BY_ID: Record<string, MonsterDef> = Object.fromEntries(
  MONSTERS.map((m) => [m.id, m]),
);

/**
 * 挑戦する試練の tier を自動で決める (UI に難易度選択は出さない)。
 * - 初挑戦 (戦績 0) は必ず tier1 (手習い) = やさしい敵。
 * - 以降は seed から決定的に抽選。プレイヤーレベルが低いうちは tier3 が出ない。
 */
export function pickTrialTier(seed: number, playerLevel: number, totalBattles: number): 1 | 2 | 3 {
  if (totalBattles <= 0) return 1;
  const r = createRng((seed ^ 0x7f4a7c15) >>> 0)();
  if (playerLevel < 5) return r < 0.6 ? 1 : 2;
  if (r < 0.25) return 1;
  if (r < 0.65) return 2;
  return 3;
}

/** tier に応じたモンスター強化倍率。プレイヤーのレベル補正と釣り合いを取る。 */
function monsterLevelFactor(tier: 1 | 2 | 3, playerLevel: number, jobLevel: number): number {
  const t = BATTLE_TUNING;
  // プレイヤーと同じ土俵 + tier による上乗せ (tier1 は明確に弱め)。
  // tier1 0.85 では Lv1 の 5 連戦生存率が中央値 ~76% で「序盤の敵が強すぎる」
  // (オーナー実感 2026-07-17)。0.72 で中央値 ~90% / 最弱ジョブ ~86% に調整
  // (scripts/sim-battle-balance.ts 実測)。
  // jobLevel 追随 (monsterJobChaseScale): プレイヤーの jobLevelScale 0.04 に対して
  // 1/4 だけ追う。全く追わないと jobLv20 で tier3 が全ポリシー 100% (作業化)。
  // 強く追うと適正帯 (jobLv8) の下位ジョブが 10% 台に沈む。運用想定帯は
  // 〜plLv20/jobLv10 (それ以降は W6 装備・新コンテンツで再設計。issue 参照)。
  const base =
    1 + Math.max(0, playerLevel - 1) * t.playerLevelScale + Math.max(0, jobLevel - 1) * t.monsterJobChaseScale;
  const tierBoost = tier === 1 ? 0.72 : tier === 2 ? 1.1 : 1.36;
  return base * tierBoost;
}

/** 試練モンスターを 1 体選んで戦闘値化する。seed から決定的。
 *  平坦レベル成長 (flatLevelGain) はモンスターにも同量与える —
 *  プレイヤーだけ加算されると線形項を定数 tierBoost で相殺できず、
 *  高レベル帯 (plLv40+) で tier3 が作業化する (レビュー指摘)。
 *  ジョブ間の格差是正 (低ステ職の相対的な伸び) は同量加算でも保たれる。 */
export function summonMonster(tier: 1 | 2 | 3, playerLevel: number, seed: number, jobLevel = 1): { def: MonsterDef; combatant: Combatant } {
  const pool = MONSTERS.filter((m) => m.tier === tier);
  const rng = createRng((seed ^ 0x51ed270b) >>> 0);
  const def = pool[Math.floor(rng() * pool.length)]!;
  const factor = monsterLevelFactor(tier, playerLevel, jobLevel);
  const flat = BATTLE_TUNING.flatLevelGain * Math.max(0, playerLevel - 1);
  const grown = def.stats.map((v) => v + flat) as unknown as StatArray;
  const combatant = fromStats(def.name, grown, factor, Math.max(1, Math.round(playerLevel * (tier === 3 ? 1.1 : 1))));
  return { def, combatant };
}

// ─── バトル状態と解決 ───────────────────────────────────────

export type Command = 'attack' | 'guard' | 'skill' | 'herb' | 'tonic' | 'flee';

export type BattleOutcome = 'ongoing' | 'win' | 'lose' | 'draw' | 'fled';

export interface TurnEvent {
  /** 誰の行動か */
  actor: 'player' | 'monster';
  /** 表示用テキスト (UI はこれを流すだけでよい) */
  text: string;
  /** ダメージ量 (被弾演出用)。回避/防御などで 0 のこともある */
  damage?: number;
  /** 対象が倒れたか */
  fatal?: boolean;
}

export interface BattleState {
  seed: number;
  turn: number;
  player: Combatant;
  monster: Combatant;
  monsterId: string;
  playerSkill: JobSkill;
  outcome: BattleOutcome;
  /** 残りやくそう (持ち込み分)。使うと減る。 */
  herbs: number;
  /** このバトルで使ったやくそう数 (記録用 → 在庫から差し引く)。 */
  herbsUsed: number;
  /** 残りそらのしずく (MP 回復薬)。 */
  tonics: number;
  /** このバトルで使ったそらのしずく数 (記録用 → 在庫から差し引く)。 */
  tonicsUsed: number;
  /** たたかう / ぼうぎょ の MP 回復量 (ジョブ特性 JOB_MP_TRAITS 込み。UI 表示用にも使う) */
  mpAttackGain: number;
  mpGuardGain: number;
  /** MP 特性名 (特性なしジョブは undefined) */
  mpTraitName?: string;
  /** 直近ターンのイベント列 (UI 演出用。全履歴は保持しない = 状態を軽く保つ) */
  lastEvents: TurnEvent[];
}

/** バトル開始状態を作る。herbs = 持ち込むやくそう数 (0〜herbCarryMax)。 */
export function startBattle(
  archetype: Archetype,
  jobLevel: number,
  playerLevel: number,
  displayName: string,
  tier: 1 | 2 | 3,
  seed: number,
  herbs = 0,
  /** フィールドの現在 HP/MP を引き継いでバトルを始める (あおぞらワールドでは
   *  HP/MP が戦闘をまたいで持続する。docs/19)。未指定は全快で開始 (試練)。 */
  carry?: { hp?: number; mp?: number },
  extras?: {
    /** 持ち込むそらのしずく (MP 回復薬) 数 (0〜tonicCarryMax)。 */
    tonics?: number;
    /** プレイヤーの基底ステータス (プロフィールの rpgStats)。未指定はジョブ基準値。 */
    baseStats?: StatArray;
  },
): BattleState {
  const player = playerCombatant(archetype, jobLevel, playerLevel, displayName, extras?.baseStats);
  if (carry?.hp !== undefined) {
    player.hp = Math.max(1, Math.min(player.maxHp, Math.floor(carry.hp)));
  }
  if (carry?.mp !== undefined) {
    player.mp = Math.max(0, Math.min(player.maxMp, Math.floor(carry.mp)));
  }
  const { def, combatant } = summonMonster(tier, playerLevel, seed, jobLevel);
  const gains = mpGainsFor(archetype);
  return {
    seed,
    turn: 0,
    player,
    monster: combatant,
    monsterId: def.id,
    playerSkill: skillForJob(archetype),
    outcome: 'ongoing',
    herbs: Math.max(0, Math.min(BATTLE_TUNING.herbCarryMax, Math.floor(herbs))),
    herbsUsed: 0,
    tonics: Math.max(0, Math.min(BATTLE_TUNING.tonicCarryMax, Math.floor(extras?.tonics ?? 0))),
    tonicsUsed: 0,
    mpAttackGain: gains.attackGain,
    mpGuardGain: gains.guardGain,
    ...(gains.traitName ? { mpTraitName: gains.traitName } : {}),
    lastEvents: [],
  };
}

interface AttackOptions {
  /** 攻撃力の基準値を上書き (特技を支配ステータス基準にする: gamble=luk, flurry=agi)。
   *  素の atk が低い luk/agi 型ジョブでも「ジョブに合った能力」で火力が出るように。 */
  atkOverride?: number;
  /** ダメージ倍率 */
  power?: number;
  /** 命中補正 (負で外れやすく) */
  hitBonus?: number;
  /** 防御力に掛ける係数 (魔撃=0.5 で貫通気味に)。未指定は 1。 */
  defFactor?: number;
  /** int を攻撃力として使う (魔撃)。必中。 */
  useInt?: boolean;
  /** 技名 (テキストに使う)。無指定は通常攻撃 */
  label?: string;
}

function doAttack(
  attacker: Combatant,
  defender: Combatant,
  rng: () => number,
  events: TurnEvent[],
  actor: 'player' | 'monster',
  opts: AttackOptions = {},
): void {
  const t = BATTLE_TUNING;
  const label = opts.label ? `${attacker.name}の${opts.label}!` : `${attacker.name}のこうげき!`;

  // 回避判定 (魔撃は必中)。ぼうぎょの余韻 (focus) 中は「動きを読めている」ので回避が上がる。
  if (!opts.useInt) {
    const focusBonus = defender.focus > 0 ? t.guardFocusDodge : 0;
    const dodge = Math.min(
      t.dodgeMax + focusBonus,
      Math.max(t.dodgeMin, t.dodgeBase + (defender.agi - attacker.agi) * t.agiDodgeScale - (opts.hitBonus ?? 0) + focusBonus),
    );
    if (rng() < dodge) {
      events.push({ actor, text: `${label} しかし ${defender.name}は身をかわした!` });
      return;
    }
  }

  const atkValue = opts.atkOverride ?? (opts.useInt ? attacker.int : attacker.atk);
  const defValue = defender.def * (opts.defFactor ?? 1);
  const roll = 0.85 + rng() * 0.3;
  let dmg = (atkValue * roll * t.damageScale * (opts.power ?? 1)) / (t.damageSoften + defValue);

  // クリティカル (luk)
  const crit = rng() < t.critBase + attacker.luk * t.critLukScale;
  if (crit) dmg *= t.critMultiplier;

  // 防御 / 見切りで半減
  if (defender.guarding || defender.parrying) dmg *= t.guardReduction;

  const final = Math.max(1, Math.round(dmg));
  defender.hp = Math.max(0, defender.hp - final);
  const fatal = defender.hp === 0;
  // 決着文はプレイヤー視点: 敵を倒した =「◯◯をたおした!」、自分が倒れた =
  // 「◯◯はちからつきた!」(プレイヤーが「たおされる」対象になる文は視点が転倒する)。
  const fatalText = fatal
    ? actor === 'player'
      ? `。${defender.name}をたおした!`
      : `。${defender.name}はちからつきた…!`
    : '';
  events.push({
    actor,
    text: `${label}${crit ? ' 会心の一撃!!' : ''} ${defender.name}に ${final} のダメージ${fatalText}`,
    damage: final,
    ...(fatal ? { fatal: true } : {}),
  });

  // 見切り反撃 (倒れていなければ)
  if (!fatal && defender.parrying) {
    defender.parrying = false;
    const counterActor = actor === 'player' ? 'monster' : 'player';
    // 反撃は支配ステータス (def) 基準 — 守りの固さがそのまま反撃の重さになる
    // (見切り職は atk が低く、atk 基準だと tier3 で火力が出ずジリ貧になる)
    doAttack(defender, attacker, rng, events, counterActor, { power: 1.2, atkOverride: defender.def, label: 'はんげき' });
  }
}

/** モンスターの行動選択 (tier が高いほど賢い)。 */
function monsterCommand(state: BattleState, rng: () => number): Command {
  const def = MONSTERS_BY_ID[state.monsterId];
  const tier = def?.tier ?? 1;
  const r = rng();
  // HP が減ってきたら防御が混ざる。tier3 は強攻撃 (skill 相当) 多め。
  const hpRatio = state.monster.hp / state.monster.maxHp;
  if (tier >= 2 && hpRatio < 0.35 && r < 0.25) return 'guard';
  if (tier === 3 && r < 0.3) return 'skill';
  if (tier === 2 && r < 0.2) return 'skill';
  return 'attack';
}

function playerSkillAction(state: BattleState, rng: () => number, events: TurnEvent[]): void {
  const { player, monster, playerSkill } = state;
  switch (playerSkill.kind) {
    case 'smash':
      doAttack(player, monster, rng, events, 'player', { power: 1.7, hitBonus: -0.1, label: playerSkill.name });
      break;
    case 'parry':
      // 宣言は resolveTurn 冒頭 (行動順に関係なく効くように)。ここは no-op。
      break;
    case 'flurry':
      // 支配ステータス (agi) 基準 — 素早さで手数を出すジョブの「らしさ」と火力を一致させる
      doAttack(player, monster, rng, events, 'player', { power: 0.65, atkOverride: player.agi, label: playerSkill.name });
      if (state.monster.hp > 0) {
        doAttack(player, monster, rng, events, 'player', { power: 0.65, atkOverride: player.agi, label: playerSkill.name });
      }
      break;
    case 'spell':
      // 防御を半分だけ貫通 + 必中。完全無視 (旧仕様) は int 職が tier3 を蹂躙して
      // 難易度設計が壊れたため 0.5 に緩和 (バランステストで固定)。
      doAttack(player, monster, rng, events, 'player', { power: 1.0, useInt: true, defFactor: 0.5, label: playerSkill.name });
      break;
    case 'gamble': {
      // 0〜2.6 倍。luk が高いほど下振れしにくい。基準値も支配ステータス (luk) —
      // atk 7〜9 の luk 型ジョブが「運で殴る」ジョブとして成立するように。
      const floor = Math.min(0.6, player.luk * 0.012);
      const mult = floor + rng() * (2.6 - floor);
      doAttack(player, monster, rng, events, 'player', { power: mult, atkOverride: player.luk, label: playerSkill.name });
      break;
    }
  }
}

/**
 * 1 ターンを解決する。player のコマンドを受け、素早さ順に両者が行動する。
 * state は**破壊しない** (新しい state を返す)。
 */
export function resolveTurn(prev: BattleState, command: Command): BattleState {
  if (prev.outcome !== 'ongoing') return prev;

  // コピー (Combatant は現状 flat なので spread で足りる)。
  // 注意: 将来 Combatant に配列/オブジェクト (装備等) を足すときは deep copy に変えること
  // (shallow spread のままだとイミュータブル性が壊れる)。
  const state: BattleState = {
    ...prev,
    turn: prev.turn + 1,
    player: { ...prev.player, guarding: false },
    monster: { ...prev.monster, guarding: false },
    lastEvents: [],
  };
  const events: TurnEvent[] = [];
  const rng = turnRng(state.seed, state.turn);
  const mCommand = monsterCommand(state, rng);

  // ── コマンドの実効化 ──
  // MP 不足の特技 / 在庫切れのやくそうは「たたかう」にフォールバック
  // (UI は disabled にする前提。エンジン側の防御的措置で、ターンを無駄にしない)。
  const t = BATTLE_TUNING;
  let cmd: Command = command;
  if (command === 'skill' && state.player.mp < t.skillMpCost) {
    events.push({ actor: 'player', text: `MP が足りない! (${state.player.mp}/${t.skillMpCost})` });
    cmd = 'attack';
  } else if (command === 'herb' && state.herbs <= 0) {
    events.push({ actor: 'player', text: 'やくそうを持っていない!' });
    cmd = 'attack';
  } else if (command === 'tonic' && state.tonics <= 0) {
    events.push({ actor: 'player', text: 'そらのしずくを持っていない!' });
    cmd = 'attack';
  }
  if (cmd === 'skill') {
    state.player.mp -= t.skillMpCost;
  }

  // ── にげる: 成功したら即離脱 (敵は行動しない)。失敗はターンを失い敵の行動を受ける。 ──
  if (cmd === 'flee') {
    const chance = Math.min(
      t.fleeMax,
      Math.max(t.fleeMin, t.fleeBase + (state.player.agi - state.monster.agi) * t.fleeAgiScale),
    );
    if (rng() < chance) {
      state.outcome = 'fled';
      events.push({ actor: 'player', text: `${state.player.name}はうまく逃げ切った!` });
      state.lastEvents = events;
      return state;
    }
    events.push({ actor: 'player', text: 'にげられない! 回り込まれてしまった!' });
    // このターンは敵だけが行動する (下の act で player 分岐は cmd==='flee' により no-op)
  }

  // 防御系 (ぼうぎょ / 見切り) は行動順に関係なく先に立てる
  // (先手を取られても防御・反撃が意味を持つように。見切り持ちは鈍足ジョブが多い)。
  if (cmd === 'guard') {
    state.player.guarding = true;
    // 翌ターンまで相手の動きを読める (回避ボーナス)。このターン(1) + 次ターン(1) = 2。
    state.player.focus = 2;
    if (state.mpGuardGain > 0) {
      state.player.mp = Math.min(state.player.maxMp, state.player.mp + state.mpGuardGain);
      events.push({
        actor: 'player',
        text: `${state.player.name}はぼうぎょして息を整えた。(${state.mpTraitName ? `${state.mpTraitName}: ` : ''}MP +${state.mpGuardGain})`,
      });
    } else {
      events.push({ actor: 'player', text: `${state.player.name}はぼうぎょのかまえ!` });
    }
  }
  if (cmd === 'skill' && state.playerSkill.kind === 'parry') {
    state.player.parrying = true;
    events.push({ actor: 'player', text: `${state.player.name}は${state.playerSkill.name}の構え! (防御しつつ反撃)` });
  }
  // ため中は防御宣言しない (このターンは必ず解放する。宣言すると「身を固めた直後に
  // ため攻撃」という矛盾イベント + 幻の防御半減が発生する)。
  if (mCommand === 'guard' && !state.monster.charging) {
    state.monster.guarding = true;
    events.push({ actor: 'monster', text: `${state.monster.name}は身を固めている。` });
  }

  // 素早さ + 乱数で行動順
  const playerFirst = state.player.agi + rng() * 20 >= state.monster.agi + rng() * 20;

  const act = (who: 'player' | 'monster') => {
    if (state.player.hp === 0 || state.monster.hp === 0) return;
    if (who === 'player') {
      if (cmd === 'attack') {
        doAttack(state.player, state.monster, rng, events, 'player');
        if (state.mpAttackGain > 0) {
          state.player.mp = Math.min(state.player.maxMp, state.player.mp + state.mpAttackGain);
        }
      } else if (cmd === 'skill') {
        playerSkillAction(state, rng, events);
      } else if (cmd === 'herb') {
        const heal = Math.round(state.player.maxHp * t.herbHealRatio);
        state.player.hp = Math.min(state.player.maxHp, state.player.hp + heal);
        state.herbs -= 1;
        state.herbsUsed += 1;
        events.push({ actor: 'player', text: `${state.player.name}はやくそうを使った! HP が ${heal} 回復。(残り ${state.herbs})` });
      } else if (cmd === 'tonic') {
        const gain = Math.round(state.player.maxMp * t.tonicMpRatio);
        state.player.mp = Math.min(state.player.maxMp, state.player.mp + gain);
        state.tonics -= 1;
        state.tonicsUsed += 1;
        events.push({ actor: 'player', text: `${state.player.name}はそらのしずくを飲んだ! MP が ${gain} 回復。(残り ${state.tonics})` });
      }
      // guard は宣言済み / flee 失敗はこのターン行動なし
    } else {
      // ため中なら宣言どおり解放 (mCommand は無視)。予告 → 解放の 2 ターン制で、
      // プレイヤーが予告を見て防御する読み合いを作る。
      if (state.monster.charging) {
        state.monster.charging = false;
        const skillName = MONSTERS_BY_ID[state.monsterId]?.skillName ?? 'つよいこうげき';
        doAttack(state.monster, state.player, rng, events, 'monster', {
          power: BATTLE_TUNING.chargedPower,
          hitBonus: -0.05,
          label: skillName,
        });
      } else if (mCommand === 'attack') {
        doAttack(state.monster, state.player, rng, events, 'monster');
      } else if (mCommand === 'skill') {
        // このターンは攻撃せず「ため」を予告する
        state.monster.charging = true;
        events.push({ actor: 'monster', text: `${state.monster.name}は力をためている…!` });
      }
      // guard は宣言済み
    }
  };

  act(playerFirst ? 'player' : 'monster');
  act(playerFirst ? 'monster' : 'player');

  // 見切りは 1 ターン限り (発動しなかったら解除)。ぼうぎょの余韻 (focus) は 1 減衰。
  state.player.parrying = false;
  state.monster.parrying = false;
  state.player.focus = Math.max(0, state.player.focus - 1);

  // 勝敗判定
  if (state.monster.hp === 0) state.outcome = 'win';
  else if (state.player.hp === 0) state.outcome = 'lose';
  else if (state.turn >= BATTLE_TUNING.maxTurns) {
    // 引き分け規定: 残 HP 割合が高い方の勝ち。同率は draw。
    const pr = state.player.hp / state.player.maxHp;
    const mr = state.monster.hp / state.monster.maxHp;
    state.outcome = pr > mr ? 'win' : pr < mr ? 'lose' : 'draw';
    const closing =
      state.outcome === 'win'
        ? 'ブルスコン「そこまで! 判定勝ちだ、見事だったよ」'
        : state.outcome === 'lose'
          ? 'ブルスコン「そこまで! 今回は相手が上手だったね」'
          : 'ブルスコン「そこまで! 引き分けだ、いい勝負だったよ」';
    events.push({ actor: 'monster', text: closing });
  }

  state.lastEvents = events;
  return state;
}

// ─── ドロップ・称号 ─────────────────────────────────────────

/**
 * 敗北時に落とす素材を決定的に判定する (オーナー決定 2026-07-18「敗北ペナルティは
 * ランダムで素材ドロップ。luk の影響あり。運が悪いと複数ドロップ」)。
 * - 手持ち (materials: id → 個数) から個数重みで 1 個は必ず落ちる (手持ちが空なら何も落ちない)。
 * - 以降は clamp(lossExtraBase − luk*lossExtraLukScale, lossExtraMin, 1) の確率で
 *   追加 1 個、最大 lossMax 個まで (luk が高いほど追加を引きにくい)。
 * - seed から決定的 (バトル seed を使えば記録から再現可能)。
 */
export function rollDefeatLoss(materials: Record<string, number>, luk: number, seed: number): string[] {
  const t = BATTLE_TUNING;
  const rng = createRng((seed ^ 0x7b0c9d21) >>> 0);
  const pool: string[] = [];
  for (const [id, n] of Object.entries(materials)) {
    for (let i = 0; i < n; i++) pool.push(id);
  }
  const lost: string[] = [];
  const extraChance = Math.min(1, Math.max(t.lossExtraMin, t.lossExtraBase - luk * t.lossExtraLukScale));
  while (pool.length > 0 && lost.length < t.lossMax) {
    if (lost.length > 0 && rng() >= extraChance) break;
    const i = Math.floor(rng() * pool.length);
    lost.push(pool[i]!);
    pool.splice(i, 1);
  }
  return lost;
}

/** 勝利時のドロップ判定。luk で上振れ。決定的 (seed 依存)。 */
export function rollDrops(monsterId: string, luk: number, seed: number): string[] {
  const def = MONSTERS_BY_ID[monsterId];
  if (!def) return [];
  const rng = createRng((seed ^ 0x2545f491) >>> 0);
  const out: string[] = [];
  for (const d of def.drops) {
    const chance = Math.min(0.95, d.chance + luk * BATTLE_TUNING.dropLukScale);
    if (rng() < chance) out.push(d.item);
  }
  return out;
}

/** 通算戦績 (UI/記録側で集計して渡す)。 */
export interface BattleRecordSummary {
  wins: number;
  losses: number;
  bestStreak: number;
  tier3Wins: number;
}

export interface TitleDef {
  id: string;
  name: string;
  /** 達成条件の説明 */
  description: string;
  earned: (r: BattleRecordSummary) => boolean;
}

/** 称号。上から順に評価し、獲得済みのものを全部返す (UI は最後尾 = 最高位を出す等)。 */
export const TITLES: readonly TitleDef[] = [
  { id: 'first-win', name: '試練の一歩', description: 'はじめての勝利', earned: (r) => r.wins >= 1 },
  { id: 'ten-wins', name: '駆け出しの挑戦者', description: '通算 10 勝', earned: (r) => r.wins >= 10 },
  { id: 'streak-5', name: '波に乗る者', description: '5 連勝', earned: (r) => r.bestStreak >= 5 },
  { id: 'fifty-wins', name: '歴戦の空渡り', description: '通算 50 勝', earned: (r) => r.wins >= 50 },
  { id: 'streak-10', name: '不倒の旗印', description: '10 連勝', earned: (r) => r.bestStreak >= 10 },
  { id: 'tier3-10', name: '真剣勝負の常連', description: '真剣勝負で 10 勝', earned: (r) => r.tier3Wins >= 10 },
  { id: 'hundred-wins', name: '蒼穹の覇者', description: '通算 100 勝', earned: (r) => r.wins >= 100 },
];

export function earnedTitles(r: BattleRecordSummary): TitleDef[] {
  return TITLES.filter((t) => t.earned(r));
}
