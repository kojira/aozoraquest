/**
 * 戦闘決着の報酬を権威 state (GameState) に適用する純関数 — docs/21 §5/§7 / M3。
 *
 * **サーバーが報酬を計算する**のが要点。これを readModifyWrite の `mutate` として渡し、CAS で確定する。
 * 純粋 (副作用なし・毎回同じ入力で同じ出力) なのでリトライで複数回呼ばれても安全。
 *
 * **fail-closed / パワーモデル (§7)**:
 *   - `rewarded=false` (encounter 時にパワー残高 0) → 勝敗どちらも**何も付与しない・消費しない**。
 *   - 勝ち (rewarded): +XP (player/job 両方) + ドロップ + パワー 1 消費。
 *   - 負け (rewarded): 素材ロス + パワー 1 消費。
 *   - 引き分け / 逃走: 決着ではない → 何も変えない。
 *
 * **seed 秘匿 (#348)**: ドロップ/敗北ロスの seed は**サーバーが独立に引いた rewardSeed/lossSeed** を使う
 * (戦闘 seed は client に返さない・再利用しない)。呼び出し側が entropyU32 で引いて渡す。
 */
import { battleXpFor, rollDrops, rollDefeatLoss, jobLevelFromXp, levelUpGains, skillsForJob, BATTLE_TUNING, type Archetype, type StatArray , gameQuestById } from '@aozoraquest/core';
import type { GameState } from './game-state';

/** BattleOutcome から 'ongoing' を除いた決着。'monster-fled' = 敵が逃げた (無報酬・無消費)。 */
export type BattleDecision = 'win' | 'lose' | 'draw' | 'fled' | 'monster-fled';

export interface BattleOutcomeInput {
  outcome: BattleDecision;
  /** 倒した/対峙したモンスター id (勝利 XP・ドロップ表の決定に使う)。 */
  monsterId: string;
  /** jobXp のキー (プレイヤーの archetype)。 */
  archetype: string;
  /** ドロップ/敗北ロスの luk ボーナス。 */
  luk: number;
  /** 巫女の直感 (#456) 等のドロップ確率加算ボーナス。未指定は 0。 */
  dropBonus?: number;
  /** マルチ戦闘 (#453 群れ) の全敵の monsterId。指定時は勝利報酬を頭数分 (XP 合算・各敵でドロップ試行)。
   *  未指定/1体は従来どおり monsterId 単体で計算 (完全互換)。 */
  enemyIds?: string[];
  /** サーバーが独立に引いたドロップ用エントロピー (32bit)。 */
  rewardSeed: number;
  /** サーバーが独立に引いた敗北ロス用エントロピー (32bit)。 */
  lossSeed: number;
  /** encounter 時に power>=1 で確定した「報酬対象」フラグ。 */
  rewarded: boolean;
  /** レベルアップの内訳を出すための素ステ。無ければ内訳を省く。 */
  baseStats?: StatArray;
}

/** 適用結果 (client 表示・監査用の内訳)。 */
export interface AwardBreakdown {
  /** **パワー不足で報酬対象外だった** (勝っても逃げても XP・素材が一切入らない)。
   *  これを返さないと「勝ったのに何も起きない」が無言で起き、経験値が入ったように
   *  見えて実は入っていない、という最悪の見え方になる。 */
  unrewarded?: true;
  xp?: number;
  /** この決着でジョブ Lv が上がったか (#534)。上がったら HP/MP が全回復する。 */
  leveledUp?: {
    from: number;
    to: number;
    /** 上がったステータスの内訳 (「ちから +2」を 1 行ずつ出すため)。 */
    gains?: Array<{ key: string; label: string; delta: number }>;
    /** このレベルアップで**新しく覚えた**とくぎの名前。 */
    learned?: string[];
  };
  drops?: string[];
  materialsLost?: string[];
  powerSpent?: number;
}

const POWER_COST = BATTLE_TUNING.powerCost;

function addItems(materials: Record<string, number>, items: string[], delta: 1 | -1): Record<string, number> {
  const next = { ...materials };
  for (const item of items) {
    const v = (next[item] ?? 0) + delta;
    if (v <= 0) delete next[item];
    else next[item] = v;
  }
  return next;
}

/**
 * XP 加算の前後でジョブ Lv が上がったか (#534)。上がっていなければ undefined。
 *
 * **上がった内訳と覚えたとくぎも返す**。「レベルが上がった」だけだと
 * 何が良くなったのか分からず、覚えたとくぎにも気づけない。`baseStats` が無いときは
 * 内訳を省く (職の基準値だけで出すと実際の伸びとずれるため)。
 */
function levelUpOf(
  before: GameState,
  after: GameState,
  archetype: string,
  baseStats?: StatArray,
): NonNullable<AwardBreakdown['leveledUp']> | undefined {
  const from = jobLevelFromXp(before.jobXp[archetype] ?? 0, archetype);
  const to = jobLevelFromXp(after.jobXp[archetype] ?? 0, archetype);
  if (to <= from) return undefined;
  const arch = archetype as Archetype;
  // **baseStats が無ければ内訳を省く** — 職の基準値だけで出すと、その人の実際の伸びと
  // 違う数値を見せることになる (実測: あり MP+1.1/こうげき+1.1 → なし MP+0.7/こうげき+1.3)。
  // `SealedMeta.baseStats` は optional なので、デプロイを跨いだ進行中のガードで実際に
  // この経路に入る。以前は条件が書かれておらず素通ししていた (レビュー ★★ 2026-07-27)。
  const gains = baseStats
    ? levelUpGains(arch, { jobLevel: from, playerLevel: 1 }, { jobLevel: to, playerLevel: 1 }, baseStats)
        .map((g) => ({ key: String(g.key), label: g.label, delta: g.delta }))
    : [];
  // 覚えたとくぎ = 新 Lv の一覧から旧 Lv の一覧を引いたもの。
  const had = new Set(skillsForJob(arch, from).map((s) => s.name));
  const learned = skillsForJob(arch, to).map((s) => s.name).filter((n) => !had.has(n));
  return { from, to, ...(gains.length ? { gains } : {}), ...(learned.length ? { learned } : {}) };
}

/**
 * 決着の報酬を state に適用し、新 state と内訳を返す。純粋。
 * `applyBattleOutcome(current, input).next` を readModifyWrite の mutate 結果に使う。
 */
export function applyBattleOutcome(state: GameState, o: BattleOutcomeInput): { next: GameState; awarded: AwardBreakdown } {
  // パワー無し = 練習相当。勝敗どちらも付与も消費もペナルティも無し (§7)。
  // **決着したのに報酬が無かったこと自体を返す** — client がその理由を出せるように。
  if (!o.rewarded) {
    // **勝ち負けのときだけ理由を出す。** 逃走・引き分けはパワーがあっても XP もドロップも
    // 出ない (下記参照) ので、ここで理由を出すと「パワーがあれば得られたはず」という
    // 嘘になる。しかも逃げるたびにタップ送りを要求することになる。
    const lost = o.outcome === 'win' || o.outcome === 'lose';
    return { next: state, awarded: lost ? { unrewarded: true } : {} };
  }

  if (o.outcome === 'win') {
    // 群れ (#453) は倒した全敵ぶん。XP 合算・各敵で別 seed のドロップ試行。1体 (従来) は monsterId 単体 =
    // rewardSeed をそのまま使い完全互換。
    const ids = o.enemyIds && o.enemyIds.length > 0 ? o.enemyIds : [o.monsterId];
    let xp = 0;
    const drops: string[] = [];
    ids.forEach((id, i) => {
      xp += battleXpFor(id);
      const seed = i === 0 ? o.rewardSeed : (o.rewardSeed ^ (0x9e3779b1 * (i + 1))) >>> 0;
      drops.push(...rollDrops(id, o.luk, seed, o.dropBonus ?? 0));
    });
    // ゲーム内クエスト (#423) の討伐カウント。**討伐数はここ (勝利の権威経路) だけが増やす** —
    // client の自己申告を数えると「戦わずに達成」できてしまう。パワー無し戦闘は上の
    // unrewarded で早期 return しているので、練習戦では進まない (報酬系と同じ線引き)。
    const questDef = state.quest ? gameQuestById(state.quest.id) : undefined;
    const questKills =
      questDef?.objective.kind === 'defeat'
        ? ids.filter((id) => id === (questDef.objective as { monsterId: string }).monsterId).length
        : 0;
    const next: GameState = {
      ...state,
      // #507/#508: プレイヤー XP は**加算しない**。プレイヤーレベルは戦闘力に一切影響しない
      // ことにしたので (docs/19)、増え続ける数字だけが残ると「上げると強くなる」と誤解させる。
      // 既存の値は互換のため保持する (state からフィールドを消すと古い client が壊れる)。
      jobXp: { ...state.jobXp, [o.archetype]: (state.jobXp[o.archetype] ?? 0) + xp },
      materials: addItems(state.materials, drops, 1),
      power: Math.max(0, state.power - POWER_COST),
      ...(questKills > 0 && state.quest
        ? { quest: { id: state.quest.id, progress: state.quest.progress + questKills } }
        : {}),
    };
    const lv = levelUpOf(state, next, o.archetype, o.baseStats);
    return { next, awarded: { xp, drops, powerSpent: POWER_COST, ...(lv ? { leveledUp: lv } : {}) } };
  }

  if (o.outcome === 'lose') {
    // 負けでも僅かな XP (§5「負: xpLose+素材ロス」/ 旧クライアントと同値) + 素材ロス + パワー消費。
    const xp = BATTLE_TUNING.xpLose;
    const materialsLost = rollDefeatLoss(state.materials, o.luk, o.lossSeed);
    const next: GameState = {
      ...state,
      jobXp: { ...state.jobXp, [o.archetype]: (state.jobXp[o.archetype] ?? 0) + xp }, // playerXp は増やさない (#507/#508)
      materials: addItems(state.materials, materialsLost, -1),
      power: Math.max(0, state.power - POWER_COST),
    };
    // 負けでも僅かに XP が入るので、そこで上がることもある (演出は勝ち負けの後に出る)。
    const lv = levelUpOf(state, next, o.archetype, o.baseStats);
    return { next, awarded: { xp, materialsLost, powerSpent: POWER_COST, ...(lv ? { leveledUp: lv } : {}) } };
  }

  // draw / fled / monster-fled は決着扱いにしない (XP もドロップもパワー消費も無し)。
  // - draw: パワー消費のない draw を報酬対象にすると「ガードで引き分けを狙う無限 XP 稼ぎ」が成立するため付与しない。
  // - fled (プレイヤーが逃走) / monster-fled (敵が逃走): どちらも決着していないので無報酬・無消費。
  //   特にはぐれメタル型に逃げられたときはここに落ちる (高 XP をみすみす逃した = 悔しさが残る設計)。
  return { next: state, awarded: {} };
}
