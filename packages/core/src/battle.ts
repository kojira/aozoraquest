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
import { gearBonus, gearBonusFromGear, type GearBonus, type GearSelection } from './equipment.js';
import { SKILLS, runSkill, runSkillMulti } from './skills.js';
import { elementMultiplier, type Element } from './elements.js';
import { resolveTargets, type CombatSides } from './combat-target.js';
import {
  type StatusInstance,
  type HookCtx,
  STATUS_REGISTRY,
  applyBeforeAct,
  applyDodgeCalc,
  applyPowerCalc,
  applyCritCalc,
  applyIncomingCalc,
  applyOnHit,
  applyOnLethal,
  applyOnIncomingMagic,
  mpCostFactorOf,
  applyElementBonus,
  applyTargetBonus,
  applyOnDamaged,
  applyModifyHit,
  tickStatuses,
  clearHitStatuses,
} from './statuses.js';

// ─── チューニング ───────────────────────────────────────────

export const BATTLE_TUNING = {
  /** 1 戦のあおぞらパワー消費 */
  powerCost: 1,
  /** 勝利 XP のフォールバック既定値。通常は各モンスターの `xp` (battleXpFor) を使う。
   *  未知モンスター id のときだけこの値。 */
  xpWin: 30,
  /** 敗北 XP (挑んだこと自体に少額) */
  xpLose: 5,
  /** HP = hpBase + def*hpDefScale + level*hpLevelScale。
   *  DQ 級の小さいスケール (プレイヤー Lv1 ~18-21・敵ひとけた) にして、レベルアップ/装備の
   *  +数の恩恵を体感させる (オーナー方針 2026-07-21。小さい母数ほど +2 が効く)。ダメージ係数
   *  (atkCoef/defCoef) と全モンスター HP も同じ ~1/4 スケールで、手数 (倒す回数) は保つ。 */
  hpBase: 17,
  hpDefScale: 0.08,
  // レベルアップの HP 上昇を「毎回 +1〜2 の体感できる整数」にする (DQ 級スケールの狙いは
  // 成長を体感させること。0.5 だと半分のレベルで +0 になり逆効果 — レビュー ★★★)。母数が
  // 小さいので +1.5/level でも Lv1→30 で HP が 2〜3 倍に伸び、成長の手応えが強い。
  hpLevelScale: 1.5,
  /** 敵の HP/MP に遭遇ごとの分散 (±この割合)。値を毎回固定にせず、「あと何回
   *  使えるか」をプレイヤーに予想させる (オーナー要望 2026-07-18)。seed 決定的。
   *  world 遭遇のみ適用し、バランステスト対象の trial は 0 (固定) に保つ。 */
  monsterVitalsVariance: 0.15,
  /** レベルによるステータス補正 = 1 + (jobLv-1)*jobLevelScale + (playerLv-1)*playerLevelScale */
  jobLevelScale: 0.04,
  playerLevelScale: 0.015,
  /** プレイヤーの全ステータスに加わる平坦なレベル成長 (+flatLevelGain × (playerLv-1))。
   *  乗算補正だけだと低い値は低いままで「弱いジョブがレベルでちゃんと強くならない」
   *  (オーナー指摘 2026-07-17)。加算成長は低ステータスほど相対的に効く。 */
  flatLevelGain: 0.25,
  /** 個人 rpgStats とジョブ基準値のブレンド比 (0 = ジョブのみ / 1 = 個人のみ)。
   *  診断は min-max 正規化で全員が極端プロフィールになるため、個人値 100% だと
   *  atk 0〜80 のレンジになり勝率が 0〜100% に割れる (issue #279 実測)。
   *  50:50 でジョブの型を保ちつつ個人の傾きを乗せる。 */
  baseStatsPersonalWeight: 0.5,
  /** ダメージ = max(minDamage, (atk*atkCoef*power − def*defCoef) * roll(0.85..1.15))。DQ の減算式
   *  (攻撃÷2 − 防御÷4) 流。**防御の係数を攻撃の半分 (2:1)** にしてインフレを抑える。会心は def 項 0
   *  (守備無視)。高守備の敵 (メタル) は通常 minDamage しか通らず、会心のみ貫通できる。数値は sim で調整。 */
  atkCoef: 0.18,
  defCoef: 0.09,
  minDamage: 1,
  /** 回避率 = clamp(base + (守る側agi - 攻める側agi)*agiDodgeScale, min, max) */
  dodgeBase: 0.04,
  agiDodgeScale: 0.009,
  dodgeMin: 0.02,
  // focus 込みの実効上限は dodgeMax + guardFocusDodge (ぼうぎょ直後の高 agi 職で最大 0.47)
  dodgeMax: 0.32,
  /** クリティカル率 = critBase + luk*critLukScale。会心 (かいしんのいちげき) は DQ 流に
   *  **攻撃力 critAtkMultiplier 倍**。守備力 (def) 無視は**プレイヤーの会心のみ** (敵の会心は
   *  1.5 倍のみ = タンク職を守る。バランス ★★★)。倍率は控えめ 1.5 (2 は高すぎ — オーナー指摘
   *  2026-07-20)。ただし**減算式では会心の守備無視は def 項 (def*defCoef) を消すだけ**なので、
   *  除算式時代 (分母消滅で桁が変わる) ほど劇的ではない = 守備の高い敵には「効くが一撃逆転
   *  までは行かない」控えめな貫通。超高守備メタルの一撃逆転演出は #408 で会心倍率と併せ再評価。
   *  ぼうぎょコマンドの半減は貫通しない。値は模擬戦シミュレータで調整可。 */
  critBase: 0.04,
  critLukScale: 0.004,
  critAtkMultiplier: 1.5,
  /** ぼうぎょ: 被ダメージ半減 */
  guardReduction: 0.5,
  /** ため攻撃 (tier2+ が 1 ターン予告してから放つ) の倍率。予告を見て防御するのが正解
   *  (2.6 → 防御で 1.3 まで軽減 = 節約 1.3 発分 > 機会費用の自攻撃 1 発分)。
   *  防御に存在意義を与える読み合いの核。バランステストで「予告に防御 > attack 連打」を固定。 */
  chargedPower: 2.6,
  /** charger が「ため」を宣言する確率 (ため中でないとき毎ターン判定)。 */
  chargerChargeChance: 0.4,
  /** healer が自己回復する条件と量。HP がこの割合を下回ると healChance で回復し、
   *  maxHp の healRatio ぶん戻す (削り切る前に倒す読み合い。無限回復にはしない)。 */
  healerLowHpRatio: 0.55,
  healerHealChance: 0.5,
  healerHealRatio: 0.14,
  /** caster が魔法を撃つ確率 (MP があるとき毎ターン判定)。残りは通常攻撃。数値は sim 前提の暫定値
   *  (def 無視の魔法は def タンクに刺さるため、初期投入は控えめ。full 調整は #479 sim)。 */
  casterCastChance: 0.3,
  /** caster の魔法 MP コスト。 */
  monsterCastMpCost: 6,
  /** モンスターの特技 MP コスト。MP は int から算出 (fromStats) 済み。ため/回復を
   *  MP 制にすることで「int の高い敵ほど特技を多用でき、尽きたら通常攻撃に落ちる」
   *  = MP を削り切る/尽きるのを待つ読み合いを作る (オーナー提案 2026-07-18)。 */
  monsterChargeMpCost: 5,
  monsterHealMpCost: 7,
  /** MP: 特技のコスト。最大 MP = mpBase + int * mpIntScale (int 職は手数が多い)。
   *  戦闘中の MP 回復は **ジョブ特性 (JOB_MP_TRAITS) を持つジョブだけ** —
   *  全員一律の回復はジョブの差をぼやけさせる (オーナー決定 2026-07-17)。
   *  特性なしジョブは MP プール + そらのしずくでやりくりする。 */
  skillMpCost: 4,
  /** heal とくぎ (#436): 使うと maxHp のこの割合を回復 (MP 制。やくそうと違い在庫でなく MP を消費)。 */
  skillHealRatio: 0.35,
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
  /** モンスターの逃走 (ability='fleer')。毎ターン flee 判定する。逃走率 =
   *  clamp(monsterFleeBase + 自agi*monsterFleeAgiScale, 0, monsterFleeMax)。
   *  はぐれメタル型 (高XP・低HP・すぐ逃げる) 用: 倒す前に逃げられると報酬ゼロ。 */
  monsterFleeBase: 0.35,
  monsterFleeAgiScale: 0.006,
  monsterFleeMax: 0.75,
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

export type SkillKind = 'smash' | 'parry' | 'flurry' | 'spell' | 'gamble' | 'heal';

// 支配ステータス (atk/def/agi/int/luk) → 署名スキル。heal は署名ではなく「習得」する副スキル。
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
  /** SKILLS レジストリのキー。基本 6 種は SkillKind、ジョブ確定キット (#456) は
   *  'mage-flame' 等の固有 id。エンジンは SKILLS[kind] で解決するので string に緩めた。 */
  kind: string;
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

// 旧 LEARNED_SKILLS (#436: 弱職に heal 副スキルを配る機構) は #456 で全職キット化されたため撤去した。
// とくぎは全て JOB_KITS (確定キット) が担う。

/** ジョブ確定キット (#456 / docs/25 §12)。id は SKILLS レジストリのキー、learnAt = 習得 jobLevel。
 *  **全16職が確定キットを持つ** (Record 全キー必須。職を足したらここにも必須)。skillsForJob が返す。
 *  未習得帯 (最初の learnAt 未満) のみ署名スキルにフォールバックする。 */
interface KitSkill {
  /** SKILLS のキー */
  id: string;
  name: string;
  learnAt: number;
}
const JOB_KITS: Record<Archetype, readonly KitSkill[]> = {
  // 魔法使い: 単体・int型・必中・def無視の大砲 (脆い)。パイロット (#456)。魔力障壁 Lv30 (P) は後続。
  mage: [
    { id: 'mage-flame', name: '火炎術式', learnAt: 3 },
    { id: 'mage-decode', name: '解式マギア', learnAt: 5 },
    { id: 'mage-stone', name: '石射', learnAt: 6 },
    { id: 'mage-freeze', name: '氷結術式', learnAt: 8 },
    { id: 'mage-melt', name: 'メルティ', learnAt: 12 },
    { id: 'mage-blaze', name: '爆炎術式', learnAt: 15 },
    { id: 'mage-quake', name: 'じわれ', learnAt: 18 },
    { id: 'mage-permafrost', name: '永久凍土', learnAt: 20 },
    { id: 'mage-meteor', name: 'メテオ', learnAt: 25 },
  ],
  // 忍者: agi 型・毒/隠密/会心 (§7 パイロット)。影分身20/首狩り30(P) は後続。
  ninja: [
    { id: 'ninja-poison-hand', name: '毒手', learnAt: 3 },
    { id: 'ninja-hide', name: 'かくれみ', learnAt: 5 },
    { id: 'ninja-katon', name: '火遁', learnAt: 8 },
    { id: 'ninja-vitals', name: '急所狙い', learnAt: 12 },
    { id: 'ninja-kuji', name: '九字切り', learnAt: 15 },
  ],
  // 詩人: 水属性・自己バフ火力・言葉の拘束。感傷/感情爆発/全体技/詩心(P) は後続 (要 新語彙)。
  poet: [
    { id: 'poet-verse', name: '心晴の韻', learnAt: 3 },
    { id: 'poet-calm', name: '静心', learnAt: 5 },
    { id: 'poet-rouse', name: '昂ぶりの詩', learnAt: 7 },
    { id: 'poet-bind', name: '言の葉縛り', learnAt: 8 },
    { id: 'poet-mushin', name: '無心', learnAt: 12 },
    { id: 'poet-outburst', name: '感情爆発', learnAt: 20 },
    { id: 'poet-song', name: '心の詩', learnAt: 22 },
  ],
  // 戦士: 純物理ブルーザー・無属性。なぎ払い/一騎当千(全体)・剣豪(P) は後続。
  warrior: [
    { id: 'warrior-thrust', name: 'みだれ突き', learnAt: 5 },
    { id: 'warrior-helmsplit', name: 'かぶとわり', learnAt: 10 },
    { id: 'warrior-charge', name: 'ためる', learnAt: 15 },
    { id: 'warrior-fullslash', name: '全力斬り', learnAt: 18 },
  ],
  // 聖騎士: 前衛・聖なる支援・holy(無属性)。全体技/聖光斬/清き心(P) は後続。
  paladin: [
    { id: 'paladin-heal', name: '聖光の癒し', learnAt: 3 },
    { id: 'paladin-blessing', name: '光の加護', learnAt: 5 },
    { id: 'paladin-lightblade', name: '光の剣', learnAt: 8 },
    { id: 'paladin-guard', name: '聖なる守り', learnAt: 15 },
    { id: 'paladin-purify', name: '浄化', learnAt: 18 },
  ],
  // 将軍: 最強 atk・最脆 def・物理一本・対キャスター。全体技/覇王(P)/魔法かき消し・見切りの魔法回避は後続。
  shogun: [
    { id: 'shogun-flash', name: '一閃', learnAt: 3 },
    { id: 'shogun-sweep', name: '足払い', learnAt: 8 },
    { id: 'shogun-guard', name: '見切り', learnAt: 15 },
    { id: 'shogun-oni', name: '鬼神斬り', learnAt: 20 },
  ],
  // 冒険者: 万能スカーミッシャー・luk34/agi25。武器投げ(装備)/秘境探索(random)/全体技/旅の勘(P)は後続。
  explorer: [
    { id: 'explorer-pebble', name: '石つぶて', learnAt: 3 },
    { id: 'explorer-snare', name: '足がらめ', learnAt: 5 },
    { id: 'explorer-reveal', name: 'みやぶる', learnAt: 7 },
    { id: 'explorer-survival', name: 'サバイバル', learnAt: 8 },
    { id: 'explorer-gale', name: '疾風の一撃', learnAt: 10 },
    { id: 'explorer-confuse', name: 'かく乱', learnAt: 15 },
    { id: 'explorer-hitrun', name: '一撃離脱', learnAt: 18 },
    { id: 'explorer-lastditch', name: '背水の陣', learnAt: 25 },
  ],
  // 芸術家: 幻術師・luk/def26・空属性。だまし討ち/幻影の分身/創造の絵筆(summon)/混乱系/傑作/審美眼(P)は後続。
  artist: [
    { id: 'artist-bolt', name: '色彩の弾', learnAt: 3 },
    { id: 'artist-daze', name: '幻惑の色', learnAt: 5 },
    { id: 'artist-trompe', name: 'だまし絵', learnAt: 7 },
    { id: 'artist-mist', name: '極彩の霧', learnAt: 8 },
    { id: 'artist-blind', name: '目くらまし', learnAt: 10 },
    { id: 'artist-blade', name: '原色の刃', learnAt: 12 },
    { id: 'artist-explosion', name: '芸術は爆発だ', learnAt: 15 },
  ],
  // 匠: からくり技師・int43・罠と装置。自爆人形/からくり兵(summon)/大発破/兵器解放/発明家(P)は後続。
  fighter: [
    { id: 'fighter-contraption', name: 'からくり仕掛け', learnAt: 3 },
    { id: 'fighter-smoke', name: '煙玉', learnAt: 5 },
    { id: 'fighter-poisongas', name: '毒煙装置', learnAt: 7 },
    { id: 'fighter-pitfall', name: '落とし穴', learnAt: 8 },
    { id: 'fighter-ironball', name: '鉄球投擲', learnAt: 10 },
    { id: 'fighter-flamethrower', name: '火炎放射器', learnAt: 12 },
    { id: 'fighter-net', name: '拘束網', learnAt: 15 },
    { id: 'fighter-waterjet', name: '高圧放水', learnAt: 18 },
  ],
  // 守護者: 壁役・def43最強。盾殴りは def 基準。フルカウンター/不動(P)/かばう・挑発(マルチ)は後続。
  guardian: [
    { id: 'guardian-bash', name: '盾殴り', learnAt: 3 },
    { id: 'guardian-shield', name: '大盾の護り', learnAt: 5 }, // parry反撃 (§14.1: Lv5)
    { id: 'guardian-thorns', name: 'とげの盾', learnAt: 8 },
    { id: 'guardian-stand', name: '仁王立ち', learnAt: 12 },
    { id: 'guardian-prayer', name: '守護の祈り', learnAt: 15 }, // defUp (§14.1: Lv15)
  ],
  // 巫女: luk型・霊的支援・物理攻撃なし・全体技。魅惑の神楽(confusion)/神楽乱舞/神託の光/巫女の直感(P)は後続。
  miko: [
    { id: 'miko-heal-bell', name: '癒しの鈴', learnAt: 3 },
    { id: 'miko-wind-dance', name: '風の舞', learnAt: 5 },
    { id: 'miko-sleep-bell', name: '眠りの鈴', learnAt: 8 },
    { id: 'miko-blessing', name: '加護', learnAt: 12 },
    { id: 'miko-purify-dance', name: '破魔の舞', learnAt: 15 },
    { id: 'miko-heal-kagura', name: '癒し神楽', learnAt: 18 },
    { id: 'miko-cleanse', name: '払串', learnAt: 22 },
  ],
  // 吟遊詩人: agi/luk型・空属性・歌でバフ/デバフ/眠り・回復なし。スタッカート/カプリッチョ/英雄叙事詩/名演(P)は後続。
  bard: [
    { id: 'bard-prelude', name: 'プレリュード', learnAt: 3 },
    { id: 'bard-desperado', name: 'デスペラード', learnAt: 5 },
    { id: 'bard-lullaby', name: 'ララバイ', learnAt: 8 },
    { id: 'bard-scherzo', name: 'スケルツォ', learnAt: 12 },
    { id: 'bard-discord', name: 'ディスコード', learnAt: 14 },
    { id: 'bard-rhapsody', name: 'ラプソディ', learnAt: 15 },
    { id: 'bard-applause', name: 'アプローズ', learnAt: 25 },
  ],
  // 隊長: タフな前衛指揮官・鼓舞。全体バフ/デバフはソロで自己/敵単体に退化、マルチで全体化。名将(P)は後続。
  captain: [
    { id: 'captain-charge', name: '突撃号令', learnAt: 3 },
    { id: 'captain-inspire', name: '鼓舞', learnAt: 5 },
    { id: 'captain-defense', name: '防陣', learnAt: 8 },
    { id: 'captain-rush', name: '突進', learnAt: 12 },
    { id: 'captain-rally', name: '檄', learnAt: 15 },
    { id: 'captain-desperate', name: '捨て身攻撃', learnAt: 18 },
    { id: 'captain-encircle', name: '攻陣', learnAt: 25 },
  ],
  // 遊び人: luk/agi 型・運任せ。ぶんどり(gain)/ルーレット・大道芸(random)/せっとく(resolve) は後続。
  performer: [
    { id: 'performer-slack', name: 'サボる', learnAt: 5 },
    { id: 'performer-gamble', name: 'いちかばちか', learnAt: 12 },
    { id: 'performer-acrobat', name: '曲芸乱舞', learnAt: 15 },
  ],
  // 予言者: 最高 int・破滅のオラクル・遅延。全体予言 (地震/嵐/日照り/水難/アポカリプス) はマルチ待ち。
  //   死の宣告 (毎ターンHP半分)/未来予知 (magicEvade)/全知(P) は後続。
  seer: [
    { id: 'seer-switch', name: '未来スイッチ', learnAt: 3 },
    { id: 'seer-thunder', name: '雷の予言', learnAt: 4 },
    { id: 'seer-poison', name: '毒の予言', learnAt: 7 },
    { id: 'seer-doom', name: '破滅の予言', learnAt: 12 },
    { id: 'seer-king', name: '蠱毒の王', learnAt: 20 },
  ],
  // 賢者: 最高 int・全5属性・支援。イディオット/知恵の加護/星辰以外の全体技/慧眼(P) は後続。
  sage: [
    { id: 'sage-flame', name: '火炎', learnAt: 3 },
    { id: 'sage-decode', name: '解式', learnAt: 5 },
    { id: 'sage-stone', name: '石射', learnAt: 6 },
    { id: 'sage-frost', name: '氷結', learnAt: 8 },
    { id: 'sage-gale', name: '疾風', learnAt: 10 },
    { id: 'sage-revelation', name: '天啓', learnAt: 12 },
    { id: 'sage-heal', name: '賢者の癒し', learnAt: 16 },
    { id: 'sage-starlight', name: '星辰の大魔法', learnAt: 22 },
  ],
};

/** その jobLevel 時点で使えるとくぎ列。UI/エンジンはこの列から毎ターン選ぶ。全16職キット化済み (#456)。
 *  learnAt<=level のキット技を返す。未習得帯 (最初の技より前の Lv) のみ署名スキルにフォールバック。
 *  **[0] は署名と一致しない** (例 mage Lv3+ の [0] は火炎術式)。「playerSkills[0]===署名」を前提にする
 *  コードを書かないこと (単数 playerSkill は別途 skillForJob で保持されフォールバック用)。 */
export function skillsForJob(archetype: Archetype, jobLevel: number): JobSkill[] {
  // 全16職が確定キットを持つ (#456)。learnAt<=level のキット技を返し、未習得帯 (最初の技より前) は
  // 署名スキル (Lv1 の基本技) にフォールバックする。
  const learned = JOB_KITS[archetype].filter((s) => jobLevel >= s.learnAt).map((s) => ({ kind: s.id, name: s.name }));
  return learned.length ? learned : [skillForJob(archetype)];
}

/** ジョブ innate パッシブ (docs/25 §12 の各職 Lv30)。PASSIVES のキー。習得 jobLevel は一律 30。
 *  **Lv30 パッシブを持つ全15職を実装済み** (基本7職 + onLethal 覇王/不動 + elementBonus 慧眼 +
 *  targetBonus 審美眼 + statusDurationBonus 名演 + onIncomingMagic 清き心 + mpCostFactor 発明家/巫女 +
 *  dropBonus 巫女)。performer(遊び人)は Lv30=せっとく(resolve スキル)でパッシブ無し = 全職キット化完了。 */
const JOB_PASSIVES: Partial<Record<Archetype, string>> = {
  warrior: 'warrior-blademaster', // 剣豪: 会心率↑
  mage: 'mage-barrier', // 魔力障壁: 常時被ダメ軽減
  ninja: 'kubikari', // 首狩り: 格下を一撃
  captain: 'captain-command', // 名将: 常時 atk/def+10%
  seer: 'seer-omniscience', // 全知: 常時回避↑
  explorer: 'explorer-instinct', // 旅の勘: 回避↑
  poet: 'poet-muse', // 詩心: 自己バフ中 与ダメ↑
  shogun: 'shogun-overlord', // 覇王: 物理致死をHP1で耐え+反射 (1戦闘1回)
  guardian: 'guardian-immovable', // 不動: 物理致死を1回確定で耐える
  sage: 'sage-insight', // 慧眼: 弱点属性で追加ダメ
  artist: 'artist-aesthete', // 審美眼: 状態異常の敵に与ダメ↑
  bard: 'bard-encore', // 名演: 自分の歌 (状態) の効果ターン+1
  paladin: 'paladin-purity', // 清き心: 低確率で魔法反射
  fighter: 'fighter-inventor', // 発明家: とくぎ MP 消費 30% 引き
  miko: 'miko-intuition', // 巫女の直感: ドロップ↑ + MP 消費 30% 引き
};

/** その jobLevel 時点で有効なパッシブ id 列。Lv30 到達で innate パッシブが1つ有効になる。 */
export function jobPassives(archetype: Archetype, jobLevel: number): string[] {
  const pid = JOB_PASSIVES[archetype];
  return pid && jobLevel >= 30 ? [pid] : [];
}

/** c のとくぎ MP コスト (発明家/巫女の直感の割引を反映)。最低 1。 */
export function skillMpCostOf(c: Combatant): number {
  return Math.max(1, Math.round(BATTLE_TUNING.skillMpCost * mpCostFactorOf(c)));
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
  heal: 'いのり (HP 回復)',
};

/** とくぎ種別のカテゴリ説明ラベル (UI の補足)。基本 6 種のみ定義があり、確定キット (#456) の
 *  固有 id は名前自体が説明的なため undefined を返す (UI は補足を出さない)。 */
export function skillKindLabel(kind: string): string | undefined {
  return (SKILL_KIND_LABELS as Record<string, string>)[kind];
}

// ─── 戦闘参加者 ─────────────────────────────────────────────

export interface Combatant {
  name: string;
  maxHp: number;
  hp: number;
  /** MP。特技で消費。プレイヤーは MP 特性 (JOB_MP_TRAITS) を持つジョブのみ回復。
   *  モンスターも int から MP を持ち (fromStats)、ため/回復の特技コストに使う
   *  (尽きると通常攻撃に落ちる = 資源の読み合い。オーナー提案 2026-07-18)。 */
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
    statuses: [],
    passives: [],
  };
}

/**
 * 装備の平坦ボーナスを 1 箇所で解決する (#511)。**gear (GearSelection) と equipIds が両方来たら
 * gear を優先し equipIds は無視する** — 両方を加算すると同じ装備が二重に効くため (実測: def 15 →
 * 単一 17 → 両方 19)。gear がアプリ本則 (強化値つき個体)、equipIds は sim 用の簡易形。
 * どちらも無ければ null (呼び出し側は加算をスキップ)。
 */
function gearFlatBonus(archetype: Archetype, equipIds?: readonly string[], gear?: GearSelection): GearBonus | null {
  if (gear) return gearBonusFromGear(archetype, gear);
  if (equipIds && equipIds.length > 0) return gearBonus(archetype, equipIds);
  return null;
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
  /** 装備中の装備 id 列 (EQUIPMENT)。丸めの後に平坦加算 (docs/20)。sim 用の簡易形。
   *  **gear を渡した場合は無視される** (下記 gearFlatBonus 参照 — 二重加算の防止)。 */
  equipIds?: readonly string[],
  /** 装備中の個体 (強化値つき)。アプリ本則はこちら (gear/self の解決結果)。equipIds より優先。 */
  gear?: GearSelection,
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
  const c = fromStats(displayName, grown, factor, playerLevel);
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
  // 装備は gearFlatBonus で 1 箇所解決 (gear 優先・二重加算なし。#511)。playerCombatant と同じ規則。
  const bonus = gearFlatBonus(archetype, equipIds, gear);
  const eq = (k: 'atk' | 'def' | 'agi' | 'int' | 'luk' | 'maxHp') => bonus?.[k] ?? 0;
  return {
    atk: g(0) + eq('atk'),
    def: g(1) + eq('def'),
    agi: g(2) + eq('agi'),
    int: g(3) + eq('int'),
    luk: g(4) + eq('luk'),
    maxHp: t.hpBase + (base[1]! + flat) * t.hpDefScale * factor + playerLevel * t.hpLevelScale + eq('maxHp'),
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
  | 'metal-slime'
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
  /** HP/MP を明示する (プレイヤーと同じ完全ステータスブロック — オーナー要望 2026-07-19)。
   *  省略時は従来どおり def/int から導出 (後方互換)。はぐれメタル型のように
   *  「導出だと def なりに HP が出てしまう」敵を低 HP に手調整するのに使う。
   *  値は tier/レベル係数で従来同様にスケールする (基準値のみ明示)。 */
  hp?: number;
  mp?: number;
  /** 出現の重み (default 1)。レア敵 (はぐれメタル等) は 1 未満にして稀にする。 */
  spawnWeight?: number;
  /** 色違い変種の主要な塗り色 (CSS color)。同じ species の SVG の主体色を差し替えて
   *  「あかいスライム」等の強い版/レッサーを安価に作る (オーナー要望 2026-07-19)。
   *  hue-rotate は輝度保存で狙った色にならない事故があるため明示色を持たせる。 */
  tint?: string;
  /** 勝利時に得る XP の**個別上書き**。省略時は `baselineXp(def)` が実効的な強さ (基準 HP +
   *  atk/agi) から算出する (式＋個別調整 — オーナー要望 2026-07-20)。低 HP なのに高 XP の
   *  はぐれメタル型ジャックポットや、式が合わない上位 tier はここで明示する。 */
  xp?: number;
  drops: readonly DropDef[];
  /** ひとこと (召喚時の口上に使う) */
  intro: string;
  /** 強攻撃 (charger の ため攻撃) の技名。charger 以外は省略可。 */
  skillName?: string;
  /** 行動タイプ (戦略性のためのバリエーション。オーナー要望 2026-07-18)。
   *  未指定 = plain (通常攻撃 + 低 HP でたまに防御)。
   *  'charger' = 1 ターン ため → 強攻撃 (予告を防御する読み合い。全体の ~20%)。
   *  'healer' = 低 HP でたまに自己回復 (削り切る前に倒す読み合い)。
   *  'fleer' = 毎ターン逃走を試みる (はぐれメタル型。倒す前に逃げられると報酬ゼロ)。
   *  'caster' = たまに魔法を撃つ (def 無視の属性魔撃。#456: 対物理型の看板 覇王/不動 の弱点=魔法を
   *    成立させ、後続 (#483) の清き心 (魔法反射) の前提にもなる。要 spell 定義)。 */
  ability?: 'charger' | 'healer' | 'fleer' | 'caster';
  /** healer の回復技名 (省略時デフォルト)。 */
  healName?: string;
  /** caster の魔法 (#456)。def 無視・属性つきの int スケール魔撃。ダメージ = min〜max + int*intScale。
   *  魔法致死は onLethal を通らない (物理耐性の覇王/不動 も魔法では死ぬ = 設計どおりの弱点)。
   *  データ規約: min <= max (span 負を避ける)。caster の攻撃ラベルは skillName でなくこの name を使う。 */
  spell?: { name: string; element?: Element; min: number; max: number; intScale?: number };
  /** 防御属性 (#455 / docs/25 §1)。被弾時の属性相性に使う。未指定 = 無属性 (常に等倍)。
   *  キャスターが弱点を突く駆け引きの導線 (賢者/魔法使いの属性撃ち分けが機能する)。 */
  element?: Element;
  /** すべての魔法を無効化 (メタル系。DQ 準拠)。true だと fixedDamage/doMagic が最小 1 になる。
   *  物理は既に超高 def で 1 に沈むが、魔法は def 無視のため別途この旗で止める。 */
  resistAllMagic?: boolean;
}

/** 素材カタログ (Step2 の装備素材)。 */
export const ITEMS: Record<string, { name: string }> = {
  herb: { name: 'やくそう' },
  'sky-dew': { name: 'そらのしずく' }, // MP 回復薬。青空の朝露 (世界観準拠の命名)
  'sky-feather': { name: 'そらのはね' }, // 最後に立ち寄った街へ帰還 (フィールド専用)
  'slime-drop': { name: 'スライムのしずく' },
  'red-jelly': { name: 'あかいゼリー' }, // あかいスライム(強い版)のドロップ。現状は換金専用 (P4 クラフト素材に転用予定)
  'metal-shard': { name: 'はぐれのかけら' }, // はぐれスライムの希少ドロップ。現状は換金専用 (将来レア装備素材に転用予定)
  'dusk-wing': { name: 'よいやみの翼膜' }, // よるのコウモリ(強い版)のドロップ。現状は換金専用 (P4 クラフト素材に転用予定)
  'crimson-spore': { name: 'べにの胞子' }, // べにヒカリダケ(強い版)のドロップ。現状は換金専用 (P4 クラフト素材に転用予定)
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
  // tier1: 手習い (初心者でも勝てる)。**HP を明示して弱い敵は本当に弱く**した (以前は hpBase=66 が
  // 支配的で全 tier1 が HP~70 横並び → 序盤が重い真因。オーナー指摘 2026-07-20)。XP は xp を省いて
  // baselineXp (基準 HP + atk/agi) で自動算出 = 敵の強さと XP が構造的に連動する (スライム 2・
  // ヒカリダケ 8 程度)。個別に効かせたい敵だけ xp を明示する。
  // そらいろスライム: 最弱の練習敵 (低 HP・低 XP・低ドロップ)。序盤の的。
  { id: 'sky-slime', element: 'water', name: 'そらいろスライム', species: 'slime', tier: 1, stats: [7, 7, 8, 6, 10], hp: 5, drops: [{ item: 'slime-drop', chance: 0.3 }, { item: 'herb', chance: 0.35 }], intro: 'ぷるぷると跳ねている。' },
  // 色違い強い版 (tint で塗り替え)。base より少し硬く XP/素材も上。専用素材 red-jelly。
  { id: 'red-slime', element: 'fire', name: 'あかいスライム', species: 'slime', tint: '#e0574a', spawnWeight: 0.4, tier: 1, stats: [13, 12, 10, 8, 12], hp: 8, drops: [{ item: 'red-jelly', chance: 0.5 }, { item: 'herb', chance: 0.08 }], intro: '赤くぬめって 脈打っている。' },
  { id: 'cave-bat', element: 'wind', name: 'ほらあなコウモリ', species: 'bat', tier: 1, stats: [12, 8, 26, 6, 12], hp: 11, drops: [{ item: 'bat-wing', chance: 0.6 }, { item: 'herb', chance: 0.3 }, { item: 'sky-feather', chance: 0.12 }], intro: 'ばさばさと羽音を立てている。' },
  { id: 'dusk-bat', element: 'wind', name: 'よるのコウモリ', species: 'bat', tint: '#5b6bd0', spawnWeight: 0.4, tier: 1, stats: [14, 9, 28, 7, 13], hp: 10, drops: [{ item: 'dusk-wing', chance: 0.5 }, { item: 'sky-feather', chance: 0.12 }], intro: '夜色の翼で 音もなく舞う。' },
  { id: 'glow-shroom', element: 'earth', name: 'ヒカリダケ', species: 'mushroom', tier: 1, stats: [8, 20, 4, 18, 12], hp: 14, drops: [{ item: 'mush-spore', chance: 0.6 }, { item: 'herb', chance: 0.4 }, { item: 'sky-dew', chance: 0.25 }], intro: 'ほんのり光って動かない…?' },
  { id: 'crimson-shroom', element: 'earth', name: 'べにヒカリダケ', species: 'mushroom', tint: '#c23a5b', spawnWeight: 0.4, tier: 1, stats: [9, 22, 4, 20, 12], hp: 12, drops: [{ item: 'crimson-spore', chance: 0.5 }, { item: 'sky-dew', chance: 0.2 }], intro: '毒々しい紅に 明滅している。' },
  // はぐれメタル型 (DQ のメタルスライム): レア出現・高 XP (100)・毎ターン逃走。
  //   - **超高守備 (def240)**: 減算式で通常攻撃は atkTerm−defTerm が深く負に沈み minDamage(1) しか
  //     通らない = 「当たってもダメージがほとんど通らない」(オーナー要望 2026-07-21)。魔撃 (spell,
  //     defFactor0.5) でも def が大きすぎて 1 = メタルは魔法も効かない (DQ 準拠)。
  //   - **高 agi (38)**: 回避 (最大 dodgeMax) が張り付き「避けられる」。
  //   - **低 HP (6→tier係数で実質4)**: 仕留める道は**会心の一撃のみ** (プレイヤーの会心は def 無視
  //     #432 → フルダメージで一撃)。通常/魔撃では削り切る前に逃げる。専用ロジックは使わず
  //     守備/agi/HP の数値だけで「メタル」を表現 (オーナー: 専用ロジック禁止 2026-07-20)。
  { id: 'stray-slime', resistAllMagic: true, name: 'はぐれスライム', species: 'metal-slime', tier: 1, stats: [8, 240, 38, 6, 34], hp: 6, mp: 0, xp: 100, spawnWeight: 0.06, drops: [{ item: 'metal-shard', chance: 0.5 }], ability: 'fleer', intro: 'きらりと 金属の光を放っている。' },
  // tier2: 修練。xp 34〜52 (healer は削り合いが長引くぶん高め)
  { id: 'moss-golem', element: 'earth', name: 'こけむしゴーレム', species: 'golem', tier: 2, stats: [38, 36, 6, 10, 8], hp: 28, xp: 34, drops: [{ item: 'golem-core', chance: 0.5 }, { item: 'herb', chance: 0.2 }], intro: '地響きを立てて起き上がった。', skillName: 'いわなだれ', ability: 'charger' },
  { id: 'will-o-wisp', element: 'fire', name: 'あおい鬼火', species: 'wisp', tier: 2, stats: [18, 12, 24, 34, 12], hp: 24, xp: 52, drops: [{ item: 'wisp-ember', chance: 0.5 }, { item: 'sky-dew', chance: 0.35 }], intro: 'ゆらゆらとこちらを見ている。', ability: 'healer', healName: 'いやしのゆらめき' },
  { id: 'river-serpent', element: 'water', name: 'かわながれ大蛇', species: 'serpent', tier: 2, stats: [42, 18, 22, 10, 10], hp: 22, xp: 42, drops: [{ item: 'serpent-scale', chance: 0.5 }, { item: 'herb', chance: 0.2 }], intro: '水面から鎌首をもたげた。', skillName: 'まきつき' },
  // tier3: 真剣勝負。xp 62〜96
  { id: 'night-raven', element: 'wind', name: 'よるのおおガラス', species: 'raven', tier: 3, stats: [48, 14, 34, 16, 14], hp: 24, xp: 62, drops: [{ item: 'raven-feather', chance: 0.45 }, { item: 'sky-dew', chance: 0.3 }, { item: 'sky-feather', chance: 0.25 }], intro: '月を背に静かに舞い降りた。', ability: 'caster', spell: { name: 'かまいたち', element: 'wind', min: 4, max: 8, intScale: 0.1 } },
  { id: 'blue-oni', element: 'water', name: 'あおおに', species: 'oni', tier: 3, stats: [66, 28, 12, 8, 12], hp: 30, xp: 78, drops: [{ item: 'oni-horn', chance: 0.45 }], intro: '金棒を担いで笑っている。', skillName: 'かなぼうふりまわし', ability: 'charger' },
  { id: 'sky-dragon', element: 'void', name: 'そらのりゅう', species: 'dragon', tier: 3, stats: [58, 24, 18, 26, 10], hp: 30, xp: 96, drops: [{ item: 'dragon-fang', chance: 0.4 }], intro: '雲を裂いて姿を現した!', ability: 'healer', healName: 'りゅうの いこい' },
];

export const MONSTERS_BY_ID: Record<string, MonsterDef> = Object.fromEntries(
  MONSTERS.map((m) => [m.id, m]),
);

/** XP 算出式の係数 (式＋個別調整の「式」側)。倒す手間 (基準 HP) と脅威 (atk+agi) から出す。
 *  tier1 帯 (DQ 級スケールで基準 HP 5〜14) でおおむね 2〜9 になるよう校正 (オーナー要望 2026-07-20)。 */
const XP_HP_FLOOR = 3; // これ以下の基準 HP は XP に寄与しない (最弱の下限を作る)。DQ 級スケール (敵 HP ひとけた) に合わせ 10→3
const XP_HP_SCALE = 0.6; // 基準 HP 1 あたりの XP。HP が ~1/4 に縮んだぶん係数を ~4倍 (0.15→0.6) して XP 出力を保つ
const XP_OFFENSE_SCALE = 0.04; // (atk+agi) 1 あたりの XP (素早い/強い敵を少し厚く)

/** モンスターの XP 既定値を「実効的な強さ」から算出する (式＋個別調整の式側)。基準 HP は
 *  def.hp があればそれ、無ければ従来の導出 (hpBase + def*hpDefScale)。敵の強さと XP を
 *  構造的に連動させる (スライム=低 HP=低 XP、硬い敵=高 HP=高 XP。オーナー要望 2026-07-20)。
 *
 *  **校正は tier1 帯のみ** (基準 HP 12〜62 でおおむね 2〜9)。tier2/3 に生で使うと過小になる
 *  (例: sky-dragon 式 ~12 vs 現行 96) ので、**tier2/3 は必ず def.xp を明示する** (回帰テスト
 *  「tier2/3 は xp を明示」で固定)。tier をまたいで式化したくなったら tier 係数が要る。
 *
 *  **基準 HP はレベル 1 相当の名目値**。実 HP は factor でレベルに応じ伸びるが、XP は
 *  レベル非依存に固定する (サーバーが monsterId だけから決定的に再導出できるため — docs/21)。 */
export function baselineXp(def: MonsterDef): number {
  const baseHp = def.hp ?? BATTLE_TUNING.hpBase + def.stats[1] * BATTLE_TUNING.hpDefScale;
  const [atk, , agi] = def.stats;
  return Math.max(1, Math.round(Math.max(0, baseHp - XP_HP_FLOOR) * XP_HP_SCALE + (atk + agi) * XP_OFFENSE_SCALE));
}

/** 勝利時に得る XP。def.xp があればそれ (個別上書き)、無ければ baselineXp。
 *  未知 id は BATTLE_TUNING.xpWin にフォールバック。world / 試練の両方でこれを使う。 */
export function battleXpFor(monsterId: string): number {
  const def = MONSTERS_BY_ID[monsterId];
  if (!def) return BATTLE_TUNING.xpWin;
  return def.xp ?? baselineXp(def);
}

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

/** tier = エリアの固定難易度。tier1 は明確に弱め (0.72 で Lv1 の 5 連戦生存が健全)。 */
const TIER_STRENGTH: Record<1 | 2 | 3, number> = { 1: 0.72, 2: 1.1, 3: 1.36 };

/** モンスターの強化倍率。**プレイヤー/ジョブのレベルには追従しない = 固定強度**
 *  (「自分の強さに合わせて敵も強くなるのはダメ」— オーナー要望 2026-07-20)。tier は
 *  エリアの固定難易度で、プレイヤーが強くなれば相対的に楽になる。後半の難易度は
 *  レベル追従ではなく「エリアごとに強い敵を配置」で作る。将来エンドコンテンツで追従を
 *  戻すなら、tier 限定でここに足す。 */
function monsterLevelFactor(tier: 1 | 2 | 3): number {
  return TIER_STRENGTH[tier];
}

/** 地域相性の重み (favor 対象のモンスターをこの倍率で優遇)。3 = そのモンスターが
 *  約 6 割 (残り 2 種が各 2 割) で出る = 地域の顔が立つ水準。 */
const AFFINITY_WEIGHT = 3;

/** その tier で affinity が最も出やすくするモンスター (地域相性の「○○が多い」導線用)。 */
export function favoredMonsterFor(tier: 1 | 2 | 3, affinity: number): MonsterDef {
  const pool = MONSTERS.filter((m) => m.tier === tier);
  return pool[((affinity % pool.length) + pool.length) % pool.length]!;
}

/**
 * tier のプールからモンスターを選ぶ。affinity (地域の相性 = regionAffinity) が指定
 * されると `pool[affinity % pool.length]` を AFFINITY_WEIGHT 倍で重み付け抽選する
 * (同じ tier でも地域ごとに顔ぶれが変わる = ドロップ素材も偏る。オーナー要望 2026-07-18)。
 * index 方式なので favor 対象は必ず実在し、相性が死ぬ地域が無い (レビュー ★★★)。
 */
export function summonMonster(
  tier: 1 | 2 | 3,
  playerLevel: number,
  seed: number,
  jobLevel = 1,
  affinity?: number,
  /** HP/MP の分散 (±割合)。0 のとき従来どおり固定 (rng も引かないので試練/既存テスト
   *  の乱数ストリームは不変)。world は BATTLE_TUNING.monsterVitalsVariance を渡す。 */
  variance = 0,
): { def: MonsterDef; combatant: Combatant } {
  const pool = MONSTERS.filter((m) => m.tier === tier);
  const rng = createRng((seed ^ 0x51ed270b) >>> 0);
  // 出現重み = spawnWeight (default 1) × affinity 補正 (favor 対象を重く)。ただし
  // レア敵 (spawnWeight<1) は favor 対象にしない = どの地域でもごく稀のまま
  // (地域相性で「はぐれメタルが出やすい街」を作らない — レビュー ★★)。重み付き累積抽選 (決定的)。
  const favored = affinity === undefined ? -1 : ((affinity % pool.length) + pool.length) % pool.length;
  const weights = pool.map((m, i) => {
    const w = m.spawnWeight ?? 1;
    return w * (i === favored && w >= 1 ? AFFINITY_WEIGHT : 1);
  });
  const total = weights.reduce((a, b) => a + b, 0);
  let pick = rng() * total;
  let idx = 0;
  for (; idx < pool.length; idx++) {
    pick -= weights[idx]!;
    if (pick < 0) break;
  }
  const def = pool[Math.min(idx, pool.length - 1)]!;
  // 固定強度: プレイヤー/ジョブレベルに追従しない (オーナー要望 2026-07-20)。factor は tier のみ、
  // 平坦成長 (flatLevelGain) も与えず、HP の level 項も固定 1 にする。playerLevel/jobLevel 引数は
  // 呼び出し文脈として残すが強度計算には使わない (将来のエンドコンテンツ追従の受け皿)。
  void playerLevel;
  void jobLevel;
  return { def, combatant: monsterCombatant(def, variance, rng) };
}

/** モンスター def から戦闘値 (Combatant) を作る。tier 固定強度 (factor) + 明示 HP/MP 上書き +
 *  遭遇ごとの分散ジッター。variance=0 のときは rng を引かない (乱数ストリームを従来と一致させ
 *  テスト/決定論を保つ)。summonMonster (tier 抽選) と、模擬戦の敵指定の双方から使う。 */
export function monsterCombatant(def: MonsterDef, variance: number, rng: () => number): Combatant {
  const factor = monsterLevelFactor(def.tier);
  const c = fromStats(def.name, def.stats, factor, 1);
  // HP/MP を明示している敵はその値で上書き (プレイヤーと同じ完全ステータス — 導出に頼らない)。
  if (def.hp !== undefined) { c.maxHp = Math.max(1, Math.round(def.hp * factor)); c.hp = c.maxHp; }
  if (def.mp !== undefined) { c.maxMp = Math.max(0, Math.round(def.mp * factor)); c.mp = c.maxMp; }
  if (variance > 0) {
    const jitter = () => 1 + (rng() * 2 - 1) * variance;
    c.maxHp = Math.max(1, Math.round(c.maxHp * jitter())); c.hp = c.maxHp;
    c.maxMp = Math.max(0, Math.round(c.maxMp * jitter())); c.mp = c.maxMp;
  }
  // 属性・魔法耐性 (#455)。属性相性はキャスターの弱点突き、resistAllMagic はメタルの魔法無効。
  if (def.element !== undefined) c.element = def.element;
  if (def.resistAllMagic) c.resistAllMagic = true;
  c.monsterId = def.id; // マルチ戦闘で敵個体ごとに ability/spell を引く (#453)
  return c;
}

// ─── バトル状態と解決 ───────────────────────────────────────

export type Command = 'attack' | 'guard' | 'skill' | 'herb' | 'tonic' | 'flee';

export type BattleOutcome = 'ongoing' | 'win' | 'lose' | 'draw' | 'fled' | 'monster-fled';

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
  /** マルチ戦闘の味方陣 (player + 召喚 + NPC)。#453 / docs/25 §14.8。省略時はソロ = [player]。
   *  慣例として allies[0] === player (player 固有資源 herbs/tonics 等は BattleState 側に残す)。 */
  allies?: Combatant[];
  /** マルチ戦闘の敵陣 (モンスター群)。省略時はソロ = [monster]。慣例として enemies[0] === monster。 */
  enemies?: Combatant[];
  /** 署名スキル ([0])。後方互換 (parry 判定・autoBattle 等はこれ)。 */
  playerSkill: JobSkill;
  /** その jobLevel で使える全とくぎ ([0]=署名 + 習得済み副スキル)。UI は毎ターンここから選ぶ (#436)。 */
  playerSkills: JobSkill[];
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

/**
 * 戦闘の両陣営を取り出す (#453)。マルチ戦闘なら allies/enemies 配列、ソロ (未設定 or 旧 sealed
 * state) なら [player]/[monster] に退避する。ターゲット解決・行動順の単一窓口。
 */
export function combatSides(state: BattleState): CombatSides {
  return {
    allies: state.allies && state.allies.length > 0 ? state.allies : [state.player],
    enemies: state.enemies && state.enemies.length > 0 ? state.enemies : [state.monster],
  };
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
    /** 装備中の装備 id 列 (EQUIPMENT)。sim 用の簡易形 */
    equipIds?: readonly string[];
    /** 装備中の個体 (強化値つき)。アプリ本則 */
    gear?: GearSelection;
    /** 地域の相性 (regionAffinity)。指定するとその型のモンスターが出やすくなる。 */
    affinity?: number;
    /** 敵 HP/MP の分散 (±割合)。world 遭遇のみ指定、trial は未指定 = 0 (固定)。 */
    vitalsVariance?: number;
    /** 出現を tier 抽選せず**この id のモンスターに固定**する (模擬戦シミュレータ用)。
     *  未知 id は無視して従来どおり tier 抽選。 */
    monsterId?: string;
    /** 追加の敵数 (#453 マルチ戦闘: 群れ)。0=ソロ (従来・enemies 未設定)、1〜2 で計 2〜3 体。
     *  各追加敵は同 tier から別 seed で抽選し monsterId を保持。allies=[player]・enemies=[主敵, …追加] を設定。 */
    extraEnemies?: number;
  },
): BattleState {
  const player = playerCombatant(archetype, jobLevel, playerLevel, displayName, extras?.baseStats, extras?.equipIds, extras?.gear);
  if (carry?.hp !== undefined) {
    player.hp = Math.max(1, Math.min(player.maxHp, Math.floor(carry.hp)));
  }
  if (carry?.mp !== undefined) {
    player.mp = Math.max(0, Math.min(player.maxMp, Math.floor(carry.mp)));
  }
  const variance = extras?.vitalsVariance ?? 0;
  const forced = extras?.monsterId ? MONSTERS_BY_ID[extras.monsterId] : undefined;
  const { def, combatant } = forced
    ? { def: forced, combatant: monsterCombatant(forced, variance, createRng((seed ^ 0x2a9f) >>> 0)) }
    : summonMonster(tier, playerLevel, seed, jobLevel, extras?.affinity, variance);
  const gains = mpGainsFor(archetype);
  // #453 群れ: 追加の敵を別 seed で抽選 (最大 +2 = 計 3 体)。0 のとき enemies 未設定 = 従来ソロ。
  const extraCount = Math.max(0, Math.min(2, Math.floor(extras?.extraEnemies ?? 0)));
  const enemies: Combatant[] = [combatant];
  for (let i = 0; i < extraCount; i++) {
    const es = (seed ^ (0x9e3779b1 * (i + 1))) >>> 0;
    enemies.push(
      forced
        ? monsterCombatant(forced, variance, createRng((es ^ 0x2a9f) >>> 0))
        : summonMonster(tier, playerLevel, es, jobLevel, extras?.affinity, variance).combatant,
    );
  }
  return {
    seed,
    turn: 0,
    player,
    monster: combatant,
    monsterId: def.id,
    ...(extraCount > 0 ? { allies: [player], enemies } : {}),
    playerSkill: skillForJob(archetype),
    playerSkills: skillsForJob(archetype, jobLevel),
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

export interface AttackOptions {
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
  /** 攻撃属性 (#452 / docs/25 §1)。防御側の element と相性判定。未指定 (無属性) は等倍。 */
  element?: Element;
}

/** 攻撃 1 回の結果 (とくぎの inflict-on-hit 等が参照)。 */
export interface AttackResult {
  /** 命中したか (回避されたら false)。 */
  hit: boolean;
  /** 与えたダメージ (miss は 0)。 */
  damage: number;
  /** 対象を倒したか。 */
  fatal: boolean;
  /** 会心だったか。 */
  crit: boolean;
}

function doAttack(
  attacker: Combatant,
  defender: Combatant,
  rng: () => number,
  events: TurnEvent[],
  actor: 'player' | 'monster',
  opts: AttackOptions = {},
): AttackResult {
  const t = BATTLE_TUNING;
  const label = opts.label ? `${attacker.name}の${opts.label}!` : `${attacker.name}のこうげき!`;
  // 状態異常/パッシブのフック文脈 (#452)。空 statuses なら applyXxx は入力そのまま = 従来挙動。
  const defenderSide: 'player' | 'monster' = actor === 'player' ? 'monster' : 'player';
  const atkCtx: HookCtx = { rng, events, actor };
  const defCtx: HookCtx = { rng, events, actor: defenderSide };

  // 回避判定 (魔撃は必中)。ぼうぎょの余韻 (focus) 中は「動きを読めている」ので回避が上がる。
  if (!opts.useInt) {
    const focusBonus = defender.focus > 0 ? t.guardFocusDodge : 0;
    // 命中補正 (accDown: 攻撃側の命中が下がる)。none なら opts.hitBonus のまま。
    const effHitBonus = applyModifyHit(opts.hitBonus ?? 0, attacker, atkCtx);
    let dodge = Math.min(
      t.dodgeMax + focusBonus,
      Math.max(t.dodgeMin, t.dodgeBase + (defender.agi - attacker.agi) * t.agiDodgeScale - effHitBonus + focusBonus),
    );
    dodge = applyDodgeCalc(dodge, defender, defCtx); // かくれみ/agi バフ
    if (rng() < dodge) {
      events.push({ actor, text: `${label} しかし ${defender.name}は身をかわした!` });
      return { hit: false, damage: 0, fatal: false, crit: false };
    }
  }

  // 命中確定後、即死パッシブ (首狩り等) の判定。none なら false。
  if (applyOnHit(attacker, defender, atkCtx)) {
    const killDmg = defender.hp;
    defender.hp = 0;
    clearHitStatuses(defender);
    events.push({ actor, text: `${label} ${defender.name}を一撃で仕留めた!`, damage: killDmg, fatal: true });
    return { hit: true, damage: killDmg, fatal: true, crit: false };
  }

  const atkValue = opts.atkOverride ?? (opts.useInt ? attacker.int : attacker.atk);
  const roll = 0.85 + rng() * 0.3;
  // クリティカル (luk)。会心は DQ のかいしんのいちげき流: **攻撃力 critAtkMultiplier 倍**。
  // **守備力 (def) 無視はプレイヤーの会心のみ** (守備の高い敵を貫く一発逆転。オーナー要望
  // 2026-07-20)。敵の会心を守備無視にすると、タンク職 (guardian) の「固く受ける」存在意義が
  // 壊れ拮抗帯で事故死が倍増するため、敵の会心は 1.5 倍のみ (バランス ★★★)。ぼうぎょ/見切り
  // **コマンドの半減はどちらも貫通しない** — 貫くと「予告を見て防御」の読み合いが崩れる (設計 ★★★)。
  const crit = applyCritCalc(rng() < t.critBase + attacker.luk * t.critLukScale, attacker, atkCtx); // 九字切り=確定会心
  const critAtk = crit ? t.critAtkMultiplier : 1;
  const defValue = crit && actor === 'player' ? 0 : defender.def * (opts.defFactor ?? 1);
  // DQ の減算式 (攻撃÷2 − 防御÷4) 流: **防御の係数 (defCoef) を攻撃の半分 (2:1)** にしてインフレを
  // 抑える (オーナー要望 2026-07-20)。高守備の敵 (メタル) は atkTerm−defTerm が負に沈み minDamage
  // しか通らず、会心 (defValue=0) のみ貫通できる = 専用ロジック不要で「守備が硬い」が表現される。
  // 攻撃威力バフ (atkUp/atkDown)。none なら ×1。
  const atkTerm = atkValue * t.atkCoef * critAtk * (opts.power ?? 1) * applyPowerCalc(1, attacker, atkCtx);
  let dmg = Math.max(t.minDamage, (atkTerm - defValue * t.defCoef) * roll);

  // 防御 / 見切りで半減 (会心でもコマンド防御は効く = 防御の存在意義を守る)
  if (defender.guarding || defender.parrying) dmg *= t.guardReduction;
  // 被ダメバフ (defUp/defDown/転倒)。none なら ×1。
  dmg *= applyIncomingCalc(1, defender, defCtx);
  // 属性相性 (#452 §1): 攻撃属性 × 防御属性。両者 undefined (無属性) なら ×1 = 従来挙動。
  // モンスター/装備への属性付与は #455/#456 で配線。慧眼 (賢者) は弱点時さらに増幅 (none なら素通し)。
  dmg *= applyElementBonus(elementMultiplier(opts.element, defender.element), attacker, atkCtx);
  // 対象状態シナジー: 審美眼 (芸術家) は状態異常の敵に与ダメ↑ (none なら素通し)。
  dmg *= applyTargetBonus(1, attacker, defender, atkCtx);

  // 丸めの後にも最低 1 を保証 (guardReduction で 0.5 に落ちて round(0) になる境界対策)。
  // minDamage を将来 0 等に変える場合、この行のハード 1 も一緒に見直すこと (二重下限の注意)。
  const final = Math.max(1, Math.round(dmg));
  // 物理致死の直前に onLethal フック (覇王/不動) を確認。survive なら HP1 で耐える (反射等は
  // ハンドラ内で処理済み)。魔法致死は doMagic を通るためここには来ず、耐えられず死ぬ (§12)。
  if (defender.hp - final <= 0 && applyOnLethal(defender, attacker, final, defCtx)) {
    defender.hp = 1;
  } else {
    defender.hp = Math.max(0, defender.hp - final);
  }
  const fatal = defender.hp === 0;
  // 被弾で解ける状態 (かくれみ解除・眠り起床)。none なら no-op。
  if (!fatal) clearHitStatuses(defender);
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
  const result: AttackResult = { hit: true, damage: final, fatal, crit };

  // 被弾後フック (とげの盾: 攻撃者へ反射)。倒れていなければ。none なら no-op。
  if (!fatal) applyOnDamaged(defender, attacker, final, defCtx);

  // 見切り反撃 (倒れていなければ)
  if (!fatal && defender.parrying) {
    defender.parrying = false;
    const counterActor = actor === 'player' ? 'monster' : 'player';
    // 反撃は支配ステータス (def) 基準 — 守りの固さがそのまま反撃の重さになる
    // (見切り職は atk が低く、atk 基準だと tier3 で火力が出ずジリ貧になる)
    doAttack(defender, attacker, rng, events, counterActor, { power: 0.75, atkOverride: defender.def, label: 'はんげき' });
  }
  return result;
}

/**
 * 魔法ダメージ (#456 / docs/25 §14.6・§423)。**範囲ベース・必中・def 無視** (DQ 流)。
 * `amount` は呼び出し側 (とくぎ) が範囲 roll + int 連動で算出済みの生ダメージ。ここで
 * **属性相性 (§1) と被ダメバフ (defUp/defDown)** を掛けて確定・適用する。会心・回避・反撃なし。
 * 物理 (doAttack) と違い defender の def を一切見ないため、守備の高い敵にも通る (メタルの魔法無効は
 * #455 で monster resist として別途)。
 */
function doMagic(
  attacker: Combatant,
  defender: Combatant,
  rng: () => number,
  events: TurnEvent[],
  actor: 'player' | 'monster',
  opts: { amount: number; element?: Element; label?: string },
): AttackResult {
  const label = opts.label ? `${attacker.name}の${opts.label}!` : `${attacker.name}の魔法!`;
  const defenderSide: 'player' | 'monster' = actor === 'player' ? 'monster' : 'player';
  const defCtx: HookCtx = { rng, events, actor: defenderSide };
  const atkCtx: HookCtx = { rng, events, actor };
  let dmg = opts.amount;
  // 属性相性 (無属性は ×1)。慧眼 (賢者) は弱点時さらに増幅 (none なら素通し)。
  const eMult = applyElementBonus(elementMultiplier(opts.element, defender.element), attacker, atkCtx);
  dmg *= eMult;
  dmg *= applyTargetBonus(1, attacker, defender, atkCtx); // 審美眼: 状態異常の敵に与ダメ↑ (none 素通し)
  dmg *= applyIncomingCalc(1, defender, defCtx); // defUp/defDown/転倒
  // メタル系の魔法無効 (#455 / DQ 準拠): def 無視の魔法でも最小 1 に抑える (会心物理でしか倒せない)。
  const final = defender.resistAllMagic ? 1 : Math.max(1, Math.round(dmg));
  // 清き心 (聖騎士): 低確率で魔法反射 (被弾側フック)。reflect なら被弾 0・術者へ跳ね返し済み (ハンドラ内)。
  // 被弾 0 なので clearHitStatuses (かくれみ/眠り解除) も弱点告知も出さないのが正 (被弾していない扱い)。
  // 将来の見切り (魔法ミス化=回避) も同じ「被弾 0」結果なので、必要なら返り値に nullify を足して分岐する。
  if (!defender.resistAllMagic && applyOnIncomingMagic(defender, attacker, final, defCtx)) {
    return { hit: true, damage: 0, fatal: false, crit: false };
  }
  defender.hp = Math.max(0, defender.hp - final);
  const fatal = defender.hp === 0;
  if (!fatal) clearHitStatuses(defender); // 被弾で解ける状態 (かくれみ/眠り)
  const fatalText = fatal
    ? actor === 'player'
      ? `。${defender.name}をたおした!`
      : `。${defender.name}はちからつきた…!`
    : '';
  events.push({
    actor,
    text: `${label} ${defender.name}に ${final} のダメージ${fatalText}`,
    damage: final,
    ...(fatal ? { fatal: true } : {}),
  });
  // 属性相性のフィードバック (DQ 流)。弱点=1.5 / 耐性=0.5 のみ告知 (空の 1.2 は普遍なので出さない)。
  // 撃破時も出す (弱点を突いて倒した実感)。メタルの魔法無効時は出さず「効かない」を数値 1 で伝える。
  if (!defender.resistAllMagic) {
    if (eMult >= 1.5) events.push({ actor, text: `${defender.name}の弱点を突いた!` });
    else if (eMult <= 0.5) events.push({ actor, text: `${defender.name}には 効果がいまひとつのようだ…` });
  }
  return { hit: true, damage: final, fatal, crit: false };
}

/** モンスターの行動選択 (tier が高いほど賢い)。 */
/** モンスターの行動。'charge' = ため宣言、'heal' = 自己回復 (プレイヤーの Command とは別)。 */
type MonsterAction = 'attack' | 'guard' | 'charge' | 'heal' | 'flee' | 'cast';

/** モンスター能力プラグイン (#452 / docs/25 §5)。行動 AI を ability id → データ定義に置き、
 *  monsterCommand の if 分岐を排す。null を返すと通常判定 (plain) にフォールバック。 */
interface AbilityDecisionCtx {
  state: BattleState;
  /** 行動する敵個体 (#453: マルチ戦闘で敵ごとに判断。1v1 では state.monster と同じ)。 */
  monster: Combatant;
  /** そのターンの単一乱数 (全 ability で共有 = 決定性維持)。 */
  r: number;
  t: typeof BATTLE_TUNING;
  hpRatio: number;
  /** 低 HP で身を固める余地があるか (tier2+ かつ HP<35% かつ非ため中)。 */
  canGuard: boolean;
  monsterDef: MonsterDef | undefined;
}

interface AbilityDef {
  id: string;
  decideAction(ctx: AbilityDecisionCtx): MonsterAction | null;
}

/** 能力レジストリ。新しい敵 AI は CombatHook 同様「ここに 1 エントリ足すだけ」。 */
const MONSTER_ABILITIES: Record<string, AbilityDef> = {
  // charger: 1 ターン ため → 強攻撃 (予告を防御する読み合い。全体の ~20%)
  charger: {
    id: 'charger',
    decideAction: ({ monster, r, t, canGuard }) => {
      if (monster.mp >= t.monsterChargeMpCost && r < t.chargerChargeChance) return 'charge';
      if (canGuard && r < t.chargerChargeChance + 0.15) return 'guard';
      return 'attack';
    },
  },
  // healer: 低 HP でたまに自己回復 (削り切る前に倒す読み合い)
  healer: {
    id: 'healer',
    decideAction: ({ monster, r, t, hpRatio, canGuard }) => {
      if (monster.mp >= t.monsterHealMpCost && hpRatio < t.healerLowHpRatio && r < t.healerHealChance) return 'heal';
      if (canGuard && r < t.healerHealChance + 0.15) return 'guard';
      return 'attack';
    },
  },
  // caster: MP があるうちは高確率で def 無視の属性魔撃を撃つ (#456)。対物理型 (覇王/不動) の弱点=魔法を
  // 成立させる (int 職の魔法耐性・聖騎士の魔法反射=清き心 は後続 #483 の前提)。MP 切れで通常攻撃に落ちる。
  caster: {
    id: 'caster',
    decideAction: ({ monster, r, t, canGuard, monsterDef }) => {
      if (monsterDef?.spell && monster.mp >= t.monsterCastMpCost && r < t.casterCastChance) return 'cast';
      // guard バンドは charger/healer (+0.15) よりやや狭い +0.1 — caster は攻撃寄りに保ち、魔法を撃てない
      // (MP 枯渇) ターンも殴りに来る威圧感を残すため (守りに籠らせない)。
      if (canGuard && r < t.casterCastChance + 0.1) return 'guard';
      return 'attack';
    },
  },
  // fleer: 毎ターン逃走を試みる (はぐれメタル型)。逃走率は**基準 agi (レベル非依存)** で決める —
  // factor でスケールする state.monster.agi を使うと高レベルほど逃走率が cap に張り付き、HP も
  // 上がって「成長するほど倒せない」逆進になる (レビュー ★★)。常に同じ緊張感にする。
  fleer: {
    id: 'fleer',
    decideAction: ({ r, t, monsterDef }) => {
      const baseAgi = monsterDef?.stats[2] ?? 0;
      const fleeChance = Math.min(t.monsterFleeMax, Math.max(0, t.monsterFleeBase + baseAgi * t.monsterFleeAgiScale));
      if (r < fleeChance) return 'flee';
      return 'attack';
    },
  },
};

/** モンスターの行動を能力 (ability) で決める (オーナー要望 2026-07-18: ため攻撃は
 *  一部 (~20%) に限定し、回復する敵などバリエーションで戦略性を出す)。
 *  #452: if 分岐でなく MONSTER_ABILITIES レジストリ引き (プラグイン化)。 */
function monsterCommand(monster: Combatant, state: BattleState, rng: () => number): MonsterAction {
  // 敵個体の monsterId で def を引く (#453: マルチ戦闘は敵ごとに別 def。1v1 は state.monsterId と一致)。
  const def = MONSTERS_BY_ID[monster.monsterId ?? state.monsterId];
  const t = BATTLE_TUNING;
  const r = rng();
  const hpRatio = monster.hp / monster.maxHp;
  // 低 HP でたまに身を固める (charger のため中は別処理なのでここでは除外)
  const canGuard = (def?.tier ?? 1) >= 2 && hpRatio < 0.35 && !monster.charging;

  const ability = def?.ability ? MONSTER_ABILITIES[def.ability] : undefined;
  const action = ability?.decideAction({ state, monster, r, t, hpRatio, canGuard, monsterDef: def });
  if (action) return action;

  // plain (ability 無し / null): 通常攻撃 + 低 HP でたまに防御
  if (canGuard && r < 0.25) return 'guard';
  return 'attack';
}

function playerSkillAction(state: BattleState, skill: JobSkill, rng: () => number, events: TurnEvent[]): void {
  const { player, monster } = state;
  // プラグイン実行 (#452): とくぎは SKILLS[kind] のデータ定義を EFFECT_HANDLERS で解決する。
  // 見切り (parry) 等の「宣言型」とくぎは effects 空で、宣言は resolveTurn 冒頭が担う。
  const def = SKILLS[skill.kind];
  if (!def) return;
  // ソロでも runSkillMulti で**効果ごとに対象解決**する (#453/#456)。ソロ陣営は allies=[player] /
  // enemies=[monster] の退化ケース。これにより allAllies (=自分) / allEnemies (=敵) を使うパーティ
  // 支援職 (隊長/巫女/吟遊詩人) の全体技がソロでは自己バフ/敵デバフとして機能する。既存の
  // self/oneEnemy 技は [player]/[monster] に解決され**挙動不変**。
  const sides: CombatSides = { allies: [player], enemies: [monster] };
  runSkillMulti(def, player, sides, (defender) => ({
    attacker: player,
    defender,
    rng,
    events,
    skillName: skill.name,
    actorSide: 'player',
    engine: { doAttack, doMagic },
  }));
}

/**
 * 1 ターンを解決する。player のコマンドを受け、素早さ順に両者が行動する。
 * state は**破壊しない** (新しい state を返す)。
 *
 * `turnSeed` を渡すと、そのターンの乱数を seed 由来 (`turnRng`) ではなく**外部供給の seed**で
 * 回す (docs/21-server-authority §5)。サーバー権威戦闘で Worker が毎ターン新鮮なエントロピー
 * (CSPRNG/kuda) を注入し「先読み・引き直し」を封じるための薄い口。省略時は従来どおり
 * `turnRng(seed, turn)` = 完全決定的 (試練/テストは seed 方式のまま不変)。
 */
export function resolveTurn(prev: BattleState, command: Command, turnSeed?: number, skillIndex = 0): BattleState {
  if (prev.outcome !== 'ongoing') return prev;

  // コピー (Combatant は現状 flat なので spread で足りる)。
  // 注意: 将来 Combatant に配列/オブジェクト (装備等) を足すときは deep copy に変えること
  // (shallow spread のままだとイミュータブル性が壊れる)。
  const state: BattleState = {
    ...prev,
    turn: prev.turn + 1,
    // statuses は tick で破壊的に更新するため deep copy (passives は不変なので参照共有で可)。
    // 旧 sealed state で statuses 未定義なら省略 (exactOptional 準拠・エンジンは undefined を no-op 扱い)。
    player: {
      ...prev.player,
      guarding: false,
      ...(prev.player.statuses ? { statuses: prev.player.statuses.map((s) => ({ ...s })) } : {}),
    },
    monster: {
      ...prev.monster,
      guarding: false,
      ...(prev.monster.statuses ? { statuses: prev.monster.statuses.map((s) => ({ ...s })) } : {}),
    },
    lastEvents: [],
  };
  // command==='skill' のとき使う特技 (#436: 毎ターン選択)。範囲外/未設定 (デプロイ跨ぎの旧 sealed
  // state で playerSkills が無い) は署名スキル playerSkill に安全側フォールバック。
  const skills = state.playerSkills ?? [state.playerSkill];
  const selectedSkill = skills[skillIndex] ?? skills[0] ?? state.playerSkill;
  const events: TurnEvent[] = [];
  // 外部供給 seed があればそれで (サーバー権威: 先読み不可)、無ければ seed 由来 (決定的)。
  const rng = turnSeed === undefined ? turnRng(state.seed, state.turn) : createRng(turnSeed >>> 0);
  const mCommand = monsterCommand(state.monster, state, rng);

  // ── コマンドの実効化 ──
  // MP 不足の特技 / 在庫切れのやくそうは「たたかう」にフォールバック
  // (UI は disabled にする前提。エンジン側の防御的措置で、ターンを無駄にしない)。
  const t = BATTLE_TUNING;
  let cmd: Command = command;
  const skillCost = skillMpCostOf(state.player); // 発明家/巫女の MP 割引を反映
  if (command === 'skill' && state.player.mp < skillCost) {
    events.push({ actor: 'player', text: `MP が足りない! (${state.player.mp}/${skillCost})` });
    cmd = 'attack';
  } else if (command === 'herb' && state.herbs <= 0) {
    events.push({ actor: 'player', text: 'やくそうを持っていない!' });
    cmd = 'attack';
  } else if (command === 'tonic' && state.tonics <= 0) {
    events.push({ actor: 'player', text: 'そらのしずくを持っていない!' });
    cmd = 'attack';
  }
  if (cmd === 'skill') {
    state.player.mp -= skillCost;
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
  if (cmd === 'skill' && SKILLS[selectedSkill.kind]?.parry) {
    state.player.parrying = true;
    events.push({ actor: 'player', text: `${state.player.name}は${selectedSkill.name}の構え! (防御しつつ反撃)` });
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
    if (state.outcome !== 'ongoing') return; // 敵が逃げる等で決着済みなら以降の行動をスキップ
    if (state.player.hp === 0 || state.monster.hp === 0) return;
    const self = who === 'player' ? state.player : state.monster;
    // 行動不能 (眠り/麻痺/転倒/束縛)。none なら false = 従来どおり行動。
    if (applyBeforeAct(self, { rng, events, actor: who })) return;
    // 行動前に存在した clearOnAct 状態 (前ターンからのかくれみ/九字切り) を記録。行動で「消費」し
    // 末尾で除去する。この行動中に付与した自己バフ (かくれみ/九字切りを張る等) は消さない。
    const consumedOnAct = (self.statuses ?? []).filter((s) => STATUS_REGISTRY[s.id]?.clearOnAct);
    if (who === 'player') {
      if (cmd === 'attack') {
        doAttack(state.player, state.monster, rng, events, 'player');
        if (state.mpAttackGain > 0) {
          state.player.mp = Math.min(state.player.maxMp, state.player.mp + state.mpAttackGain);
        }
      } else if (cmd === 'skill') {
        playerSkillAction(state, selectedSkill, rng, events);
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
      } else if (mCommand === 'charge') {
        // このターンは攻撃せず「ため」を予告する (charger、MP 消費)
        state.monster.mp = Math.max(0, state.monster.mp - BATTLE_TUNING.monsterChargeMpCost);
        state.monster.charging = true;
        events.push({ actor: 'monster', text: `${state.monster.name}は力をためている…!` });
      } else if (mCommand === 'heal') {
        // healer の自己回復 (MP 消費)。MP が尽きるまでの読み合いを作る
        state.monster.mp = Math.max(0, state.monster.mp - BATTLE_TUNING.monsterHealMpCost);
        const healed = Math.round(state.monster.maxHp * BATTLE_TUNING.healerHealRatio);
        const before = state.monster.hp;
        state.monster.hp = Math.min(state.monster.maxHp, state.monster.hp + healed);
        const name = MONSTERS_BY_ID[state.monsterId]?.healName ?? 'きずをいやす';
        events.push({ actor: 'monster', text: `${state.monster.name}は${name}! HP が ${state.monster.hp - before} 回復。` });
      } else if (mCommand === 'flee') {
        // はぐれメタル型: 逃走成功 → 即決着 (報酬なし)。倒せなかった悔しさを残す。
        state.outcome = 'monster-fled';
        events.push({ actor: 'monster', text: `${state.monster.name}は にげだした!` });
      } else if (mCommand === 'cast') {
        // caster の属性魔撃 (MP 消費)。def 無視・int スケール。onLethal を通らないので物理耐性の
        // 覇王/不動 も魔法致死では死ぬ (設計どおりの弱点)。聖騎士の清き心 (魔法反射) はこの doMagic 内で発火する。
        const spell = MONSTERS_BY_ID[state.monsterId]?.spell;
        if (spell) {
          state.monster.mp = Math.max(0, state.monster.mp - BATTLE_TUNING.monsterCastMpCost);
          const span = spell.max - spell.min;
          const amount = spell.min + Math.floor(rng() * (span + 1)) + Math.round(state.monster.int * (spell.intScale ?? 0));
          doMagic(state.monster, state.player, rng, events, 'monster', {
            amount,
            ...(spell.element ? { element: spell.element } : {}),
            label: spell.name,
          });
        } else {
          doAttack(state.monster, state.player, rng, events, 'monster');
        }
      } else if (mCommand === 'attack') {
        doAttack(state.monster, state.player, rng, events, 'monster');
      }
      // guard は宣言済み
    }
    // 行動で消費された状態 (前ターンからのかくれみ/九字切り) のみ除去。この行動で張った
    // 自己バフは残す (かくれみ→次ターンの攻撃で解除、が正しい)。none なら no-op。
    if (consumedOnAct.length && self.statuses) {
      self.statuses = self.statuses.filter((s) => !consumedOnAct.includes(s));
    }
  };

  act(playerFirst ? 'player' : 'monster');
  act(playerFirst ? 'monster' : 'player');

  // ターン終了の状態処理 (毒ダメージ等) → turns 減衰・除去。none なら no-op。
  // 毒で HP0 になった場合は下の勝敗判定 (hp===0) が拾う。両者が同ターンの毒で相討ちになった
  // 場合、勝敗判定は monster.hp===0 を player より先に見るため win を優先する (仕様。決定的)。
  if (state.outcome === 'ongoing') {
    tickStatuses(state.player, { rng, events, actor: 'player' });
    tickStatuses(state.monster, { rng, events, actor: 'monster' });
  }

  // 見切りは 1 ターン限り (発動しなかったら解除)。ぼうぎょの余韻 (focus) は 1 減衰。
  state.player.parrying = false;
  state.monster.parrying = false;
  state.player.focus = Math.max(0, state.player.focus - 1);

  // 勝敗判定 (敵の逃走 = monster-fled で既に決着している場合は上書きしない)
  if (state.outcome !== 'ongoing') { /* monster-fled 等: 確定済み */ }
  else if (state.monster.hp === 0) state.outcome = 'win';
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

/** Combatant を 1 ターン分コピー (guarding リセット・statuses は deep copy)。 */
function copyCombatant(c: Combatant): Combatant {
  return { ...c, guarding: false, ...(c.statuses ? { statuses: c.statuses.map((s) => ({ ...s })) } : {}) };
}

/** 生存者からランダムに 1 体 (全滅なら undefined)。 */
function randomLiving(arr: readonly Combatant[], rng: () => number): Combatant | undefined {
  const living = arr.filter((c) => c.hp > 0);
  return living.length ? living[Math.floor(rng() * living.length)] : undefined;
}

/** マルチ戦闘での敵1体の行動 (#453)。1v1 の monster act と同じ ability (charger/healer/caster) を、
 *  敵個体の monsterId で引いて実行する。ターゲットはランダムな生存味方 (挑発/かばうは後続)。
 *  flee は集団戦では意味が薄いので通常攻撃に退避する。 */
function multiEnemyAct(enemy: Combatant, allies: Combatant[], state: BattleState, rng: () => number, events: TurnEvent[]): void {
  const t = BATTLE_TUNING;
  const def = MONSTERS_BY_ID[enemy.monsterId ?? state.monsterId];
  // ため中なら宣言どおり強攻撃を解放 (mCommand は無視)。
  if (enemy.charging) {
    enemy.charging = false;
    const target = randomLiving(allies, rng);
    if (target) doAttack(enemy, target, rng, events, 'monster', { power: t.chargedPower, hitBonus: -0.05, label: def?.skillName ?? 'つよいこうげき' });
    return;
  }
  const action = monsterCommand(enemy, state, rng);
  if (action === 'guard') {
    enemy.guarding = true; // 被ダメ軽減の宣言 (turn 頭で全体リセット済み)
    return;
  }
  if (action === 'charge') {
    enemy.mp = Math.max(0, enemy.mp - t.monsterChargeMpCost);
    enemy.charging = true;
    events.push({ actor: 'monster', text: `${enemy.name}は力をためている…!` });
    return;
  }
  if (action === 'heal') {
    enemy.mp = Math.max(0, enemy.mp - t.monsterHealMpCost);
    const healed = Math.round(enemy.maxHp * t.healerHealRatio);
    const before = enemy.hp;
    enemy.hp = Math.min(enemy.maxHp, enemy.hp + healed);
    events.push({ actor: 'monster', text: `${enemy.name}は${def?.healName ?? 'きずをいやす'}! HP が ${enemy.hp - before} 回復。` });
    return;
  }
  if (action === 'cast' && def?.spell) {
    enemy.mp = Math.max(0, enemy.mp - t.monsterCastMpCost);
    const spell = def.spell;
    const span = spell.max - spell.min;
    const amount = spell.min + Math.floor(rng() * (span + 1)) + Math.round(enemy.int * (spell.intScale ?? 0));
    const target = randomLiving(allies, rng);
    if (target) doMagic(enemy, target, rng, events, 'monster', { amount, ...(spell.element ? { element: spell.element } : {}), label: spell.name });
    return;
  }
  // attack / flee (集団戦は通常攻撃に退避) / spell 未定義の cast。
  const target = randomLiving(allies, rng);
  if (target) doAttack(enemy, target, rng, events, 'monster');
}

/**
 * マルチ戦闘のターン解決 (#453 / docs/25 §14.8)。**allies[] vs enemies[]** を全員 agi+乱数で
 * 並べ、順に行動させる。ソロ用 resolveTurn とは**別経路** (1v1 は一切変更しない)。
 *
 * 現ブロックの AI: プレイヤーは command + skillIndex + targetIndex、召喚/NPC 味方はランダムな敵へ
 * 通常攻撃、敵は個体ごとの ability (charger/healer/caster) でランダムな味方へ行動 (#453。挑発/かばう・
 * 味方 autoBattle は後続)。
 */
export function resolveTurnMulti(
  prev: BattleState,
  command: Command,
  turnSeed?: number,
  skillIndex = 0,
  targetIndex = 0,
): BattleState {
  if (prev.outcome !== 'ongoing') return prev;
  const t = BATTLE_TUNING;
  // combatSides を単一窓口に (ソロ退避のロジックを二重実装しない)。各体は 1 ターン分 deep copy。
  const prevSides = combatSides(prev);
  const allies = prevSides.allies.map(copyCombatant);
  const enemies = prevSides.enemies.map(copyCombatant);
  const state: BattleState = { ...prev, turn: prev.turn + 1, allies, enemies, player: allies[0]!, monster: enemies[0]!, lastEvents: [] };
  const sides: CombatSides = { allies, enemies };
  const player = allies[0]!;
  // ぼうぎょは 1 ターン限り: copyCombatant が guarding:false でコピーするので、このターンの宣言/AI で立て直す。
  const isAlly = (c: Combatant) => allies.includes(c);
  const events: TurnEvent[] = [];
  const rng = turnSeed === undefined ? turnRng(state.seed, state.turn) : createRng(turnSeed >>> 0);

  const skills = state.playerSkills ?? [state.playerSkill];
  const selectedSkill = skills[skillIndex] ?? skills[0] ?? state.playerSkill;

  // ── コマンド実効化 (ソロと同じ防御的措置) ──
  let cmd: Command = command;
  const skillCost = skillMpCostOf(player); // 発明家/巫女の MP 割引を反映
  if (command === 'skill' && player.mp < skillCost) {
    events.push({ actor: 'player', text: `MP が足りない! (${player.mp}/${skillCost})` });
    cmd = 'attack';
  } else if (command === 'herb' && state.herbs <= 0) {
    events.push({ actor: 'player', text: 'やくそうを持っていない!' });
    cmd = 'attack';
  } else if (command === 'tonic' && state.tonics <= 0) {
    events.push({ actor: 'player', text: 'そらのしずくを持っていない!' });
    cmd = 'attack';
  }
  if (cmd === 'skill') player.mp -= skillCost;

  // 防御宣言 (行動順に依存しない)
  if (cmd === 'guard') {
    player.guarding = true;
    player.focus = 2;
    if (state.mpGuardGain > 0) {
      player.mp = Math.min(player.maxMp, player.mp + state.mpGuardGain);
      events.push({ actor: 'player', text: `${player.name}はぼうぎょして息を整えた。(MP +${state.mpGuardGain})` });
    } else {
      events.push({ actor: 'player', text: `${player.name}はぼうぎょのかまえ!` });
    }
  }
  if (cmd === 'skill' && SKILLS[selectedSkill.kind]?.parry) {
    player.parrying = true;
    events.push({ actor: 'player', text: `${player.name}は${selectedSkill.name}の構え! (防御しつつ反撃)` });
  }

  // にげる (味方全員で離脱)
  if (cmd === 'flee') {
    const fastestFoe = Math.max(...enemies.filter((e) => e.hp > 0).map((e) => e.agi), 0);
    const chance = Math.min(t.fleeMax, Math.max(t.fleeMin, t.fleeBase + (player.agi - fastestFoe) * t.fleeAgiScale));
    if (rng() < chance) {
      state.outcome = 'fled';
      events.push({ actor: 'player', text: `${player.name}たちはうまく逃げ切った!` });
      state.lastEvents = events;
      return state;
    }
    events.push({ actor: 'player', text: 'にげられない! 回り込まれてしまった!' });
  }

  // 行動順: 全参加者を agi + 乱数で並べる (playerFirst 撤廃)
  const order = [...allies, ...enemies]
    .filter((c) => c.hp > 0)
    .map((c) => ({ c, roll: c.agi + rng() * 20 }))
    .sort((a, b) => b.roll - a.roll)
    .map((x) => x.c);

  const alliesDown = () => allies.every((a) => a.hp <= 0);
  const enemiesDown = () => enemies.every((e) => e.hp <= 0);

  for (const actor of order) {
    if (state.outcome !== 'ongoing' || alliesDown() || enemiesDown()) break;
    if (actor.hp <= 0) continue; // このターン中に倒された
    const side: 'player' | 'monster' = isAlly(actor) ? 'player' : 'monster';
    if (applyBeforeAct(actor, { rng, events, actor: side })) continue; // 行動不能
    const consumed = (actor.statuses ?? []).filter((s) => STATUS_REGISTRY[s.id]?.clearOnAct);

    if (actor === player) {
      if (cmd === 'attack') {
        const target = resolveTargets(player, 'oneEnemy', sides, { targetIndex })[0];
        if (target) {
          doAttack(player, target, rng, events, 'player');
          if (state.mpAttackGain > 0) player.mp = Math.min(player.maxMp, player.mp + state.mpAttackGain);
        }
      } else if (cmd === 'skill') {
        const def = SKILLS[selectedSkill.kind];
        if (def) {
          runSkillMulti(
            def,
            player,
            sides,
            (defender) => ({ attacker: player, defender, rng, events, skillName: selectedSkill.name, actorSide: 'player', engine: { doAttack, doMagic } }),
            { targetIndex },
          );
        }
      } else if (cmd === 'herb') {
        const heal = Math.round(player.maxHp * t.herbHealRatio);
        player.hp = Math.min(player.maxHp, player.hp + heal);
        state.herbs -= 1;
        state.herbsUsed += 1;
        events.push({ actor: 'player', text: `${player.name}はやくそうを使った! HP が ${heal} 回復。(残り ${state.herbs})` });
      } else if (cmd === 'tonic') {
        const gain = Math.round(player.maxMp * t.tonicMpRatio);
        player.mp = Math.min(player.maxMp, player.mp + gain);
        state.tonics -= 1;
        state.tonicsUsed += 1;
        events.push({ actor: 'player', text: `${player.name}はそらのしずくを飲んだ! MP が ${gain} 回復。(残り ${state.tonics})` });
      }
      // guard / flee 失敗はこのターン行動なし
    } else if (isAlly(actor)) {
      // 召喚/NPC 味方: ランダムな敵へ通常攻撃 (味方版 autoBattle は後続で拡張)
      const target = randomLiving(enemies, rng);
      if (target) doAttack(actor, target, rng, events, 'player');
    } else {
      // 敵: 個体ごとの ability (charger/healer/caster) で行動 (#453)。
      multiEnemyAct(actor, allies, state, rng, events);
    }

    if (consumed.length && actor.statuses) actor.statuses = actor.statuses.filter((s) => !consumed.includes(s));
  }

  // ターン終了処理 (毒等)
  if (state.outcome === 'ongoing') {
    for (const c of [...allies, ...enemies]) {
      tickStatuses(c, { rng, events, actor: isAlly(c) ? 'player' : 'monster' });
    }
  }
  // 見切り/余韻の後始末
  for (const c of [...allies, ...enemies]) c.parrying = false;
  player.focus = Math.max(0, player.focus - 1);

  // 勝敗判定
  if (state.outcome !== 'ongoing') {
    /* fled 等: 確定済み */
  } else if (enemiesDown()) {
    state.outcome = 'win';
  } else if (alliesDown()) {
    state.outcome = 'lose';
  } else if (state.turn >= t.maxTurns) {
    const pr = allies.reduce((s, c) => s + c.hp, 0) / allies.reduce((s, c) => s + c.maxHp, 0);
    const mr = enemies.reduce((s, c) => s + c.hp, 0) / enemies.reduce((s, c) => s + c.maxHp, 0);
    state.outcome = pr > mr ? 'win' : pr < mr ? 'lose' : 'draw';
  }

  state.player = allies[0]!;
  state.monster = enemies[0]!;
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
 * - seed から決定的。ただし入力の在庫スナップショットはレコードに残らないため、
 *   記録単体からの再現・検証はできない (materialsLost は他の戦闘結果と同じく
 *   クライアント申告値。検証可能化は W3 のサーバー権威で扱う)。
 */
/** 模擬戦の自動プレイ方針 (現実的な「上手い操作」の代表)。1 ターン分のコマンドを返す。
 *  ため予告 → (見切り職は特技/それ以外は防御) / HP<45% かつ薬草 → 薬草 /
 *  MP 不足かつしずく → しずく / MP 足りれば特技 / それ以外 たたかう。
 *  scripts/sim-battle-balance.ts と /spirit 模擬戦シミュレータで共有する。 */
export function autoBattleCommand(s: BattleState): Command {
  const isParry = s.playerSkill.kind === 'parry';
  const p = s.player;
  const skillCost = skillMpCostOf(p); // 発明家 (匠) の割引を実消費と揃える (sim 判断が過小評価しないよう)
  if (s.monster.charging) return isParry && p.mp >= skillCost ? 'skill' : 'guard';
  if (s.herbs > 0 && p.hp < p.maxHp * 0.45) return 'herb';
  // 見切り (parry) 職は特技を撃たない → MP 回復しても無駄なので しずくを飲まない。
  if (!isParry && s.tonics > 0 && p.mp < skillCost && p.maxMp >= skillCost * 2) return 'tonic';
  if (!isParry && p.mp >= skillCost) return 'skill';
  return 'attack';
}

/** 自動プレイで決着まで進める (最大 maxTurns)。turnSeed は渡さず state 由来で決定的。 */
export function runAutoBattle(state: BattleState, maxTurns = 80): BattleState {
  let s = state;
  for (let i = 0; i < maxTurns && s.outcome === 'ongoing'; i++) s = resolveTurn(s, autoBattleCommand(s));
  return s;
}

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

/** 勝利時のドロップ判定。luk で上振れ。決定的 (seed 依存)。dropBonus = 巫女の直感の加算 (#456)。 */
export function rollDrops(monsterId: string, luk: number, seed: number, dropBonus = 0): string[] {
  const def = MONSTERS_BY_ID[monsterId];
  if (!def) return [];
  const rng = createRng((seed ^ 0x2545f491) >>> 0);
  const out: string[] = [];
  for (const d of def.drops) {
    // luk ボーナス + 巫女の直感 dropBonus を合算し 0.95 で clamp。dropBonus は luk 補正と天井 (0.95) を
    // **共有**するので、高 luk 職 (巫女=luk37) では既にドロップ率が高い素材で +0.1 の限界効用が逓減する
    // (青天井を防ぐ意図的な設計。数値は sim 前提の暫定値)。
    const chance = Math.min(0.95, d.chance + luk * BATTLE_TUNING.dropLukScale + dropBonus);
    if (rng() < chance) out.push(d.item);
  }
  return out;
}

/** 「しらべる」(フィールドコマンド) の調整値。オーナー要望 2026-07-18:
 *  「しらべるを使うと luk に連動してアイテムが手に入ることがあるがパワーを 1 使う」。 */
export const SEARCH_TUNING = {
  powerCost: 1,
  /** 何か見つかる基礎確率 (luk 0)。 */
  baseFindChance: 0.4,
  /** luk 1 あたりの発見確率上乗せ。 */
  findLukScale: 0.006,
  /** 発見確率の上限。 */
  maxFindChance: 0.75,
  /** 見つかったとき「その地方の素材 (tier ドロップ)」になる確率。残りは消耗品。
   *  luk でこの比率が上がる (良い運ほど素材が出やすい)。 */
  materialBase: 0.35,
  materialLukScale: 0.006,
  materialMax: 0.7,
} as const;

/** tier のモンスターが落とす素材 (しらべるで見つかる地方素材の母集団)。 */
function tierMaterials(tier: 1 | 2 | 3): string[] {
  const set = new Set<string>();
  for (const m of MONSTERS) if (m.tier === tier) for (const d of m.drops) set.add(d.item);
  // 消耗品ドロップ (herb/sky-dew/sky-feather) は除き、純粋な素材だけ
  return [...set].filter((id) => id !== 'herb' && id !== 'sky-dew' && id !== 'sky-feather');
}

/**
 * 「しらべる」の結果 (決定的)。luk が高いほど「見つかる確率」と「素材が出る比率」が
 * 上がる。見つからなければ null。seed はプレビューでは Math.random、W3 で Worker の
 * 署名付き seed に置き換える (rollDrops と同じ扱い)。
 */
export function rollSearch(seed: number, luk: number, tier: 1 | 2 | 3): string | null {
  const t = SEARCH_TUNING;
  // salt は他の roll (summonMonster/rollDrops/rollDefeatLoss) と別値にして、W3 で
  // seed を共有したときに rng ストリームが相関しないようにする (レビュー ★)
  const rng = createRng((seed ^ 0x3c6ef35f) >>> 0);
  const findChance = Math.min(t.maxFindChance, t.baseFindChance + luk * t.findLukScale);
  if (rng() >= findChance) return null; // 何も見つからなかった
  const matChance = Math.min(t.materialMax, t.materialBase + luk * t.materialLukScale);
  if (rng() < matChance) {
    const pool = tierMaterials(tier);
    if (pool.length > 0) return pool[Math.floor(rng() * pool.length)]!;
  }
  // 消耗品: やくそう多め、そらのしずく少なめ
  return rng() < 0.7 ? 'herb' : 'sky-dew';
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
