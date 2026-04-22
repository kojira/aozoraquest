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
 *  一般名の「SNS」で統一する。
 *
 *  トーンはあえて「笑える・あるある・軽い自嘲」寄り。真面目詩的は避ける。 */
const SNS_REFERENCE = [
  '世界観: 旅人たちは SNS (投稿と繋がりの広場) で戦う。深刻ぶらず、どこか笑える。',
  '',
  'コストで使える要素:',
  '  - このカードをタップする',
  '  - あおぞらパワー N を支払う',
  '  - あなたの投稿を 1 つ削除する',
  '  - フォロワを N 人失う',
  '  - いいねを N 個消費する',
  '  - リポスト (再投稿) を 1 回する',
  '  - 引用返信を 1 つ捨てる',
  '  - 下書きを 1 本捨てる',
  '  - 仲間 1 体を生贄に捧げる',
  '',
  '説明で使える "あるある" ネタ:',
  '  - 深夜 2 時に送信ボタンを押す / 翌朝消したくなる',
  '  - 推敲せず投稿 / 直後に誤字に気付く',
  '  - フォロワが静かに増減する',
  '  - 返信を打ちかけて消す (何度も)',
  '  - 自分の古い投稿がリプ沼から掘り起こされる',
  '  - 通知が一斉に鳴る / 一斉に止まる',
  '  - ハッシュタグが意図せず広がる',
  '  - 誰かの下書きが勝手に完成する',
  '  - 既読スルー / ミュート解除',
  '',
  '能力名の参考 (RPG 調 × SNS あるある、迷った時用):',
  '  驚天動地 / 世界征服 / 先制攻撃 / 沼わたり / 深夜の暴走 / 推敲漏れ /',
  '  指滑り / 通知ノック / 既読スルー / 炎上鎮火 / 引用封じ / リプ沼突入 /',
  '  後悔の朝 / 言霊暴発 / ミュート返し / 空リプ連打。',
].join('\n');

/** 希少度ごとの 1-shot example (ユーモア寄り・あるあるネタ)。 */
const EXAMPLE: Record<Rarity, string> = {
  common: [
    '能力名: 指滑り',
    'コスト: このカードをタップする。',
    '説明: 送信直前で気が変わり、全く違う絵文字 1 つだけを投稿する。',
    'フレーバー: 意味があるのではない。指に先を越されただけだ。それでもいいねは 3 つ付く。',
  ].join('\n'),
  uncommon: [
    '能力名: 推敲漏れ',
    'コスト: いいねを 3 個消費する。',
    '説明: 最も届けたかった相手にだけ、誤字入りの返信が飛ぶ。届く速度は普段の 3 倍。',
    'フレーバー: 送信ボタンは昔から彼より素早い。反省会だけが毎晩、生真面目に開かれる。',
  ].join('\n'),
  rare: [
    '能力名: 既読スルー',
    'コスト: このカードをタップし、いいねを 5 個消費する。',
    '説明: 対象の返信を読んだが返さない。相手のタイムラインに微妙な沈黙が広がる。',
    'フレーバー: 沈黙は金だというが、相手にとっては無言の拷問だったりする。',
  ].join('\n'),
  srare: [
    '能力名: 深夜の暴走',
    'コスト: このカードをタップし、あなたの投稿を 1 つ削除する。',
    '説明: 午前 2 時に本音を連投。朝になると自分で全部消したくなる。',
    'フレーバー: 眠気に負けた者は、翌朝自分の言葉と再会する。たいてい、泣く。',
  ].join('\n'),
  ssr: [
    '能力名: 通知一斉ノック',
    'コスト: このカードをタップし、仲間 1 体を生贄に捧げ、フォロワを 5 人失う。',
    '説明: 場の全プレイヤーの通知が同時に鳴る。内容は全部、あなたの 3 年前の投稿。',
    'フレーバー: 過去は消えない。ただ、掘り起こされるタイミングを常に待っている。',
  ].join('\n'),
  ur: [
    '能力名: 世界征服 (あしたからほんき)',
    'コスト: このカードをタップし、仲間 2 体を生贄に捧げ、フォロワを 10 人失う。',
    '説明: 次のターン、全タイムラインの流れを自分好みに並び替える。ただし明日までに忘れる。',
    'フレーバー: 青空を一度、自分の名で畳んだ。畳み方が雑すぎて、誰も真似しようと思わなかった。',
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
    'あなたはユーモアの効いた SNS トレカのデザイナーです。',
    '能力 (名前・コスト・説明) + フレーバーを日本語 1 セットで書きます。',
    'トーン: 深刻すぎず、あるある寄り、軽い自嘲や皮肉を含めるとよい。詩的一辺倒は避ける。',
    'フレーバーはできれば最後に小さなオチ (軽いツッコミ or 哲学) で締める。',
    '',
    SNS_REFERENCE,
    '',
    `希少度: ${rarityLabel}`,
    `${rarityGuidance}`,
    `${costGuidance}`,
    '',
    '出力形式は以下の 4 行のみ。他には何も書かない。',
    '能力名: <2〜8字、RPG 調 or SNS あるある>',
    'コスト: <日本語、SNS 要素を混ぜてよい。なし でも可>',
    '説明: <20〜50字、具体的なあるあるネタを 1 つ入れる>',
    'フレーバー: <40〜70字、オチを含む 1 文>',
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

