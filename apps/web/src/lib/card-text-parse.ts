/** LLM 出力 (能力 / フレーバー) のパーサ。 flavor-text.ts から分割。 */
import type { CardType, ManaCost } from '@aozoraquest/core';
import { manaCostTotal, sanitizeManaCost } from '@aozoraquest/core';
import { COLOR_FROM_NAME, CARD_TYPE_FROM_JA } from './card-text-themes';

export function stripMarkdown(s: string): string {
  let t = s;
  t = t.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/__([^_]+)__/g, '$1');
  t = t.replace(/(?<![\*])\*([^\*\n]+)\*(?![\*])/g, '$1');
  t = t.replace(/(?<![_])_([^_\n]+)_(?![_])/g, '$1');
  return t;
}

export function stripWrappers(s: string): string {
  return s
    .replace(/^[「『《【〈"'“”]+/, '')
    .replace(/[」』》】〉"'“”]+$/, '')
    .trim();
}

type HeaderKey = 'type' | 'manaCost' | 'cardName' | 'name' | 'abilityCost' | 'description' | 'keywords' | 'power' | 'toughness' | 'flavor';
const HEADERS: Record<HeaderKey, RegExp> = {
  type: /^(?:タイプ|種別|カードタイプ|type)[:\s：・　]*(.*)$/i,
  manaCost: /^(?:マナコスト|召喚コスト|cost|mana[\s-]?cost)[:\s：・　]*(.*)$/i,
  cardName: /^(?:カード名|タイトル|card[\s-]?name|title)[:\s：・　]*(.*)$/i,
  // 「キーワード」は能力名と混同しないよう、能力名側の正規表現から除いた。
  name: /^(?:能力名|能力|スキル名|アビリティ名|アビリティ|名前)[:\s：・　]*(.*)$/,
  abilityCost: /^(?:起動コスト|アビリティコスト|発動コスト|代償|消費)[:\s：・　]*(.*)$/,
  description: /^(?:説明|効果|能力説明|動作|挙動)[:\s：・　]*(.*)$/,
  keywords: /^(?:キーワード|キーワード能力|常在能力|keywords?)[:\s：・　]*(.*)$/i,
  power: /^(?:パワー|攻撃力|power|atk)[:\s：・　]*(.*)$/i,
  toughness: /^(?:タフネス|防御力|耐久|toughness|def)[:\s：・　]*(.*)$/i,
  flavor: /^(?:フレーバー|flavor|情景|詩|口上)[:\s：・　]*(.*)$/i,
};

const ALLOWED_KEYWORDS = [
  '飛行', '警戒', '先制攻撃', '速攻', 'トランプル', '接死', '絆魂',
  '二段攻撃', '威迫', '到達', '呪禁', '護法', '防衛',
];

export function parseKeywordsString(raw: string): string[] {
  const trimmed = raw.trim();
  if (!trimmed || /^(なし|無し|none|0|-|—|―)$/i.test(trimmed)) return [];
  const tokens = trimmed.split(/[,、，\s/／]+/).map((s) => s.trim()).filter(Boolean);
  const out: string[] = [];
  for (const tok of tokens) {
    if (ALLOWED_KEYWORDS.includes(tok) && !out.includes(tok)) out.push(tok);
    if (out.length >= 3) break;
  }
  return out;
}

export function parseStatNumber(raw: string): number | undefined {
  const trimmed = raw.trim();
  if (!trimmed || /^(なし|無し|none|-|—|―)$/i.test(trimmed)) return undefined;
  const m = trimmed.match(/(\d+)/);
  if (!m) return undefined;
  const n = Number(m[1]);
  // プロンプトは P/T を 1-7 で指示しているので、それ以外は parse 失敗扱いにして
  // 上位で fallback (rarity 連動の default) に落とす。0 や 8+ を弾く。
  if (!Number.isFinite(n) || n < 1 || n > 7) return undefined;
  return n;
}

/**
 * 「赤1 generic2」「白白 青」「なし」「0」みたいな自由形式の文字列を ManaCost に解釈。
 * 認識できないトークンは無視する (LLM 出力の揺れに耐える)。
 * 全部 0 / 空 / "なし" 系 → 空 ManaCost を返す。
 */
export function parseManaCostString(raw: string): ManaCost {
  const trimmed = raw.trim();
  if (!trimmed || /^(なし|無し|none|0|-|—|―)$/i.test(trimmed)) return {};
  const out: { W?: number; U?: number; B?: number; R?: number; G?: number; generic?: number } = {};
  const add = (k: 'W' | 'U' | 'B' | 'R' | 'G' | 'generic', n: number) => {
    if (n <= 0) return;
    out[k] = (out[k] ?? 0) + n;
  };
  const tokens = trimmed.split(/[\s,、,+]+/).filter((t) => t.length > 0);
  for (const tok of tokens) {
    const gMatch = tok.match(/^(?:generic|GE|無色|無)(\d*)$/i);
    if (gMatch) {
      add('generic', Number(gMatch[1] || '1'));
      continue;
    }
    if (/^\d+$/.test(tok)) {
      add('generic', Number(tok));
      continue;
    }
    let i = 0;
    while (i < tok.length) {
      const ch = tok[i]!;
      const color = COLOR_FROM_NAME[ch];
      if (color) {
        let j = i + 1;
        while (j < tok.length && /\d/.test(tok[j]!)) j++;
        const n = j > i + 1 ? Number(tok.slice(i + 1, j)) : 1;
        add(color, n);
        i = j;
      } else if (/^\d+/.test(tok.slice(i))) {
        const m = tok.slice(i).match(/^(\d+)/)!;
        add('generic', Number(m[1]!));
        i += m[1]!.length;
      } else {
        i++;
      }
    }
  }
  return sanitizeManaCost(out);
}

export function parseCardTypeString(raw: string): CardType | null {
  const t = raw.trim().toLowerCase().replace(/\s+/g, '');
  for (const [key, value] of Object.entries(CARD_TYPE_FROM_JA)) {
    if (t.includes(key.toLowerCase())) return value;
  }
  return null;
}

interface ParsedAbility {
  type: CardType;
  manaCost: ManaCost;
  cardName: string;
  name: string;
  abilityCost: ManaCost | null;
  abilityTap: boolean;
  description: string;
  keywords: string[];
  power?: number;
  toughness?: number;
}

/** 能力用: type + manaCost + cardName + name + abilityCost + description (+ creature の場合は keywords/power/toughness) を抽出。 */
export function parseAbilityOutput(raw: string): ParsedAbility | null {
  const text = stripMarkdown(raw.replace(/\r\n/g, '\n'));
  const lines = text.split('\n').map((l) => l.trim()).filter((l) => l);
  const out = { type: '', manaCost: '', cardName: '', name: '', abilityCost: '', description: '', keywords: '', power: '', toughness: '' };
  type FieldKey = keyof typeof out;
  let pending: FieldKey | null = null;
  for (const line of lines) {
    const lineClean = line.replace(/^[-・*#>\s]+/, '').trim();
    let matched = false;
    for (const key of ['type', 'manaCost', 'cardName', 'name', 'abilityCost', 'description', 'keywords', 'power', 'toughness'] as const) {
      const m = lineClean.match(HEADERS[key]);
      if (!m) continue;
      matched = true;
      if (m[1]!.trim()) {
        if (!out[key]) out[key] = stripWrappers(m[1]!);
        pending = null;
      } else {
        pending = key;
      }
      break;
    }
    if (matched) continue;
    if (pending && !out[pending]) { out[pending] = stripWrappers(lineClean); pending = null; }
  }
  if (!out.name || !out.description) return null;
  const cardType = parseCardTypeString(out.type) ?? 'creature';
  const manaCost = parseManaCostString(out.manaCost);
  if (manaCostTotal(manaCost) === 0) return null;
  const abilityCostRaw = out.abilityCost.trim();
  // タップ表記の検出: 「タップ」「{T}」「T」(単独トークン) を含むか。
  const hasTap = /タップ|\{?\s*T\s*\}?/i.test(abilityCostRaw) && !!abilityCostRaw && !/^(なし|無し|none|-|—|―)$/i.test(abilityCostRaw);
  // タップ表記を除去してから マナを解釈 (パース側がタップ字を generic と誤解しないように)。
  const abilityCostMana = abilityCostRaw
    .replace(/\{?\s*T\s*\}?/gi, ' ')
    .replace(/タップ/g, ' ')
    .trim();
  const abilityCost: ManaCost | null =
    !abilityCostMana || /^(なし|無し|none|-|—|―)$/i.test(abilityCostMana)
      ? null
      : (() => {
          const parsed = parseManaCostString(abilityCostMana);
          return manaCostTotal(parsed) > 0 ? parsed : null;
        })();
  const abilityTap = hasTap;
  if (out.name.length < 1 || out.name.length > 20) return null;
  if (out.description.length < 6 || out.description.length > 180) return null;
  // cardName が抜けたら能力名で代替 (LLM が出してくれなかった時の安全弁)
  const cardName = (out.cardName && out.cardName.length >= 2 && out.cardName.length <= 24)
    ? out.cardName
    : out.name;
  const isCreature = cardType === 'creature';
  const keywords = isCreature ? parseKeywordsString(out.keywords) : [];
  const power = isCreature ? parseStatNumber(out.power) : undefined;
  const toughness = isCreature ? parseStatNumber(out.toughness) : undefined;
  return {
    type: cardType,
    manaCost,
    cardName,
    name: out.name,
    abilityCost,
    abilityTap,
    description: out.description,
    keywords,
    ...(power !== undefined ? { power } : {}),
    ...(toughness !== undefined ? { toughness } : {}),
  };
}

/** フレーバー用: 1 行だけ抽出。 */
export function parseFlavorOutput(raw: string): string | null {
  const text = stripMarkdown(raw.replace(/\r\n/g, '\n'));
  const lines = text.split('\n').map((l) => l.trim()).filter((l) => l);
  for (const line of lines) {
    const lineClean = line.replace(/^[-・*#>\s]+/, '').trim();
    const m = lineClean.match(HEADERS.flavor);
    if (m && m[1]!.trim()) {
      const t = stripWrappers(m[1]!);
      if (t.length >= 10 && t.length <= 200) return t;
    }
  }
  const plain = lines.filter((l) => !Object.values(HEADERS).some((rx) => rx.test(l)));
  if (plain.length > 0) {
    const t = stripWrappers(plain[0]!);
    if (t.length >= 10 && t.length <= 200) return t;
  }
  return null;
}
