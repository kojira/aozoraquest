/**
 * カードの「能力テキスト」+「フレーバーテキスト」を生成する。
 * MTG に倣い:
 *   - 能力行 (ability): 認知機能の特徴を擬似能力として日本語で表現
 *     (例: 「俊敏 ― 他者の気配を先読みし、いち早く動き出す。」)
 *   - フレーバー (flavor): カード下部の italic、詩的な 1 文
 *
 * 実行: TinySwallow で 1 回の生成で両方を構造化出力 → 解析。
 * 失敗時は archetype ごとのハンドクラフト pool から抽選。
 */

import type { Archetype, CogFunction, DiagnosisResult, Rarity } from '@aozoraquest/core';
import {
  COGNITIVE_FUNCTIONS,
  JOBS_BY_ID,
  jobDisplayName,
  RARITY_GUIDANCE,
  RARITY_LABEL,
  defaultCostFor,
} from '@aozoraquest/core';
import { getGenerator } from './generator';
import { pickFallbackFlavor, pickFallbackEffect } from './job-flavor-fallback';

const COG_LABEL: Record<CogFunction, string> = {
  Ni: '内向直観 (本質を見抜く)',
  Ne: '外向直観 (可能性を広げる)',
  Si: '内向感覚 (積み重ねを信じる)',
  Se: '外向感覚 (今この瞬間に動く)',
  Ti: '内向思考 (論理の整合を組む)',
  Te: '外向思考 (結果で示す)',
  Fi: '内向感情 (自分の価値観に忠実)',
  Fe: '外向感情 (場の調和を整える)',
};

export interface CardTextSource {
  kind: 'llm' | 'fallback';
  backend?: 'webgpu' | 'wasm';
}

export interface CardEffect {
  /** キーワード名 (2-5 字)。例: 潜影 / 星読み */
  name: string;
  /** 発動コスト (テキスト表現)。MTG 風の「タップ」「生贄」「パワーN支払う」等。
   *  パッシブ能力の場合は「なし」もしくは空文字。 */
  cost: string;
  /** 効果説明 (20-40 字)。 */
  description: string;
}

export interface CardText {
  /** 能力 (名前 + コスト + 説明) */
  effect: CardEffect;
  /** 40-60 字の flavor text、italic 描画前提。 */
  flavor: string;
  source: CardTextSource;
}

/** 希少度ごとの「コスト目安」— プロンプトに当該 rarity だけを埋めて短く保つ。
 *  SNS 世界観のコスト表現 (投稿削除・フォロワ喪失・いいね消費 等) を混ぜる。 */
const COST_GUIDANCE: Record<Rarity, string> = {
  common: 'コスト例: 「なし」/ 「このカードをタップする。」/ 「いいねを 1 個消費する。」 の軽いもの。',
  uncommon: 'コスト例: 「このカードをタップする。」/ 「いいねを 3 個消費する。」/ 「投稿の下書きを 1 本捨てる。」',
  rare: 'コスト例: 「リポストを 1 回する。」/ 「タップし、いいねを 5 個消費する。」/ 「引用返信を 1 つ捨てる。」',
  srare: 'コスト例: 「タップし、仲間 1 体を生贄に捧げる。」/ 「あなたの投稿を 1 つ削除する。」',
  ssr: 'コスト例: 「タップし、あなたの投稿を 1 つ削除し、いいねを 10 個消費する。」/ 「フォロワを 5 人失う。」 など重め。',
  ur: 'コスト例: 「タップし、仲間 2 体を生贄に捧げ、フォロワを 10 人失う。」/ 「あなたのタイムラインを 1 日封じる。」 など非常に重い複数要素。',
};

/** LLM に与える SNS 世界観リファレンス。全 rarity 共通でプロンプトに入れる。
 *  TinySwallow は Bluesky のような固有名を知らない可能性が高いので、
 *  一般名の「SNS」で統一する。 */
const SNS_REFERENCE = [
  '世界観: 旅人たちは SNS (投稿と繋がりの広場) でも戦う。',
  'コストで使える要素: 投稿を削除する / フォロワを N 人失う / いいねを N 個消費する /',
  '  リポスト (再投稿) を 1 回する / 引用返信を 1 つする / 下書きを 1 本捨てる /',
  '  タイムラインを一時封じる / 仲間を生贄に捧げる / カードをタップする /',
  '  あおぞらパワー N を支払う。',
  '説明で使えるネタ: 相手の投稿を一時的に隠す / 場のフォロワが騒ぐ / ハッシュタグが広がる /',
  '  引用の連鎖が止まる / 誰かの下書きが完成する / 眠れる通知が一斉に鳴る / など。',
  '能力名の参考: 驚天動地 / 世界征服 / 先制攻撃 / 沼わたり / 言霊 / 炎上鎮火 / 引用封じ /',
  '  リポ螺旋 / 沈黙の波紋 / 双頭の筆 / 薄明の呼応 / 等、RPG 調と SNS 調どちらもあり。',
].join('\n');

/** 希少度ごとの 1-shot example。当該 rarity の例だけを system に含める。
 *  Bluesky の世界観 (投稿・フォロワ・いいね・引用) を織り交ぜた能力を例示。 */
const EXAMPLE: Record<Rarity, string> = {
  common: [
    '能力名: 先制攻撃',
    'コスト: このカードをタップする。',
    '説明: いいねが付く前に、あなたの返信が相手のタイムラインを横切る。',
    'フレーバー: 反射ではない。先に動けるのは、先に見ていた者だけだ。',
  ].join('\n'),
  uncommon: [
    '能力名: 沼わたり',
    'コスト: いいねを 3 個消費する。',
    '説明: 荒れた引用の連鎖を飛び越えて、話の本筋まで戻す。',
    'フレーバー: 沼は踏めば沈む。だが彼は沼そのものに名前を呼ばせる。',
  ].join('\n'),
  rare: [
    '能力名: 引用封じ',
    'コスト: このカードをタップし、いいねを 5 個消費する。',
    '説明: ターン終了まで、対象の投稿は誰も引用返信できない。',
    'フレーバー: 言葉は確かに置かれた。しかし、それを運ぶ風は吹かなかった。',
  ].join('\n'),
  srare: [
    '能力名: 沈黙の波紋',
    'コスト: このカードをタップし、あなたの投稿を 1 つ削除する。',
    '説明: 場にある全てのハッシュタグを、一度だけ沈める。',
    'フレーバー: 消えた言葉の跡に、場の熱がそっと下がっていった。',
  ].join('\n'),
  ssr: [
    '能力名: 驚天動地',
    'コスト: このカードをタップし、仲間 1 体を生贄に捧げ、フォロワを 5 人失う。',
    '説明: 全プレイヤーのタイムラインを一度入れ替え、順序を無効にする。',
    'フレーバー: 空が、皆の頭上でおとなしくページをめくり直した。',
  ].join('\n'),
  ur: [
    '能力名: 世界征服',
    'コスト: このカードをタップし、仲間 2 体を生贄に捧げ、フォロワを 10 人失う。',
    '説明: 次のターン、全てのカードとタイムラインを自分の管理下に置く。',
    'フレーバー: 青空を一度、自分の名で畳んだ。誰も、その手つきを真似できなかった。',
  ].join('\n'),
};

function buildPrompt(result: DiagnosisResult, rarity: Rarity): { system: string; user: string } {
  const job = JOBS_BY_ID[result.archetype];
  const name = jobDisplayName(result.archetype);
  const top = [...COGNITIVE_FUNCTIONS]
    .sort((a, b) => (result.cognitiveScores[b] ?? 0) - (result.cognitiveScores[a] ?? 0))
    .slice(0, 4);
  const topDesc = top.map((fn) => `${fn} ${COG_LABEL[fn]}`).join('、');
  const rarityLabel = RARITY_LABEL[rarity];
  const rarityGuidance = RARITY_GUIDANCE[rarity];
  const costGuidance = COST_GUIDANCE[rarity];
  const example = EXAMPLE[rarity];

  const system = [
    'あなたはトレーディングカードゲームのカード文を書く詩人兼デザイナーです。',
    '能力 (名前・コスト・説明) と古文書風フレーバーを日本語で 1 セット書きます。',
    '',
    SNS_REFERENCE,
    '',
    `希少度: ${rarityLabel}`,
    `${rarityGuidance}`,
    `${costGuidance}`,
    '',
    '出力形式は以下の 4 行のみ。他には何も書かない。',
    '能力名: <2〜5字、RPG 調 or SNS 調のキーワード>',
    'コスト: <日本語、SNS 要素を混ぜてよい。なし でも可>',
    '説明: <20〜40字、SNS 世界観のネタを使ってよい>',
    'フレーバー: <40〜60字の詩的な 1 文>',
    '',
    '禁止: Markdown (**、*、_)、括弧 (「」『』《》)、見出し記号 (#)、前置き、5行以上の出力。',
    '',
    '例:',
    example,
  ].join('\n');

  const user = [
    `職業: ${name}`,
    `主機能: ${job.dominantFunction} (${COG_LABEL[job.dominantFunction]})`,
    `副機能: ${job.auxiliaryFunction} (${COG_LABEL[job.auxiliaryFunction]})`,
    `上位傾向: ${topDesc}`,
    `希少度: ${rarityLabel}`,
    '',
    '上に合う能力とフレーバーを 1 組だけ書いてください。',
  ].join('\n');

  return { system, user };
}

export function stripMarkdown(s: string): string {
  let t = s;
  t = t.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/__([^_]+)__/g, '$1');
  t = t.replace(/(?<![\*])\*([^\*\n]+)\*(?![\*])/g, '$1');
  t = t.replace(/(?<![_])_([^_\n]+)_(?![_])/g, '$1');
  return t;
}

function stripWrappers(s: string): string {
  return s
    .replace(/^[「『《【〈"'“”]+/, '')
    .replace(/[」』》】〉"'“”]+$/, '')
    .trim();
}

/** LLM 出力から 4 項目 (能力名 / コスト / 説明 / フレーバー) を抽出する。 */
function parseLLMOutput(raw: string): { name: string; cost: string; description: string; flavor: string } | null {
  const text = stripMarkdown(raw.replace(/\r\n/g, '\n'));
  const lines = text.split('\n').map((l) => l.trim()).filter((l) => l);

  const HEADERS: Record<'name' | 'cost' | 'description' | 'flavor', RegExp> = {
    name: /^(?:能力名|キーワード|スキル名|アビリティ名|名前)[:\s::・　]*(.*)$/,
    cost: /^(?:コスト|起動コスト|代償|消費)[:\s::・　]*(.*)$/,
    description: /^(?:説明|効果|能力|動作|挙動)[:\s::・　]*(.*)$/,
    flavor: /^(?:フレーバー|flavor|情景|詩|口上)[:\s::・　]*(.*)$/i,
  };

  const out: Record<'name' | 'cost' | 'description' | 'flavor', string> = {
    name: '', cost: '', description: '', flavor: '',
  };
  let pending: keyof typeof out | null = null;

  for (const line of lines) {
    const lineClean = line.replace(/^[-・*#>\s]+/, '').trim();
    let matched = false;
    for (const key of Object.keys(HEADERS) as (keyof typeof HEADERS)[]) {
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
    if (pending && !out[pending]) {
      out[pending] = stripWrappers(lineClean);
      pending = null;
    }
  }

  // fallback: header が全く無い場合は 1-4 行目を順に充当
  if ((!out.name || !out.description || !out.flavor) && lines.length >= 3) {
    const plain = lines.filter((l) =>
      !Object.values(HEADERS).some((rx) => rx.test(l)),
    );
    if (plain.length >= 3) {
      if (!out.name) out.name = stripWrappers(plain[0]!);
      if (!out.cost) out.cost = plain[1] ? stripWrappers(plain[1]!) : 'なし';
      if (!out.description) out.description = stripWrappers(plain[2]!);
      if (!out.flavor && plain[3]) out.flavor = stripWrappers(plain[3]!);
    }
  }

  if (!out.name || !out.description || !out.flavor) return null;
  if (!out.cost) out.cost = 'なし';
  // 長さサニティ
  if (out.name.length < 1 || out.name.length > 16) return null;
  if (out.cost.length > 120) return null;
  if (out.description.length < 6 || out.description.length > 160) return null;
  if (out.flavor.length < 10 || out.flavor.length > 180) return null;
  return out;
}

async function generateWithLLM(
  result: DiagnosisResult,
  rarity: Rarity,
  timeoutMs: number,
): Promise<CardText | null> {
  const gen = getGenerator();
  try {
    await gen.load();
  } catch (e) {
    console.warn('[card-text] generator load failed', e);
    return null;
  }
  const { system, user } = buildPrompt(result, rarity);
  const messages = [
    { role: 'system' as const, content: system },
    { role: 'user' as const, content: user },
  ];
  try {
    const fullPromise = gen.generate(messages);
    const raced = await Promise.race([
      fullPromise,
      new Promise<string>((_, rej) => setTimeout(() => rej(new Error('card-text LLM timeout')), timeoutMs)),
    ]);
    console.info('[card-text] raw LLM output:\n' + raced);
    const parsed = parseLLMOutput(raced);
    if (!parsed) {
      console.warn('[card-text] parse failed, falling back. raw length=', raced.length);
      return null;
    }
    console.info('[card-text] parsed →', parsed);
    const source: CardTextSource = { kind: 'llm' };
    const backend = gen.getBackend();
    if (backend) source.backend = backend;
    return {
      effect: { name: parsed.name, cost: parsed.cost, description: parsed.description },
      flavor: parsed.flavor,
      source,
    };
  } catch (e) {
    console.warn('[card-text] generation failed', e);
    return null;
  }
}

/** effect + flavor を生成 (メイン API)。失敗時は fallback。rarity を必ず渡す。 */
export async function generateCardText(
  result: DiagnosisResult,
  rarity: Rarity,
  opts: { seed?: number; timeoutMs?: number } = {},
): Promise<CardText> {
  const seed = opts.seed ?? Date.now();
  const timeoutMs = opts.timeoutMs ?? 60000;
  const llm = await generateWithLLM(result, rarity, timeoutMs);
  if (llm) return llm;
  return buildFallbackCardText(result.archetype, rarity, seed);
}

function buildFallbackCardText(archetype: Archetype, rarity: Rarity, seed: number): CardText {
  const raw = pickFallbackEffect(archetype, seed);
  const { name, description } = splitFallbackEffect(raw);
  const cost = fallbackCostFor(rarity, seed);
  return {
    effect: { name, cost, description },
    flavor: pickFallbackFlavor(archetype, seed),
    source: { kind: 'fallback' },
  };
}

/** 旧ハンドクラフト effect 文字列 "名前 ― 説明" を分割する。 */
function splitFallbackEffect(raw: string): { name: string; description: string } {
  const m = raw.match(/^([^\s―—–\-]{1,8})\s*[―—–\-]\s*(.+)$/);
  if (m) return { name: m[1]!, description: m[2]! };
  return { name: raw.slice(0, 4), description: raw };
}

/** 希少度と seed から fallback 用のコスト文言を合成。 */
function fallbackCostFor(rarity: Rarity, seed: number): string {
  const n = defaultCostFor(rarity, (seed / 1000) % 1);
  if (rarity === 'common') {
    return n === 0 ? 'なし' : 'このカードをタップする。';
  }
  if (rarity === 'uncommon') {
    return n <= 1 ? 'このカードをタップする。' : 'あおぞらパワー 1 を支払う。';
  }
  if (rarity === 'rare' || rarity === 'srare') {
    return `このカードをタップし、あおぞらパワー ${Math.max(1, n - 1)} を支払う。`;
  }
  // ssr / ur
  return `このカードをタップし、仲間 1 体を生贄に捧げ、あおぞらパワー ${n} を支払う。`;
}

/** fallback だけ (テスト用) */
export function getFallbackCardText(archetype: Archetype, seed: number, rarity: Rarity = 'common'): CardText {
  return buildFallbackCardText(archetype, rarity, seed);
}

