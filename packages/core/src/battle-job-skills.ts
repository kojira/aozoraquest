/**
 * ジョブの特技・キット・パッシブ・MP 特性。
 * (battle.ts から責務ごとに分割。公開 API は battle.ts から再エクスポート)
 */

import { type Archetype } from './types.js';
import { JOBS_BY_ID } from './jobs.js';
import { mpCostFactorOf } from './statuses.js';
import { BATTLE_TUNING } from './battle-tuning.js';
import { type Combatant } from './battle-combatant.js';

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

/** MP 回復のジョブ特性。
 *  **戦闘中に MP が回復するのは特性を持つジョブだけ** (全員一律の基本回復は
 *  「ジョブの差がぼやける」ため)。特性なしジョブは
 *  MP プール (int 由来) + そらのしずくでやりくりする。素の火力が低く特技依存に
 *  なるジョブ (luk/agi 型) に、世界観に沿った特性名で回復を与える。値は
 *  scripts/sim-battle-balance.ts の実測で調整。 */
export interface MpTrait {
  /** 特性名 (UI 表示用)。undefined = 特性なし (基本値) */
  name?: string;
  attackGain: number;
  guardGain: number;
  /**
   * **発動確率の基準値** (0〜1)。未指定 = 毎ターン確実に回復。
   * 実際の確率は `mpTraitChanceOf` で うん を足した値 (mpTraitChanceMax で頭打ち)。
   *
   * **未指定のジョブでは乱数を 1 つも引かない。** 引くと乱数ストリームがずれて
   * 他ジョブの戦闘結果まで変わる (mp-trait-chance.test.ts が固定している)。
   */
  chance?: number;
}

export const JOB_MP_TRAITS: Partial<Record<Archetype, MpTrait>> = {
  bard: { name: '歌の余韻', attackGain: 3, guardGain: 4 },
  // 回復とくぎ (聖光の癒し) を持つぶん、ここだけ「ときどき +1」に絞ってある。
  paladin: { name: '祈りの加護', attackGain: 1, guardGain: 1, chance: 0.5 },
  miko: { name: '神楽の集中', attackGain: 2, guardGain: 3 },
  poet: { name: '心晴の呼吸', attackGain: 2, guardGain: 3 },
  explorer: { name: '踏破の勘', attackGain: 2, guardGain: 3 },
  ninja: { name: '印の呼吸', attackGain: 2, guardGain: 3 },
  artist: { name: '色彩の集中', attackGain: 2, guardGain: 3 },
};

/** ジョブの MP 回復量 (特性がなければ基本値)。 */
export function mpGainsFor(archetype: Archetype): { attackGain: number; guardGain: number; traitName?: string; chance?: number } {
  const trait = JOB_MP_TRAITS[archetype];
  if (!trait) return { attackGain: BATTLE_TUNING.mpAttackGain, guardGain: BATTLE_TUNING.mpGuardGain };
  const r: { attackGain: number; guardGain: number; traitName?: string; chance?: number } = {
    attackGain: trait.attackGain,
    guardGain: trait.guardGain,
  };
  if (trait.name) r.traitName = trait.name;
  if (trait.chance !== undefined) r.chance = trait.chance;
  return r;
}

/**
 * 発動確率に うん を乗せた実効値。`chance` を持たない特性は undefined のまま
 * (= 毎ターン確実) を返す。
 */
export function mpTraitChanceOf(chance: number | undefined, luk: number): number | undefined {
  if (chance === undefined) return undefined;
  const t = BATTLE_TUNING;
  return Math.min(t.mpTraitChanceMax, chance + luk * t.mpTraitLukScale);
}

/**
 * MP 特性がこのターン発動するか。**確率を持つジョブのときだけ乱数を引く** —
 * 無条件に引くと他ジョブの乱数ストリームがずれて戦闘結果まで変わる。
 */
export function mpTraitFires(chance: number | undefined, rng: () => number): boolean {
  return chance === undefined || rng() < chance;
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
