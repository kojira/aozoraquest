/**
 * **ギルドに来る冒険者は「一期一会のガチャ」** (D-PARTY-002)。
 *
 * - 1 つのギルドに、1 日 (JST) ごとに 3 人。seed は edge が `HMAC(秘密, did|guild|日付|引き直した回数)` で作り、
 *   ここは seed から決定的に 3 人を作るだけ (何度作りなおしても同じ。候補は state に保存しない)
 * - 職は 3 人でかぶらない。前衛・術者・回復役のうち少なくとも 2 種類が入る
 * - ★1/★2/★3 は 70% / 25% / 5%。Lv の上乗せは +0/+1/+2、minLevel の上乗せは +0/+1/+3
 * - 名前つきの冒険者 (recruits) は「なじみ」として、20% で 1 枠に入る (★2・minLevel は定義の値)
 * - 仲間は自分の経験値を持つ (§11)。入れたときの Lv = 候補の Lv。Lv は jobLevelFromXp(xp, 職)
 */
import { ARCHETYPES, isArchetype, type Archetype } from './types.js';
import { createRng } from './battle-rng.js';
import { jobLevelFromXp, jobXpCurveFor } from './quest.js';
import { MAX_RECRUIT_LEVEL, MAX_RECRUIT_LINE, MAX_RECRUIT_NAME, type RecruitDef } from './recruits.js';
import { RECRUIT_LINES, RECRUIT_NAMES } from './recruit-pools.js';
import type { GearSelection } from './equipment.js';

export type RecruitStar = 1 | 2 | 3;

export const RECRUIT_GACHA = {
  /** false にすると、名前つきの冒険者をそのまま紹介する (D-PARTY-001 のやり方) に戻る。 */
  enabled: true,
  perGuild: 3,
  /** ★1 / ★2 の累積の境目 (残りが ★3)。 */
  starCut: [0.7, 0.95] as const,
  /** ★ ごとの Lv の上乗せ ([★1, ★2, ★3])。 */
  starLevel: [0, 1, 2] as const,
  /** ★ ごとの minLevel の上乗せ。 */
  starMinLevel: [0, 1, 3] as const,
  /** なじみ (名前つきの冒険者) が 1 枠に入る確率。 */
  namedChance: 0.2,
  /** 候補を引き直す 1 回のパワー (§10)。回数の上限はない。 */
  rerollPower: 5,
  /** 主人公のジョブ Lv が minLevel に足りない候補を迎える、足りない 1 Lv あたりのパワー (§14)。差の上限はない。 */
  overLevelPowerPerLv: 5,
  /** その日に入れた候補の id を覚えておく上限。 */
  metMax: 30,
} as const;

/** minLevel が主人公のジョブ Lv より上の候補を迎えるパワー (§14)。足りていれば 0 (無料)。 */
export function overLevelPower(minLevel: number, jobLevel: number): number {
  return Math.max(0, minLevel - jobLevel) * RECRUIT_GACHA.overLevelPowerPerLv;
}

/** tier ごとの街の適正 Lv。t1=2、t2=5、t3=8、そこから 1 tier ごとに +3。 */
export function recruitTierLevel(tier: number): number {
  return 2 + 3 * (Math.max(1, Math.floor(tier)) - 1);
}

type RecruitRole = 'front' | 'caster' | 'healer';
/** 職の役割 (ギルドの 3 人に 2 種類以上を入れるため)。回復役は味方を癒やすとくぎを持つ職。 */
export const RECRUIT_ROLE: Readonly<Record<Archetype, RecruitRole>> = {
  shogun: 'front', warrior: 'front', guardian: 'front', captain: 'front', ninja: 'front', performer: 'front', explorer: 'front',
  mage: 'caster', seer: 'caster', bard: 'caster', poet: 'caster', fighter: 'caster', artist: 'caster',
  sage: 'healer', paladin: 'healer', miko: 'healer',
};

/** ギルドの候補 1 人 (edge が作り、GET /api/party/candidates で返す)。 */
export interface RecruitCandidate {
  id: string;
  name: string;
  archetype: Archetype;
  star: RecruitStar;
  /** 仲間に入れたときの Lv (候補として見せる Lv)。 */
  level: number;
  /** 仲間にできる主人公のジョブ Lv の下限。 */
  minLevel: number;
  line: string;
  /** 名前つきの冒険者 (なじみ) なら true。 */
  named?: true;
}

/** state に保存する、生成された仲間の定義と経験値 (party.members)。 */
export interface PartyRecruit {
  id: string;
  name: string;
  archetype: Archetype;
  star: RecruitStar;
  minLevel: number;
  line: string;
  xp: number;
}

export interface DailyRecruitsInput {
  seed: number;
  /** JST の日付 (xp-claim の dayKey)。 */
  day: string;
  guild: string;
  /** その日・そのギルドで引き直した回数 (0 から)。 */
  roll: number;
  tier: number;
  /** このギルドで、いま紹介できるなじみ (recruitsAt: フラグがそろった人)。 */
  named: readonly RecruitDef[];
  /** なじみとして出さない id (はずした parted・いまパーティにいる人)。引いたなじみがここにいれば、
   *  その枠は同じ職の生成の人になる (ほかの枠は変わらない = 読みなおしても顔ぶれがずれない)。 */
  skip: readonly string[];
}

/** 生成された候補の id。日付・ギルド・引き直しの回数・枠から決まる。 */
export function generatedRecruitId(day: string, guild: string, roll: number, slot: number): string {
  return `g:${day}:${guild}:${roll}:${slot}`;
}

export function isGeneratedRecruitId(id: string): boolean {
  return id.startsWith('g:');
}

/** その Lv になったばかりの経験値 (職ごとの曲線)。 */
export function xpForAllyLevel(archetype: Archetype, level: number): number {
  const curve = jobXpCurveFor(archetype);
  const lv = Math.max(1, Math.min(level, curve[curve.length - 1]![0]));
  return curve.find(([l]) => l === lv)?.[1] ?? 0;
}

/** 仲間の Lv (自分の経験値と職の曲線)。 */
export function allyLevel(archetype: Archetype, xp: number): number {
  return jobLevelFromXp(xp, archetype);
}

/** 戦闘の経験値を、戦闘に出た人数 (主人公を含む・倒れた仲間も数える) で等分する。端数は切り捨て。 */
export function splitBattleXp(total: number, heads: number): number {
  return Math.floor(Math.max(0, total) / Math.max(1, heads));
}

const pickStar = (r: number): RecruitStar => (r < RECRUIT_GACHA.starCut[0] ? 1 : r < RECRUIT_GACHA.starCut[1] ? 2 : 3);
const pickOne = <T>(list: readonly T[], rng: () => number): T => list[Math.floor(rng() * list.length)]!;
const clampLevel = (n: number) => Math.max(1, Math.min(MAX_RECRUIT_LEVEL, n));

/** そのギルドのその日の候補 3 人 (seed から決定的)。 */
export function dailyRecruits(input: DailyRecruitsInput): RecruitCandidate[] {
  const rng = createRng(input.seed);
  const base = recruitTierLevel(input.tier);
  const drawn = rng() < RECRUIT_GACHA.namedChance && input.named.length ? pickOne(input.named, rng) : undefined;
  const named = drawn && !input.skip.includes(drawn.id) ? drawn : undefined;
  // 職: かぶらず、役割が 2 種類以上。決まるまで引く (16 職なので数回で終わる)。
  const fixed: Archetype[] = drawn ? [drawn.archetype] : [];
  let jobs: Archetype[] = [];
  for (let tries = 0; tries < 64; tries++) {
    const pool = ARCHETYPES.filter((a) => !fixed.includes(a));
    const picked = [...fixed];
    while (picked.length < RECRUIT_GACHA.perGuild) {
      const a = pickOne(pool.filter((p) => !picked.includes(p)), rng);
      picked.push(a);
    }
    jobs = picked;
    if (new Set(picked.map((a) => RECRUIT_ROLE[a])).size >= 2) break;
  }
  const usedNames = new Set<string>(drawn ? [drawn.name] : []);
  return jobs.map((archetype, slot): RecruitCandidate => {
    // どの枠も同じ回数だけ乱数を引く (なじみが出ても出なくても、ほかの枠の顔ぶれが変わらないように)。
    const jitter = Math.floor(rng() * 3);
    const star = pickStar(rng());
    let name = pickOne(RECRUIT_NAMES, rng);
    while (usedNames.has(name)) name = pickOne(RECRUIT_NAMES, rng);
    usedNames.add(name);
    const line = pickOne(RECRUIT_LINES[archetype], rng);
    if (named && slot === 0) {
      return { id: named.id, name: named.name, archetype, star: 2, level: clampLevel(base + jitter + RECRUIT_GACHA.starLevel[1]), minLevel: named.minLevel ?? 1, line: named.line, named: true };
    }
    return {
      id: generatedRecruitId(input.day, input.guild, input.roll, slot), name, archetype, star,
      level: clampLevel(base + jitter + RECRUIT_GACHA.starLevel[star - 1]!),
      minLevel: clampLevel(base + jitter + RECRUIT_GACHA.starMinLevel[star - 1]!),
      line,
    };
  });
}

/** 候補を仲間にしたときの保存形 (経験値は候補の Lv になったばかりの値)。 */
export function partyRecruitOf(c: RecruitCandidate): PartyRecruit {
  return { id: c.id, name: c.name, archetype: c.archetype, star: c.star, minLevel: c.minLevel, line: c.line, xp: xpForAllyLevel(c.archetype, c.level) };
}

const oneLine = (v: unknown, max: number): boolean => typeof v === 'string' && v.trim() !== '' && v.length <= max && !/[\r\n{}]/.test(v);

/** state から読んだ party.members の 1 人が壊れていないか (壊れていれば null 以外)。 */
export function partyRecruitIssue(m: PartyRecruit): string | null {
  if (!m || typeof m.id !== 'string' || !isGeneratedRecruitId(m.id)) return '仲間の id が不正';
  if (!oneLine(m.name, MAX_RECRUIT_NAME)) return `${m.id}: 名前が不正`;
  if (!isArchetype(m.archetype)) return `${m.id}: 職が不正`;
  if (m.star !== 1 && m.star !== 2 && m.star !== 3) return `${m.id}: ★が不正`;
  if (!(Number.isInteger(m.minLevel) && m.minLevel >= 1 && m.minLevel <= MAX_RECRUIT_LEVEL)) return `${m.id}: minLevel が不正`;
  if (!oneLine(m.line, MAX_RECRUIT_LINE)) return `${m.id}: ひとことが不正`;
  if (!(Number.isInteger(m.xp) && m.xp >= 0)) return `${m.id}: 経験値が不正`;
  return null;
}

/** 保存されているパーティ (edge の PartyState の一部)。 */
export interface PartyRoster {
  ids: readonly string[];
  members?: readonly PartyRecruit[];
  /** なじみ (名前つき) の経験値。 */
  xp?: Readonly<Record<string, number>>;
  /** 仲間の装備 (D-PARTY-004)。 */
  gear?: Readonly<Record<string, GearSelection>>;
  /** なまえのふだ で付けた名前 (D-CASINO-001)。無ければ元の名前。 */
  names?: Readonly<Record<string, string>>;
}

/** 戦闘と表示に使う仲間 1 人 (partyMembers に渡す)。 */
export interface PartyAlly {
  id: string;
  name: string;
  archetype: Archetype;
  level: number;
  xp: number;
  star?: RecruitStar;
  /** 着ている装備 (D-PARTY-004)。戦闘とフィールドの組み立て (partyMemberCombatant) がそのまま使う。 */
  gear?: GearSelection;
}

/**
 * パーティの仲間を、入れている順に (定義が見つからない id は落とす)。
 * 生成の仲間は party.members、なじみは recruitById。なじみの経験値は party.xp[id]、
 * 無ければ (§11 より前に入れた人) `fallbackLevel` (主人公のジョブ Lv) になったばかりの値。
 */
export function partyDefsOf(party: PartyRoster | undefined, recruitById: (id: string) => RecruitDef | undefined, fallbackLevel: number): PartyAlly[] {
  const out: PartyAlly[] = [];
  for (const id of party?.ids ?? []) {
    const m = party?.members?.find((x) => x.id === id);
    const gear = party?.gear?.[id];
    const renamed = party?.names?.[id];
    if (m) { out.push({ id, name: renamed ?? m.name, archetype: m.archetype, xp: m.xp, level: allyLevel(m.archetype, m.xp), star: m.star, ...(gear ? { gear } : {}) }); continue; }
    const r = recruitById(id);
    if (!r) continue;
    const xp = party?.xp?.[id] ?? xpForAllyLevel(r.archetype, fallbackLevel);
    out.push({ id, name: renamed ?? r.name, archetype: r.archetype, xp, level: allyLevel(r.archetype, xp), star: 2, ...(gear ? { gear } : {}) });
  }
  return out;
}

/** なまえのふだ で付けられる名前の長さ (D-CASINO-001 r2)。 */
export const ALLY_NAME_MAX = 10;

/**
 * 仲間の新しい名前の問題 (無ければ null)。前後の空白は落としてから見る。
 * 1〜10 字 (コードポイント)・制御文字と改行は不可・人物の差し込み `{c:` は不可・今の名前と同じは不可。
 */
export function allyNameIssue(raw: unknown, current: string): string | null {
  if (typeof raw !== 'string') return 'なまえが ない';
  const name = raw.trim();
  const len = [...name].length;
  if (len < 1 || len > ALLY_NAME_MAX) return `なまえは 1〜${ALLY_NAME_MAX} 文字`;
  if (/\p{Cc}/u.test(name)) return 'つかえない 文字が ある';
  if (name.includes('{c:')) return 'つかえない 文字が ある';
  if (name === current) return 'いまと おなじ なまえ';
  return null;
}

