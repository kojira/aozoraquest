/**
 * sarashina2.2-0.5b 用の翻訳プロンプトと後処理 (Gemini Nano のプロンプトは translate.ts のまま変えない)。
 *
 * 0.5b は Nano 用の長い指示文だと「（訳：…）」「（口語調で…）」などの説明や引用符を足すため、
 * system 1 行 + few-shot 4 往復 + 本文だけを渡す。生成は最初の改行で止まる (sarashina-llm.ts)。
 * それでも残る「marathon（マラソン）」型の語釈は、ラテン文字を含む括弧書きとして消す。
 */
import type { LLMInput } from './local-llm';

export const SARASHINA_TRANSLATE_SYSTEM =
  '英語の SNS 投稿を、友達口調の自然な日本語に訳す。訳文だけを 1 行で出す。英単語は残さず日本語にする。説明・注釈・括弧書き・引用符は書かない。';

const SHOTS: readonly (readonly [string, string])[] = [
  ['It was such nice weather today, so I went for a walk.', '今日はめっちゃいい天気だったから散歩してきた。'],
  ['Found a new cafe! The latte art is way too cute.', '新しいカフェ見つけた！ラテアートがかわいすぎる。'],
  ["Anyone up for ramen tonight? I'm starving.", '今夜ラーメン行く人いる？お腹ぺこぺこ。'],
  ['My cat knocked my coffee off the desk again. Classic Monday.', 'また猫に机のコーヒー落とされた。いつもの月曜日だね。'],
];

/** 1 段落ぶんの翻訳入力 (few-shot は user / assistant の往復として history に並べる)。 */
export function sarashinaTranslateInput(paragraph: string): LLMInput {
  const history: LLMInput['history'] = [];
  for (const [en, ja] of SHOTS) {
    history.push({ role: 'user', content: en }, { role: 'assistant', content: ja });
  }
  history.push({ role: 'user', content: paragraph });
  return { systemPrompt: SARASHINA_TRANSLATE_SYSTEM, history };
}

/** 出力上限: 英語 1 token ≒ 4 文字、訳は原文の 2 倍まで、最大 200。 */
export function sarashinaMaxNewTokens(paragraph: string): number {
  return Math.min(200, Math.ceil(paragraph.length / 2) + 16);
}

/** 空行で段落に分ける (段落内の改行は既存経路と同じく空白にまとめる)。 */
export function splitParagraphs(body: string): string[] {
  return body.split(/\n\s*\n/).map((p) => p.replace(/\s+/g, ' ').trim()).filter((p) => p !== '');
}

/**
 * 1 段落の出力を整える: 最初の改行までだけ使い、ラテン文字を含む括弧書き (語釈) と
 * 全体を囲む引用符を消す。cleanTranslation / looksLikeJapaneseTranslation は呼び出し側で既存どおり掛ける。
 */
export function cleanSarashinaParagraph(raw: string): string {
  let t = raw.split('\n')[0] ?? '';
  // 入れ子の語釈もあるので内側から消す。閉じずに行末まで続く語釈は括弧から後ろを切る。
  for (let prev = ''; prev !== t;) {
    prev = t;
    t = t.replace(/\s*[（(][^（）()]*[A-Za-z][^（）()]*[）)]/g, '');
  }
  t = t.replace(/\s*[（(][^（）()]*[A-Za-z].*$/, '');
  t = t.trim().replace(/^["“「『](.*)["”」』]$/u, '$1');
  return t.replace(/\s{2,}/g, ' ').trim();
}
