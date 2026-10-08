/**
 * モンスター定義・素材カタログ・tier・XP・召喚。
 * (battle.ts から責務ごとに分割。公開 API は battle.ts から再エクスポート)
 */

import { type StatArray } from './types.js';
import { type Element } from './elements.js';
import { BATTLE_TUNING } from './battle-tuning.js';
import { createRng } from './battle-rng.js';
import { type Combatant, makeCombatant, monsterStats } from './battle-combatant.js';

// ─── モンスター ─────────────────────────────────────────────

/** SVG 描画のキー (UI 側が species ごとに絵を持つ)。 */
/** **色違い変種 (`MonsterDef.tint`) を絵に反映できる種**。web の `monster-svg` は
 *  この一覧を輸入して分岐するので、ここに無い種に `tint` を付けても黙って捨てられ、
 *  同じ tier に見分けのつかない敵が並ぶ (#536 で いわのゴーレム / こけむしゴーレム が
 *  同一の絵になっていた)。tint を使いたい種は先にここへ足す。 */
export const TINTABLE_SPECIES = ['slime', 'bat', 'mushroom', 'golem', 'serpent', 'raven'] as const;
export type TintableSpecies = (typeof TINTABLE_SPECIES)[number];

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

/**
 * エリアの難易度段階 (#536)。**3 段階では雑すぎる**ので 6 段階に広げた。
 *
 * DQ は序盤 4 XP → 中盤 35 → 終盤 12200 と連続的に伸びるのに、3 バケツだと
 * tier1 内 (2〜7 XP) と tier2 内 (34〜52) の間に断絶ができる。tier を増やし、
 * さらに敵ごとの `level` (想定プレイヤーレベル) と組み合わせることで、
 * 「同じエリアの中でも敵ごとに強さが違う」DQ らしい階段になる。
 *
 * **敵が 3 体以上揃った帯までしか遭遇に使わない** (`MAX_POPULATED_TIER`)。現状 tier4 以上は
 * 1〜2 体しかいないので、距離が上限に達しても tier3 止まりになる。敵を足せば自動で伸びる。
 */
export type Tier = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

/** **魔王の城を置く予定のリージョン** (#536)。
 *  左上を (1,1) としたときの (4,4) と (5,4)。
 *
 *  **まだ tier7 として扱っていない。** 地形を実測したところ「山に囲まれた閉領域」では
 *  なく、region#27 は歩行可能 52% / tier1-2 と 109 タイル接し、region#28 は歩行可能 26% で
 *  **街「おおたきの宿」がある** (計測: 4 近傍で歩行可能タイル同士が接する数)。
 *  詳しい経緯と有効化の条件は `tierForRegion` と docs/19 §6.4.7 を参照。 */
export const DEMON_CASTLE_REGIONS: readonly number[] = [27, 28];


export interface MonsterDef {
  id: string;
  name: string;
  species: MonsterSpecies;
  /** 試練の階級。1=手習い 2=修練 3=真剣勝負 */
  tier: Tier;
  /** [atk, def, agi, int, luk] — 合計はおおむね 100 で職と同尺度 */
  stats: StatArray;
  /** HP/MP を明示する (プレイヤーと同じ完全ステータスブロック)。
   *  省略時は従来どおり def/int から導出 (後方互換)。はぐれメタル型のように
   *  「導出だと def なりに HP が出てしまう」敵を低 HP に手調整するのに使う。
   *  値は tier/レベル係数で従来同様にスケールする (基準値のみ明示)。 */
  hp?: number;
  mp?: number;
  /** 出現の重み (default 1)。レア敵 (はぐれメタル等) は 1 未満にして稀にする。 */
  spawnWeight?: number;
  /** 色違い変種の主要な塗り色 (CSS color)。同じ species の SVG の主体色を差し替えて
   *  「あかいスライム」等の強い版/レッサーを安価に作る。
   *  hue-rotate は輝度保存で狙った色にならない事故があるため明示色を持たせる。 */
  tint?: string;
  /** 勝利時に得る XP の**個別上書き**。省略時は `baselineXp(def)` が実効的な強さ (基準 HP +
   *  atk/agi) から算出する (式＋個別調整)。低 HP なのに高 XP の
   *  はぐれメタル型ジャックポットや、式が合わない上位 tier はここで明示する。 */
  xp?: number;
  drops: readonly DropDef[];
  /** ひとこと (召喚時の口上に使う) */
  intro: string;
  /** 強攻撃 (charger の ため攻撃) の技名。charger 以外は省略可。 */
  skillName?: string;
  /** 行動タイプ (戦略性のためのバリエーション)。
   *  未指定 = plain (通常攻撃 + 低 HP でたまに防御)。
   *  'charger' = 1 ターン ため → 強攻撃 (予告を防御する読み合い。全体の ~20%)。
   *  'healer' = 低 HP でたまに自己回復 (削り切る前に倒す読み合い)。
   *  'fleer' = 毎ターン逃走を試みる (はぐれメタル型。倒す前に逃げられると報酬ゼロ)。
   *  'caster' = たまに魔法を撃つ (def 無視の属性魔撃。#456: 対物理型の看板 覇王/不動 の弱点=魔法を
   *    成立させ、後続 (#483) の清き心 (魔法反射) の前提にもなる。要 spell 定義)。 */
  ability?: 'charger' | 'healer' | 'fleer' | 'caster';
  /**
   * 複数の能力 (#592 段階 2)。**優先順は配列の順** — 毎ターン先頭から聞き、最初に
   * 特別な行動 (attack 以外) を返した能力を採る。全員 attack なら通常攻撃。
   * 「HP が減ったら回復、それ以外はためる」= ['healer', 'charger']。
   * 指定があれば `ability` (単数) より優先。単数は後方互換で残す。
   */
  abilities?: readonly ('charger' | 'healer' | 'fleer' | 'caster')[];
  /** healer の回復技名 (省略時デフォルト)。 */
  healName?: string;
  /** healer の回復幅 (maxHp に対する割合 0〜1)。省略時は BATTLE_TUNING.healerHealRatio。
   *  **healAmount があればそちらが勝つ。** 割合は HP の大きい敵ほど強くなる
   *  (HP100 の敵が毎回 30 戻る) ので、原則は固定値を使う。 */
  healRatio?: number;
  /** healer の回復量 (固定値)。**エディタの既定はこちら** — 割合回復は強すぎる (#419)。 */
  healAmount?: number;
  /**
   * 能力の発動パラメータの上書き (#592 段階 1)。省略時は BATTLE_TUNING の全体既定。
   * 「よくためる敵」「なかなか逃げない敵」を、コードを触らずデータで作れる。
   */
  abilityParams?: {
    /** charger: ため確率 (0〜1)。 */
    chargeChance?: number;
    /** healer: 回復確率 (0〜1)。 */
    healChance?: number;
    /** healer: 発動する HP 閾値 (0〜1。これを下回ったら回復を考える)。 */
    lowHpRatio?: number;
    /** caster: 詠唱確率 (0〜1)。 */
    castChance?: number;
    /** fleer: 逃走の基礎確率 (0〜1。agi 補正の前)。 */
    fleeBase?: number;
  };
  /** caster の魔法 (#456)。def 無視・属性つきの int スケール魔撃。ダメージ = min〜max + int*intScale。
   *  魔法致死は onLethal を通らない (物理耐性の覇王/不動 も魔法では死ぬ = 設計どおりの弱点)。
   *  データ規約: min <= max (span 負を避ける)。caster の攻撃ラベルは skillName でなくこの name を使う。 */
  spell?: { name: string; element?: Element; min: number; max: number; intScale?: number };
  /** 防御属性 (#455 / docs/25 §1)。被弾時の属性相性に使う。未指定 = 無属性 (常に等倍)。
   *  キャスターが弱点を突く駆け引きの導線 (賢者/魔法使いの属性撃ち分けが機能する)。 */
  element?: Element;
  /** すべての魔法を無効化 (メタル系。DQ 準拠)。true だと fixedDamage/doMagic が最小 1 になる。
   *  物理は flatDef で 1 に沈むが、魔法は def 無視のため別途この旗で止める。 */
  resistAllMagic?: boolean;
  /** **この敵の想定プレイヤーレベル** (#536)。省略時は `TIER_LEVEL[tier]`。
   *
   *  tier は 3 段階しかないので、そのままだと敵の強さと XP が 3 バケツに丸まる。
   *  DQ3 は序盤 4 XP → 中盤 35 → 終盤 12200 と**連続的に伸びる**のに対し、
   *  3 段階だと tier1 内 (2〜7 XP) と tier2 内 (34〜52) の間に断絶ができる。
   *
   *  敵ごとに想定レベルを持たせることで、**同じ tier の中でも「弱い敵/強い敵」の階段**を
   *  作れる (スライム Lv1 → ヒカリダケ Lv5 のように)。tier は「どのエリアに出るか」の
   *  括りとして残し、強さと XP はこの値で決まる。 */
  level?: number;
  /** **tier 倍率を通さない実効 def** (メタル系専用)。
   *
   *  通常 def は `stats` の比率 × tier 倍率で決まるが、メタル系の「通常攻撃は常に 1・
   *  会心 (def 無視) のみ貫通」という識別子は**どのレベルの相手にも成立**しなければ壊れる。
   *  比率経由だと tier1 倍率で潰れて Lv1 の戦士にすら殴り倒されてしまうため、ここだけ
   *  実効値を直接指定する。最大 atk (Lv50 の将軍 103) × atkCoef を defCoef で割った値
   *  値は **DQ2 のメタルスライム/はぐれメタルと同じ 255** に揃える。DQ の式
   *  `(攻撃力 − 守備力/2)` は攻撃力が守備力の半分を下回ると 0 になり、本作の
   *  `atk*0.9 − def*0.45` も同じ 2:1 なので、255 なら atk 127 以下の全員が 0 になる
   *  (最高の Lv50 将軍でも atk 103) = 会心のみが道。 */
  flatDef?: number;
  /** **ストーリー専用** (D-STORY-009)。ランダム遭遇・「このあたり多い」・tier の判定・
   *  しらべるの地方素材には出さない。ボスなど、戦闘定義 (world.story の battles) からだけ戦う敵。 */
  storyOnly?: boolean;
}

/**
 * 素材カタログ (Step2 の装備素材)。
 *
 * `key: true` は**だいじなもの** (シナリオアイテム、#426/#545)。素材と違い
 * ひきとってもらえず、**負けても失わない** — 失うと進行不能になりうるため。
 */
export const ITEMS: Record<string, { name: string; key?: boolean }> = {
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

export { MONSTERS } from './monster-roster.js';
import { MONSTERS } from './monster-roster.js';

export const MONSTERS_BY_ID: Record<string, MonsterDef> = Object.fromEntries(
  MONSTERS.map((m) => [m.id, m]),
);

/** **顔ぶれが揃っている最大の tier** (#536)。`tierForDanger` はここまでにクランプする。
 *  tier を 8 段階に広げても敵が追いつかないと「毎回同じ敵しか出ない帯」や
 *  「プールが空で `summonMonster` が落ちる帯」ができる。敵を足せば自動的に上が解放される。
 *  3 体を下限にするのは、地域相性 (`favoredMonsterFor`) が意味を持つ最小数だから。 */
export let MAX_POPULATED_TIER: Tier = computeMaxPopulatedTier();

function computeMaxPopulatedTier(): Tier {
  let max: Tier = 1;
  for (const t of [1, 2, 3, 4, 5, 6, 7, 8] as const) {
    if (MONSTERS.filter((m) => m.tier === t && !m.storyOnly).length >= 3) max = t;
    else break;
  }
  return max;
}

/** モンスターをレコードで差し替えたとき (#419) に呼ぶ。ESM の live binding で
 *  import 側にも新しい値が見える。 */
export function recomputeMaxPopulatedTier(): void {
  MAX_POPULATED_TIER = computeMaxPopulatedTier();
}

/** XP 算出式の係数 (式＋個別調整の「式」側)。倒す手間 (基準 HP) と脅威 (atk+agi) から出す。
 *  tier1 帯 (DQ 級スケールで基準 HP 5〜14) でおおむね 2〜9 になるよう校正。 */
const XP_HP_FLOOR = 3; // これ以下の基準 HP は XP に寄与しない (最弱の下限を作る)。DQ 級スケール (敵 HP ひとけた) に合わせ 10→3
const XP_HP_SCALE = 0.6; // 基準 HP 1 あたりの XP。HP が ~1/4 に縮んだぶん係数を ~4倍 (0.15→0.6) して XP 出力を保つ
const XP_OFFENSE_SCALE = 0.04; // (atk+agi) 1 あたりの XP (素早い/強い敵を少し厚く)

/** モンスターの XP 既定値を「実効的な強さ」から算出する (式＋個別調整の式側)。基準 HP は
 *  def.hp があればそれ、無ければ従来の導出 (hpBase + def*hpDefScale)。敵の強さと XP を
 *  構造的に連動させる (スライム=低 HP=低 XP、硬い敵=高 HP=高 XP)。
 *
 *  **校正は tier1 帯のみ** (基準 HP 12〜62 でおおむね 2〜9)。tier2/3 に生で使うと過小になる
 *  (例: sky-dragon 式 ~12 vs 現行 96) ので、**tier2/3 は必ず def.xp を明示する** (回帰テスト
 *  「tier2/3 は xp を明示」で固定)。tier をまたいで式化したくなったら tier 係数が要る。
 *
 *  **基準 HP はレベル 1 相当の名目値**。実 HP は factor でレベルに応じ伸びるが、XP は
 *  レベル非依存に固定する (サーバーが monsterId だけから決定的に再導出できるため — docs/21)。 */
export function baselineXp(def: MonsterDef): number {
  // 全モンスターが hp を明示しているのでフォールバックは実質未使用 (回帰テストで固定)。
  // 万一 hp 省略の敵を足したときも XP が跳ねないよう、monsterMaxHp と同じ既定値を使う
  // (stats[1] = まもり比率 を流用すると、メタル系のような極端な比率で XP が暴発する)。
  const baseHp = def.hp ?? MONSTER_DEFAULT_VIT;
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
export function pickTrialTier(seed: number, playerLevel: number, totalBattles: number): Tier {
  if (totalBattles <= 0) return 1;
  const r = createRng((seed ^ 0x7f4a7c15) >>> 0)();
  if (playerLevel < 5) return r < 0.6 ? 1 : 2;
  if (r < 0.25) return 1;
  if (r < 0.65) return 2;
  return 3;
}

/** tier = エリアの **想定プレイヤーレベル** (#518/#509)。
 *
 *  モンスターの `stats` は職と同じ **合計 100 の比率**なので、プレイヤーと同じ成長式
 *  `statBase + statGrow*(lv-1)` に載せないとスケールが合わない。#518 でプレイヤー側を
 *  「比率 × 伸び率」に変えた結果、Lv1 の atk が 25 → 1〜8 に下がり、旧スケール
 *  (比率 × 0.72〜1.36) のままのモンスターが**桁違いに強い**状態になっていた。これが
 *  「序盤から敵が強すぎる」(#509) の構造的な原因。
 *
 *  tier をレベルで表すことで、プレイヤーの成長レンジ (Lv1→30 で約 8 倍) と同じ幅を
 *  モンスター側も持てる。**プレイヤーのレベルには追従しない = エリア固定難易度**
 *  (「自分の強さに合わせて敵も強くなるのはダメ」) は不変。 */
export const TIER_LEVEL: Record<Tier, number> = { 1: 1, 2: 4, 3: 8, 4: 13, 5: 19, 6: 26, 7: 34, 8: 42 };

/** tier 内の微調整。tier1 は明確に弱め (Lv1 の 5 連戦生存が健全な水準)。
 *
 *  **`MONSTER_POWER` との役割分担**: こちらは **tier ごと**の相対難易度 (「このエリアは
 *  想定レベルより少し優しい/厳しい」)、`MONSTER_POWER` は **全モンスター共通**の出力補正
 *  (職とモンスターの profile 配分の違いを吸収する係数)。特定エリアだけ調整したいときは
 *  こちら、戦闘全体のテンポを変えたいときは `MONSTER_POWER` を触る。 */
const TIER_STRENGTH: Record<Tier, number> = { 1: 0.72, 2: 0.85, 3: 1.0, 4: 1.0, 5: 1.0, 6: 1.0, 7: 1.0, 8: 1.1 };

/** モンスター全体の出力倍率 (#509)。
 *
 *  職の profile は合計 100 を atk/def/agi/int/luk に**配分**するので、戦士でも atk は 25 程度。
 *  一方モンスターは utility (int/luk) に予算を割く必要がないため atk に偏り、あおおには
 *  126 中 66 (52%) が atk = 戦士の 2.6 倍。同じ倍率で並べると**殴り合いが 2 ターンで終わる**
 *  大味な戦闘になり、序盤ほど事故死が増える (= 「敵が強すぎる」の体感)。
 *
 *  profile の形 (敵ごとの個性) は保ったまま、出力だけを職と同水準に均す係数。0.5 で
 *  「想定レベルのプレイヤーが 5〜7 ターンで勝ち、HP を 3〜4 割持っていかれる」水準になる。 */
const MONSTER_POWER = 0.5;

/** モンスターの強化倍率。**プレイヤー/ジョブのレベルには追従しない = 固定強度**
 *  (「自分の強さに合わせて敵も強くなるのはダメ」)。tier は
 *  エリアの固定難易度で、プレイヤーが強くなれば相対的に楽になる。後半の難易度は
 *  レベル追従ではなく「エリアごとに強い敵を配置」で作る。将来エンドコンテンツで追従を
 *  戻すなら、tier 限定でここに足す。 */
/** この敵の想定プレイヤーレベル。個体指定 (`level`) があればそれ、無ければ tier の代表値 (#536)。 */
function monsterLevelOf(def: MonsterDef): number {
  return def.level ?? TIER_LEVEL[def.tier];
}

function monsterLevelFactor(def: MonsterDef): number {
  const t = BATTLE_TUNING;
  return (t.statBase + t.statGrow * (monsterLevelOf(def) - 1)) * TIER_STRENGTH[def.tier] * MONSTER_POWER;
}

/** モンスターの HP。`def.hp` は職の vit と同じ **たいりょく相当の生値** として扱い、
 *  プレイヤーと同じ `hpBase + vit * hpVitScale` に載せる (#518)。旧実装は hp をそのまま
 *  絶対 HP にしていたので tier2 (22〜28) → tier3 (24〜30) とほぼ伸びず、上位ほど瞬殺される
 *  = レベルを上げる意味が薄い状態だった。 */
function monsterMaxHp(def: MonsterDef): number {
  const t = BATTLE_TUNING;
  const g = t.statBase + t.statGrow * (monsterLevelOf(def) - 1);
  // hp 省略時に stats[1] (まもり **比率**) を「たいりょく生値」として流用すると、メタル系の
  // ような極端な比率 (240) で HP が暴発する。現状は全モンスターが hp を明示しており到達
  // しない (「全モンスターが hp を持つ」テストで固定) が、安全側の既定値に倒しておく。
  return Math.max(1, Math.round(t.hpBase + (def.hp ?? MONSTER_DEFAULT_VIT) * g * t.hpVitScale));
}

/** `MonsterDef.hp` 省略時の たいりょく 既定値。tier1 の敵 (5〜14) の下限側に合わせた控えめな値。 */
const MONSTER_DEFAULT_VIT = 8;

/** 地域相性の重み (favor 対象のモンスターをこの倍率で優遇)。3 = そのモンスターが
 *  約 6 割 (残り 2 種が各 2 割) で出る = 地域の顔が立つ水準。 */
const AFFINITY_WEIGHT = 3;

/** ランダム遭遇の候補 (ストーリー専用の敵は除く)。 */
function randomPool(tier: Tier): MonsterDef[] {
  return MONSTERS.filter((m) => m.tier === tier && !m.storyOnly);
}

/** その tier で affinity が最も出やすくするモンスター (地域相性の「○○が多い」導線用)。 */
export function favoredMonsterFor(tier: Tier, affinity: number): MonsterDef {
  const pool = randomPool(tier);
  return pool[((affinity % pool.length) + pool.length) % pool.length]!;
}

/**
 * tier のプールからモンスターを選ぶ。affinity (地域の相性 = regionAffinity) が指定
 * されると `pool[affinity % pool.length]` を AFFINITY_WEIGHT 倍で重み付け抽選する
 * (同じ tier でも地域ごとに顔ぶれが変わる = ドロップ素材も偏る)。
 * index 方式なので favor 対象は必ず実在し、相性が死ぬ地域が無い (レビュー ★★★)。
 */
export function summonMonster(
  tier: Tier,
  playerLevel: number,
  seed: number,
  jobLevel = 1,
  affinity?: number,
  /** HP/MP の分散 (±割合)。0 のとき従来どおり固定 (rng も引かないので試練/既存テスト
   *  の乱数ストリームは不変)。world は BATTLE_TUNING.monsterVitalsVariance を渡す。 */
  variance = 0,
): { def: MonsterDef; combatant: Combatant } {
  let pool = randomPool(tier);
  // **プールが空でも落とさない。** 落とすと edge の handleMove が 500 になり、
  // プレイヤーは**その場から一歩も動けなくなる** (遭遇はサーバー権威で、移動の応答が
  // 戦闘開始を含むため)。データ側の検証 (tier1 の 3 体下限) で普通は起きないが、
  // 「データが壊れていたら移動不能」という壊れ方は許されないので、**近い下の帯に
  // 繰り下げて**遭遇を成立させる。tier1 まで空なら全プールから選ぶ。
  for (let t = tier - 1; pool.length === 0 && t >= 1; t--) {
    pool = randomPool(t as Tier);
  }
  if (pool.length === 0) pool = MONSTERS.filter((m) => !m.storyOnly);
  if (pool.length === 0) {
    // MONSTERS 自体が空 (検証をすり抜けた最悪ケース)。それでも移動は殺さない。
    throw new Error('モンスターが 1 体もいない (world.monsters レコードを確認)');
  }
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
  // 固定強度: プレイヤー/ジョブレベルに追従しない。factor は tier のみ、
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
  const factor = monsterLevelFactor(def);
  // モンスターは tier 係数の乗算 (プレイヤーとは別式)。HP/MP は明示値 (全モンスターが持つ)。
  const ms = monsterStats(def.stats, factor);
  const c = makeCombatant(
    def.name,
    ms,
    Math.round(BATTLE_TUNING.hpBase + ms[1] * BATTLE_TUNING.hpVitScale), // 明示 hp が無い敵のみ (直後に上書き)
    Math.round(BATTLE_TUNING.mpBase + ms[3]),
  );
  // HP/MP を明示している敵はその値で上書き (プレイヤーと同じ完全ステータス — 導出に頼らない)。
  // tier 倍率を通さない (メタル系)。ダメージ 0 が許されるのはこの旗が立つ相手だけ。
  if (def.flatDef !== undefined) { c.def = def.flatDef; c.ironDef = true; }
  c.maxHp = monsterMaxHp(def); c.hp = c.maxHp;
  // MP は 1 体ずつ手で設計された絶対値なのでそのまま使う (tier 倍率を掛けると、tier 差が
  // 既に値自体に入っているぶんと二重計上になる)。HP は monsterMaxHp が別途担当。
  if (def.mp !== undefined) { c.maxMp = Math.max(0, def.mp); c.mp = c.maxMp; }
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
