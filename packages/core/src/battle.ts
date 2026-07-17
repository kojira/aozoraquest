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
  /** MP: 特技のコスト。たたかう +1 / ぼうぎょ +2 で回復する (連発できないから
   *  「たたかう」に意味が生まれる)。最大 MP = mpBase + int * mpIntScale (int 職は手数が多い)。 */
  skillMpCost: 4,
  mpBase: 6,
  mpIntScale: 0.35,
  mpAttackGain: 1,
  mpGuardGain: 2,
  /** ぼうぎょの翌ターン回避ボーナス (身構えて相手の動きを読む)。 */
  guardFocusDodge: 0.15,
  /** やくそう: 使うと maxHp のこの割合を回復 (1 ターン消費)。持ち込み上限 herbCarryMax。 */
  herbHealRatio: 0.4,
  herbCarryMax: 3,
  /** 最大ターン数 (超えたら判定 = 残 HP 割合勝負) */
  maxTurns: 30,
  /** ドロップ率の luk ボーナス = luk * dropLukScale (加算) */
  dropLukScale: 0.003,
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
 *  同値タイは先勝ち (statOrder 順)。現状タイは artist の def=luk=26 のみで、
 *  parry になる (テストで固定)。 */
export function skillForJob(archetype: Archetype): JobSkill {
  const stats = JOBS_BY_ID[archetype].stats;
  let maxI = 0;
  for (let i = 1; i < stats.length; i++) {
    if (stats[i]! > stats[maxI]!) maxI = i;
  }
  return { kind: STAT_TO_SKILL[maxI]!, name: JOB_SKILL_NAMES[archetype] };
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
  /** MP (プレイヤー用)。特技で消費、たたかう/ぼうぎょで回復。モンスターは 0 固定
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

/** プレイヤーの戦闘値をジョブ + レベルから導出。 */
export function playerCombatant(
  archetype: Archetype,
  jobLevel: number,
  playerLevel: number,
  displayName: string,
): Combatant {
  const t = BATTLE_TUNING;
  const job = JOBS_BY_ID[archetype];
  const factor = 1 + Math.max(0, jobLevel - 1) * t.jobLevelScale + Math.max(0, playerLevel - 1) * t.playerLevelScale;
  return fromStats(displayName, job.stats, factor, playerLevel);
}

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
  { id: 'cave-bat', name: 'ほらあなコウモリ', species: 'bat', tier: 1, stats: [12, 8, 26, 6, 12], drops: [{ item: 'bat-wing', chance: 0.6 }, { item: 'herb', chance: 0.3 }], intro: 'ばさばさと羽音を立てている。' },
  { id: 'glow-shroom', name: 'ヒカリダケ', species: 'mushroom', tier: 1, stats: [8, 20, 4, 18, 12], drops: [{ item: 'mush-spore', chance: 0.6 }, { item: 'herb', chance: 0.4 }], intro: 'ほんのり光って動かない…?' },
  // tier2: 修練
  { id: 'moss-golem', name: 'こけむしゴーレム', species: 'golem', tier: 2, stats: [26, 36, 6, 10, 8], drops: [{ item: 'golem-core', chance: 0.5 }, { item: 'herb', chance: 0.2 }], intro: '地響きを立てて起き上がった。', skillName: 'いわなだれ' },
  { id: 'will-o-wisp', name: 'あおい鬼火', species: 'wisp', tier: 2, stats: [10, 12, 24, 34, 12], drops: [{ item: 'wisp-ember', chance: 0.5 }, { item: 'herb', chance: 0.2 }], intro: 'ゆらゆらとこちらを見ている。', skillName: 'おにびのうず' },
  { id: 'river-serpent', name: 'かわながれ大蛇', species: 'serpent', tier: 2, stats: [30, 18, 22, 10, 10], drops: [{ item: 'serpent-scale', chance: 0.5 }, { item: 'herb', chance: 0.2 }], intro: '水面から鎌首をもたげた。', skillName: 'まきつき' },
  // tier3: 真剣勝負
  { id: 'night-raven', name: 'よるのおおガラス', species: 'raven', tier: 3, stats: [26, 14, 34, 16, 14], drops: [{ item: 'raven-feather', chance: 0.45 }], intro: '月を背に静かに舞い降りた。', skillName: 'かまいたち' },
  { id: 'blue-oni', name: 'あおおに', species: 'oni', tier: 3, stats: [40, 28, 12, 8, 12], drops: [{ item: 'oni-horn', chance: 0.45 }], intro: '金棒を担いで笑っている。', skillName: 'かなぼうふりまわし' },
  { id: 'sky-dragon', name: 'そらのりゅう', species: 'dragon', tier: 3, stats: [32, 24, 18, 26, 10], drops: [{ item: 'dragon-fang', chance: 0.4 }], intro: '雲を裂いて姿を現した!', skillName: 'ほのおのブレス' },
];

export const MONSTERS_BY_ID: Record<string, MonsterDef> = Object.fromEntries(
  MONSTERS.map((m) => [m.id, m]),
);

/** tier に応じたモンスター強化倍率。プレイヤーのレベル補正と釣り合いを取る。 */
function monsterLevelFactor(tier: 1 | 2 | 3, playerLevel: number): number {
  const t = BATTLE_TUNING;
  // プレイヤーと同じ土俵 + tier による上乗せ (tier1 は少し弱め)
  const base = 1 + Math.max(0, playerLevel - 1) * t.playerLevelScale;
  const tierBoost = tier === 1 ? 0.85 : tier === 2 ? 1.05 : 1.3;
  return base * tierBoost;
}

/** 試練モンスターを 1 体選んで戦闘値化する。seed から決定的。 */
export function summonMonster(tier: 1 | 2 | 3, playerLevel: number, seed: number): { def: MonsterDef; combatant: Combatant } {
  const pool = MONSTERS.filter((m) => m.tier === tier);
  const rng = createRng((seed ^ 0x51ed270b) >>> 0);
  const def = pool[Math.floor(rng() * pool.length)]!;
  const factor = monsterLevelFactor(tier, playerLevel);
  const combatant = fromStats(def.name, def.stats, factor, Math.max(1, Math.round(playerLevel * (tier === 3 ? 1.1 : 1))));
  return { def, combatant };
}

// ─── バトル状態と解決 ───────────────────────────────────────

export type Command = 'attack' | 'guard' | 'skill' | 'herb';

export type BattleOutcome = 'ongoing' | 'win' | 'lose' | 'draw';

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
): BattleState {
  const player = playerCombatant(archetype, jobLevel, playerLevel, displayName);
  const { def, combatant } = summonMonster(tier, playerLevel, seed);
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
    lastEvents: [],
  };
}

interface AttackOptions {
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

  const atkValue = opts.useInt ? attacker.int : attacker.atk;
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
  events.push({
    actor,
    text: `${label}${crit ? ' 会心の一撃!!' : ''} ${defender.name}に ${final} のダメージ${fatal ? '。' + defender.name + 'をたおした!' : ''}`,
    damage: final,
    ...(fatal ? { fatal: true } : {}),
  });

  // 見切り反撃 (倒れていなければ)
  if (!fatal && defender.parrying) {
    defender.parrying = false;
    const counterActor = actor === 'player' ? 'monster' : 'player';
    doAttack(defender, attacker, rng, events, counterActor, { power: 1.2, label: 'はんげき' });
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
      doAttack(player, monster, rng, events, 'player', { power: 0.65, label: playerSkill.name });
      if (state.monster.hp > 0) {
        doAttack(player, monster, rng, events, 'player', { power: 0.65, label: playerSkill.name });
      }
      break;
    case 'spell':
      // 防御を半分だけ貫通 + 必中。完全無視 (旧仕様) は int 職が tier3 を蹂躙して
      // 難易度設計が壊れたため 0.5 に緩和 (バランステストで固定)。
      doAttack(player, monster, rng, events, 'player', { power: 1.0, useInt: true, defFactor: 0.5, label: playerSkill.name });
      break;
    case 'gamble': {
      // 0〜2.6 倍。luk が高いほど下振れしにくい。
      const floor = Math.min(0.6, player.luk * 0.012);
      const mult = floor + rng() * (2.6 - floor);
      doAttack(player, monster, rng, events, 'player', { power: mult, label: playerSkill.name });
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
  }
  if (cmd === 'skill') {
    state.player.mp -= t.skillMpCost;
  }

  // 防御系 (ぼうぎょ / 見切り) は行動順に関係なく先に立てる
  // (先手を取られても防御・反撃が意味を持つように。見切り持ちは鈍足ジョブが多い)。
  if (cmd === 'guard') {
    state.player.guarding = true;
    // 翌ターンまで相手の動きを読める (回避ボーナス)。このターン(1) + 次ターン(1) = 2。
    state.player.focus = 2;
    state.player.mp = Math.min(state.player.maxMp, state.player.mp + t.mpGuardGain);
    events.push({ actor: 'player', text: `${state.player.name}はぼうぎょして息を整えた。(MP +${t.mpGuardGain})` });
  }
  if (cmd === 'skill' && state.playerSkill.kind === 'parry') {
    state.player.parrying = true;
    events.push({ actor: 'player', text: `${state.player.name}は${state.playerSkill.name}の構え! (防御しつつ反撃)` });
  }
  if (mCommand === 'guard') {
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
        state.player.mp = Math.min(state.player.maxMp, state.player.mp + t.mpAttackGain);
      } else if (cmd === 'skill') {
        playerSkillAction(state, rng, events);
      } else if (cmd === 'herb') {
        const heal = Math.round(state.player.maxHp * t.herbHealRatio);
        state.player.hp = Math.min(state.player.maxHp, state.player.hp + heal);
        state.herbs -= 1;
        state.herbsUsed += 1;
        events.push({ actor: 'player', text: `${state.player.name}はやくそうを使った! HP が ${heal} 回復。(残り ${state.herbs})` });
      }
      // guard は宣言済み
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
