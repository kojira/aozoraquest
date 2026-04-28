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

import type { Archetype, DiagnosisResult, Rarity } from '@aozoraquest/core';
import {
  jobDisplayName,
  RARITY_GUIDANCE,
  RARITY_LABEL,
  defaultCostFor,
} from '@aozoraquest/core';
import { getGenerator } from './generator';
import { pickFallbackFlavor, pickFallbackEffect } from './job-flavor-fallback';
import { isLowEndDevice } from './device';

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

/** 希少度ごとのコスト例 (当該レアリティのみプロンプトに埋める)。 */
const COST_GUIDANCE: Record<Rarity, string> = {
  common: 'なし / このカードをタップする / いいね 1 消費',
  uncommon: 'タップ / いいね 3 消費 / 下書き 1 捨てる',
  rare: 'リポスト 1 回 / タップ + いいね 5 消費',
  srare: 'タップ + 仲間 1 生贄 / 投稿 1 削除',
  ssr: 'タップ + 投稿 1 削除 + いいね 10 消費',
  ur: 'タップ + 仲間 2 生贄 + フォロワ 10 喪失',
};

/** SNS 世界観の短いヒント (能力用)。 */
const SNS_HINT_ABILITY = [
  'SNS (投稿と繋がりの広場) が舞台。コスト要素: タップ / あおぞらパワー / 投稿削除 / フォロワ喪失 / いいね消費 / リポスト / 下書き / 仲間生贄。',
  '効果は「ネガティブ縛り」ではない。仲間に贈る / 場を温める / 相手の手札を覗く / 山札を増やす など、明るい効果も歓迎。',
].join('\n');

/** SNS 世界観の短いヒント (flavor 用)。 */
const SNS_HINT_FLAVOR = [
  'SNS の場面例: 朝の挨拶 / 推し布教 / 共感のリプ / 不意の繋がり / 励まし / 朝焼けの共有 / 笑いの伝染 / 既読スルー / 推敲漏れ / 通知一斉。',
  'トーンは前向き・観察・皮肉のいずれかを毎回選び直す。同じ調子に偏らない。',
].join('\n');

/**
 * 出力トーンを毎回ランダムに切り替えて単調さを避ける。
 * - positive: 明るく前向き、ささやかな祝福や成功で締める
 * - observational: 観察的・淡々、最後の一文で小さな発見
 * - ironic: 皮肉まじり、自嘲オチ
 *
 * 1 枚のカード内では ability と flavor で同一トーンを使う (整合のため)。
 */
type Tone = 'positive' | 'observational' | 'ironic';
const TONES: readonly Tone[] = ['positive', 'observational', 'ironic'];

const TONE_LABEL: Record<Tone, string> = {
  positive: '前向き',
  observational: '観察的',
  ironic: '皮肉まじり',
};

const TONE_DIRECTIVE: Record<Tone, string> = {
  positive: '前向きで明るく、最後はささやかな祝福・成功・繋がりで締める。皮肉や自嘲は使わない。',
  observational: '観察的・淡々と。状況を写し取るように書き、最後の一文に小さな発見を置く。',
  ironic: 'ユーモアや皮肉を含むが温度は冷たくしない。最後は自嘲気味の小さなオチで締める。',
};

function pickTone(seed?: number): Tone {
  if (seed === undefined) {
    return TONES[Math.floor(Math.random() * TONES.length)] ?? 'observational';
  }
  const i = Math.abs(Math.floor(seed)) % TONES.length;
  return TONES[i] ?? 'observational';
}

/** 能力 (ルール文) 用の 1-shot example。トーン × 希少度の 2 軸。
 *  TCG のルールテキスト調で機械的に書く。 */
const ABILITY_EXAMPLE: Record<Rarity, Record<Tone, string>> = {
  common: {
    positive: [
      '能力名: 朝の挨拶',
      'コスト: このカードをタップする。',
      '説明: 仲間 1 人を選び、いいねを 1 個贈る。',
    ].join('\n'),
    observational: [
      '能力名: 通勤途中',
      'コスト: なし。',
      '説明: あなたの山札の一番上のカードを見る。山札の上に戻す。',
    ].join('\n'),
    ironic: [
      '能力名: 指滑り',
      'コスト: このカードをタップする。',
      '説明: カードを 1 枚山札から引く。',
    ].join('\n'),
  },
  uncommon: {
    positive: [
      '能力名: 笑いの伝染',
      'コスト: このカードをタップする。',
      '説明: 仲間 1 人を選び、そのプレイヤーの手札 1 枚をタップ状態から起こす。',
    ].join('\n'),
    observational: [
      '能力名: 既読待ち',
      'コスト: いいねを 1 個消費する。',
      '説明: 対象プレイヤーが今ターン中に引いた最新の 1 枚を公開する。',
    ].join('\n'),
    ironic: [
      '能力名: 推敲漏れ',
      'コスト: いいねを 3 個消費する。',
      '説明: 対象プレイヤーの手札を 1 枚ランダムに公開する。',
    ].join('\n'),
  },
  rare: {
    positive: [
      '能力名: 推し布教',
      'コスト: このカードをタップし、リポストを 1 回行う。',
      '説明: 仲間 1 人のカード 1 枚をコピーし、そのコピーを今ターン中にプレイできる。',
    ].join('\n'),
    observational: [
      '能力名: 投稿時間表',
      'コスト: このカードをタップする。',
      '説明: 各プレイヤーは山札の一番上を公開し、コスト順に並べ直す。',
    ].join('\n'),
    ironic: [
      '能力名: 既読スルー',
      'コスト: このカードをタップし、いいねを 5 個消費する。',
      '説明: 対象プレイヤーは今ターン 1 枚しかカードをプレイできない。',
    ].join('\n'),
  },
  srare: {
    positive: [
      '能力名: 合奏',
      'コスト: このカードをタップし、あおぞらパワー 2 を支払う。',
      '説明: 仲間 2 人を選び、そのターン中に追加で 1 アクション行えるようにする。',
    ].join('\n'),
    observational: [
      '能力名: 朝焼け会議',
      'コスト: このカードをタップする。',
      '説明: 全プレイヤーは手札を 1 枚公開する。最も低コストのカードを場に出す。',
    ].join('\n'),
    ironic: [
      '能力名: 深夜の暴走',
      'コスト: このカードをタップし、あなたの投稿を 1 つ削除する。',
      '説明: あなたの墓地のカードを 2 枚、手札に戻す。',
    ].join('\n'),
  },
  ssr: {
    positive: [
      '能力名: 朝焼け宣言',
      'コスト: このカードをタップし、いいねを 5 個消費する。',
      '説明: 場にある全カードのコストを、このターンの間 1 軽くする。',
    ].join('\n'),
    observational: [
      '能力名: タイムライン圏外',
      'コスト: このカードをタップし、仲間 1 体を生贄に捧げる。',
      '説明: 場の全カードを 1 ターンの間、行動不能 (タップ状態) にする。',
    ].join('\n'),
    ironic: [
      '能力名: 通知一斉ノック',
      'コスト: このカードをタップし、仲間 1 体を生贄に捧げ、フォロワを 5 人失う。',
      '説明: 全プレイヤーのカードを墓地から 3 枚まで、手札に戻す。',
    ].join('\n'),
  },
  ur: {
    positive: [
      '能力名: 青空再生',
      'コスト: このカードをタップし、仲間 2 体を生贄に捧げる。',
      '説明: 全プレイヤーの墓地を全て山札に戻し、各自カードを 3 枚引く。',
    ].join('\n'),
    observational: [
      '能力名: 青空の譜',
      'コスト: このカードをタップし、フォロワを 10 人失う。',
      '説明: 全プレイヤーの山札を混ぜ直し、各自手札を 5 枚に揃え直す。',
    ].join('\n'),
    ironic: [
      '能力名: 世界征服',
      'コスト: このカードをタップし、仲間 2 体を生贄に捧げ、フォロワを 10 人失う。',
      '説明: あなたの次のターン終了まで、全プレイヤーのカードの操作権を得る。',
    ].join('\n'),
  },
};

/** フレーバー用の 1-shot example。トーン × 希少度の 2 軸。詩的 1 文。 */
const FLAVOR_EXAMPLE: Record<Rarity, Record<Tone, string>> = {
  common: {
    positive: '通勤路の桜が一輪、誰にも気づかれずに、今日は彼にだけ咲いた。',
    observational: '朝のホームに、いつもの顔と、いつもとちがう天気が並んでいる。',
    ironic: '意味があったのではない。指に先を越されただけだ。それでもいいねは 3 つ付く。',
  },
  uncommon: {
    positive: '笑いは伝染する。最初に笑った彼自身が、いちばん遅く気付いた。',
    observational: '既読は届く。返信は届かない。距離だけが、ゆっくりと近づいてくる。',
    ironic: '送信ボタンは昔から彼より素早い。反省会だけが毎晩、生真面目に開かれる。',
  },
  rare: {
    positive: '推しの一言を引用したら、見知らぬ十人と、同じ夜空を共有していた。',
    observational: '投稿時間は人柄を語る。語らせていることに、本人だけが気付いていない。',
    ironic: '沈黙は金だというが、相手にとっては無言の拷問だったりもする。',
  },
  srare: {
    positive: '合奏は揃わぬ拍子から始まる。揃ってしまえば、あとは奏でているだけだ。',
    observational: '早朝のタイムラインは別世界だ。同じ青空でも、誰が起きているかで色が変わる。',
    ironic: '眠気に負けた者は、翌朝自分の言葉と再会する。たいてい、泣く。',
  },
  ssr: {
    positive: '朝焼けを共有した夜は、ログインしていなくとも、確かに繋がっていた。',
    observational: '通知が一斉に鳴る瞬間、世界はほんのわずかに、同じ方向を向く。',
    ironic: '過去は消えない。ただ、掘り起こされるタイミングを、いつも待っている。',
  },
  ur: {
    positive: '青空は誰のものでもない。だからこそ、彼の一言で、世界はもう一度始められる。',
    observational: '再起動の合図は、いつも誰かの「おはよう」だ。それが今日の世界を作る。',
    ironic: '青空を一度、自分の名で畳んだ。畳み方が雑すぎて、誰も真似しようと思わなかった。',
  },
};

/** 能力 (ルールテキスト) 生成用プロンプト。機械的・ゲーム効果寄り。 */
function buildAbilityPrompt(result: DiagnosisResult, rarity: Rarity, tone: Tone): { system: string; user: string } {
  const rarityLabel = RARITY_LABEL[rarity];

  const system = [
    'あなたはトレカのルールテキストを書くゲームデザイナーです。日本語で能力 1 組だけ書きます。',
    SNS_HINT_ABILITY,
    `今回のトーン (${TONE_LABEL[tone]}): ${TONE_DIRECTIVE[tone]}`,
    '',
    '出力は次の 3 行のみ。前置き・Markdown・括弧類・箇条書き禁止。',
    '能力名: <2〜8字>',
    'コスト: <なし でも可>',
    '説明: <20〜50字。具体的なゲーム効果のみ。詩的描写禁止>',
    '',
    `例 (${rarityLabel} / ${TONE_LABEL[tone]}):`,
    ABILITY_EXAMPLE[rarity][tone],
  ].join('\n');

  const user = [
    `職業: ${jobDisplayName(result.archetype)}`,
    `希少度: ${rarityLabel}`,
    `コスト例: ${COST_GUIDANCE[rarity]}`,
    `雰囲気: ${RARITY_GUIDANCE[rarity]}`,
    `トーン: ${TONE_LABEL[tone]}`,
    '',
    '上記に合う能力を 1 組だけ。',
  ].join('\n');

  return { system, user };
}

/** フレーバーテキスト生成用プロンプト。トーンに沿った 1 文。 */
function buildFlavorPrompt(result: DiagnosisResult, rarity: Rarity, abilityName: string, tone: Tone): { system: string; user: string } {
  const rarityLabel = RARITY_LABEL[rarity];

  const system = [
    'あなたはトレカのフレーバー作家です。能力の直下に添える 1 文を日本語で書きます。',
    `今回のトーン (${TONE_LABEL[tone]}): ${TONE_DIRECTIVE[tone]}`,
    'ゲーム効果は書かない。詩的でありながら、上のトーン指示を守る。',
    SNS_HINT_FLAVOR,
    '',
    '出力は次の 1 行のみ。前置き・Markdown・括弧類禁止。',
    'フレーバー: <40〜70字>',
    '',
    `例 (${rarityLabel} / ${TONE_LABEL[tone]}):`,
    `フレーバー: ${FLAVOR_EXAMPLE[rarity][tone]}`,
  ].join('\n');

  const user = [
    `職業: ${jobDisplayName(result.archetype)}`,
    `能力名: ${abilityName}`,
    `希少度: ${rarityLabel}`,
    `トーン: ${TONE_LABEL[tone]}`,
    '',
    `能力「${abilityName}」に添える 1 文のフレーバーを書いて。`,
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

export function stripWrappers(s: string): string {
  return s
    .replace(/^[「『《【〈"'“”]+/, '')
    .replace(/[」』》】〉"'“”]+$/, '')
    .trim();
}

type HeaderKey = 'name' | 'cost' | 'description' | 'flavor';
const HEADERS: Record<HeaderKey, RegExp> = {
  // 「能力」「アビリティ」単体も name のラベルとして受け付ける (LLM が短縮しがち)。
  name: /^(?:能力名|能力|キーワード|スキル名|アビリティ名|アビリティ|名前)[:\s\uFF1A\u30FB\u3000]*(.*)$/,
  cost: /^(?:コスト|起動コスト|代償|消費)[:\s\uFF1A\u30FB\u3000]*(.*)$/,
  description: /^(?:説明|効果|能力説明|動作|挙動)[:\s\uFF1A\u30FB\u3000]*(.*)$/,
  flavor: /^(?:フレーバー|flavor|情景|詩|口上)[:\s\uFF1A\u30FB\u3000]*(.*)$/i,
};

/** 能力用: name + cost + description の 3 項目を抽出。 */
function parseAbilityOutput(raw: string): { name: string; cost: string; description: string } | null {
  const text = stripMarkdown(raw.replace(/\r\n/g, '\n'));
  const lines = text.split('\n').map((l) => l.trim()).filter((l) => l);
  const out = { name: '', cost: '', description: '' };
  let pending: 'name' | 'cost' | 'description' | null = null;
  for (const line of lines) {
    const lineClean = line.replace(/^[-・*#>\s]+/, '').trim();
    let matched = false;
    for (const key of ['name', 'cost', 'description'] as const) {
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
  // fallback: header 無しなら 3 行並び
  if ((!out.name || !out.description) && lines.length >= 2) {
    const plain = lines.filter((l) =>
      !Object.values(HEADERS).some((rx) => rx.test(l)),
    );
    if (plain.length >= 2) {
      if (!out.name) out.name = stripWrappers(plain[0]!);
      if (plain.length >= 3) {
        if (!out.cost) out.cost = stripWrappers(plain[1]!);
        if (!out.description) out.description = stripWrappers(plain[2]!);
      } else {
        if (!out.description) out.description = stripWrappers(plain[1]!);
      }
    }
  }
  if (!out.name || !out.description) return null;
  if (!out.cost) out.cost = 'なし';
  if (out.name.length < 1 || out.name.length > 20) return null;
  if (out.cost.length > 140) return null;
  if (out.description.length < 6 || out.description.length > 180) return null;
  return out;
}

/** フレーバー用: 1 行だけ抽出。 */
function parseFlavorOutput(raw: string): string | null {
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
  // フォールバック: 最初の header 無し行を採用
  const plain = lines.filter((l) => !Object.values(HEADERS).some((rx) => rx.test(l)));
  if (plain.length > 0) {
    const t = stripWrappers(plain[0]!);
    if (t.length >= 10 && t.length <= 200) return t;
  }
  return null;
}

export class CardTextError extends Error {
  stage: 'load' | 'ability-generate' | 'ability-parse' | 'flavor-generate' | 'flavor-parse';
  raw?: string;
  cause?: unknown;
  constructor(stage: CardTextError['stage'], message: string, opts: { raw?: string; cause?: unknown } = {}) {
    super(message);
    this.name = 'CardTextError';
    this.stage = stage;
    if (opts.raw !== undefined) this.raw = opts.raw;
    if (opts.cause !== undefined) this.cause = opts.cause;
  }
}

async function callLLM(
  gen: ReturnType<typeof getGenerator>,
  system: string,
  user: string,
  timeoutMs: number,
  tag: 'ability' | 'flavor',
): Promise<string> {
  const messages = [
    { role: 'system' as const, content: system },
    { role: 'user' as const, content: user },
  ];
  const fullPromise = gen.generate(messages);
  const raced = await Promise.race([
    fullPromise,
    new Promise<string>((_, rej) => setTimeout(() => rej(new Error(`${tag} LLM timeout (${timeoutMs}ms)`)), timeoutMs)),
  ]);
  console.info(`[card-text/${tag}] raw LLM output:\n` + raced);
  return raced;
}

/** 1 段階 (ability または flavor) を生成 + パース。失敗時は最大 attempts 回リトライ。 */
async function runStageWithRetry<T>(
  tag: 'ability' | 'flavor',
  stageGenerate: CardTextError['stage'],
  stageParse: CardTextError['stage'],
  gen: ReturnType<typeof getGenerator>,
  prompt: { system: string; user: string },
  parse: (raw: string) => T | null,
  timeoutMs: number,
  attempts: number,
): Promise<T> {
  let lastErr: CardTextError | null = null;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    let raw: string;
    try {
      raw = await callLLM(gen, prompt.system, prompt.user, timeoutMs, tag);
    } catch (e) {
      lastErr = new CardTextError(stageGenerate, `${tag} generation failed (attempt ${attempt}/${attempts}): ${(e as Error)?.message ?? e}`, { cause: e });
      console.warn(`[card-text/${tag}] attempt ${attempt}/${attempts} generation failed, retrying`, e);
      continue;
    }
    const parsed = parse(raw);
    if (parsed !== null) return parsed;
    lastErr = new CardTextError(stageParse, `${tag} parse failed (attempt ${attempt}/${attempts}, length=${raw.length})`, { raw });
    console.warn(`[card-text/${tag}] attempt ${attempt}/${attempts} parse failed, raw:\n${raw}`);
  }
  throw lastErr ?? new CardTextError(stageGenerate, `${tag} failed after ${attempts} attempts`);
}

async function generateWithLLM(
  result: DiagnosisResult,
  rarity: Rarity,
  timeoutMs: number,
  tone: Tone,
): Promise<CardText> {
  const gen = getGenerator();
  try {
    await gen.load();
  } catch (e) {
    throw new CardTextError('load', `generator load failed: ${(e as Error)?.message ?? e}`, { cause: e });
  }
  const half = Math.max(15000, Math.floor(timeoutMs / 2));
  const MAX_ATTEMPTS = 3;

  console.info(`[card-text] tone=${tone} (${TONE_LABEL[tone]}), rarity=${rarity}`);

  // 1) 能力 (ルールテキスト)
  const ability = await runStageWithRetry(
    'ability', 'ability-generate', 'ability-parse',
    gen, buildAbilityPrompt(result, rarity, tone), parseAbilityOutput, half, MAX_ATTEMPTS,
  );
  console.info('[card-text/ability] parsed →', ability);

  // 2) フレーバー (詩的 1 行)
  const flavor = await runStageWithRetry(
    'flavor', 'flavor-generate', 'flavor-parse',
    gen, buildFlavorPrompt(result, rarity, ability.name, tone), parseFlavorOutput, half, MAX_ATTEMPTS,
  );
  console.info('[card-text/flavor] parsed →', flavor);

  const source: CardTextSource = { kind: 'llm' };
  const backend = gen.getBackend();
  if (backend) source.backend = backend;
  return {
    effect: { name: ability.name, cost: ability.cost, description: ability.description },
    flavor,
    source,
  };
}

/** effect + flavor を生成 (メイン API)。rarity を必ず渡す。
 *  開発中はエラーを隠さない: LLM 失敗時は CardTextError を投げる (UI 側で表示)。
 *  本番で自動フォールバックが必要になったら呼び出し側で catch → getFallbackCardText。
 *
 *  モバイルは LLM 自体が乗らない (OOM) ので即 hand-crafted fallback。 */
export async function generateCardText(
  result: DiagnosisResult,
  rarity: Rarity,
  opts: { seed?: number; timeoutMs?: number } = {},
): Promise<CardText> {
  if (isLowEndDevice()) {
    return getFallbackCardText(result.archetype, opts.seed ?? Date.now(), rarity);
  }
  const timeoutMs = opts.timeoutMs ?? 60000;
  // 毎回トーンを抽選 (前向き / 観察的 / 皮肉) して単調さを避ける。
  const tone = pickTone(opts.seed);
  return await generateWithLLM(result, rarity, timeoutMs, tone);
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

