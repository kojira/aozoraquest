/**
 * 投稿の日本語翻訳 (TinySwallow 使用)。
 *
 * - `shouldAutoTranslate(text)`: 自動翻訳の対象か (日本語比率が低く、かつ空でない)
 * - `translateToJapanese(uri, text)`: キャッシュ → 直列キュー → LLM → キャッシュ保存
 * - `useTranslation(uri, text)`: React フック。設定が ON なら自動で翻訳開始、
 *   OFF なら `triggerTranslate()` 手動呼び出しで開始。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { getGenerator } from './generator';
import { hasJapanese, preprocessText } from './japanese-text';
import { loadCachedTranslation, saveCachedTranslation } from './translation-idb';
import { getAutoTranslate } from './prefs';
import { isLowEndDevice } from './device';
import { stripMarkdown, stripWrappers } from './flavor-text';

const MIN_TEXT_LEN = 10; // これ未満は翻訳しない (挨拶・絵文字のみなど)
const TIMEOUT_MS = 60_000;

/**
 * 翻訳対象かどうかを判定。
 * 1) post.record.langs が明示されていればそれを最優先で信頼する
 *    (投稿者本人 or クライアントがタグ付けしたもの)。'ja' が含まれていれば対象外。
 * 2) langs が空 / 未指定のときのみ、本文のヒューリスティック (日本語比率) で判定。
 */
export function shouldAutoTranslate(text: string, langs?: string[] | undefined): boolean {
  const stripped = preprocessText(text).trim();
  if (stripped.length < MIN_TEXT_LEN) return false;
  if (langs && langs.length > 0) {
    const norm = langs.map((l) => l.toLowerCase().split(/[-_]/)[0] ?? '');
    if (norm.includes('ja')) return false;
    return true;
  }
  return !hasJapanese(stripped, 0.2);
}

// ── 直列キュー ──
// TinySwallow worker は 1 本しか捌けないので、複数の翻訳要求は並列に投げず
// 順番に処理する。Promise チェーンで素朴に直列化。
let chain: Promise<unknown> = Promise.resolve();
function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(
    () => fn(),
    () => fn(),
  );
  chain = run;
  return run;
}

/**
 * 元テキストから翻訳対象の本文と、末尾に付け戻す要素 (URL / ハッシュタグ / メンション) を分離する。
 * LLM には本文だけを渡し、訳文の末尾にそのまま連結する。
 */
function splitTranslatableText(text: string): { body: string; trailing: string } {
  // 登場順を保ったまま収集する。正規表現は japanese-text.ts とほぼ同じだが独立。
  const patterns: RegExp[] = [
    /https?:\/\/\S+/gi,
    /(?:www\.)?[a-zA-Z0-9][-a-zA-Z0-9]*(?:\.[a-zA-Z0-9][-a-zA-Z0-9]*)*\.[a-zA-Z]{2,8}(?![a-zA-Z0-9])(?:\/[^\s]*)?/gi,
    /[#＃][\w\u3040-\u30ff\u4e00-\u9fff_ー\-]+/g,
    /@[A-Za-z0-9_.\-]+/g,
  ];
  const hits: { start: number; end: number; text: string }[] = [];
  for (const re of patterns) {
    for (const m of text.matchAll(re)) {
      if (m.index === undefined) continue;
      hits.push({ start: m.index, end: m.index + m[0].length, text: m[0] });
    }
  }
  if (hits.length === 0) return { body: text.trim(), trailing: '' };
  hits.sort((a, b) => a.start - b.start);
  // 重複 / 入れ子を除去
  const merged: { start: number; end: number; text: string }[] = [];
  for (const h of hits) {
    const last = merged[merged.length - 1];
    if (last && h.start < last.end) {
      if (h.end > last.end) last.end = h.end;
      continue;
    }
    merged.push({ ...h });
  }
  // body: merged の範囲をスペースで除去
  let body = '';
  let cursor = 0;
  for (const m of merged) {
    body += text.slice(cursor, m.start);
    body += ' ';
    cursor = m.end;
  }
  body += text.slice(cursor);
  body = body.replace(/\s+/g, ' ').trim();
  // trailing: 登場順に、スペース区切りで連結 (重複は残す: 元の投稿に合わせる)
  const trailing = merged.map((m) => text.slice(m.start, m.end)).join(' ').trim();
  return { body, trailing };
}

async function runLLM(text: string, langs?: string[] | undefined): Promise<string> {
  const { body, trailing } = splitTranslatableText(text);
  if (!body) return trailing; // 本文なし → リンク等だけ返す
  const gen = getGenerator();
  await gen.load();
  const sourceHint = langs && langs.length > 0 ? `原文の言語: ${langs.join(', ')}。\n` : '';
  // LLM は入力末尾に最も注目するため、「指示を前に、原文を末尾に」の順で
  // 1 つの user メッセージに詰める。短文でも原文が埋もれにくい。
  const userPrompt = [
    'あなたはこれから SNS 投稿を日本語に翻訳します。次のルールを守ること:',
    '- 必ず日本語にする。原文の言語 (英語など) のまま出力してはいけない。',
    '- **口語・カジュアルな日本語** (「〜だよ」「〜なんだ」「〜じゃん」など) で、',
    '  友達に話しかけるような自然な調子にする。',
    '- 敬語・ですます調・硬い書き言葉・直訳調は避ける。',
    '- 出力は訳文のみの 1 段落。引用符・前置き・注釈は禁止。',
    sourceHint.trim() ? sourceHint.trim() : '',
    '',
    '以下が原文です。これを日本語に翻訳してください:',
    '---',
    body,
    '---',
  ].filter((l) => l !== '').join('\n');
  const messages = [
    { role: 'system' as const, content: 'あなたは SNS 投稿を日本語に翻訳する翻訳者です。' },
    { role: 'user' as const, content: userPrompt },
  ];
  const raw = await Promise.race([
    gen.generate(messages),
    new Promise<string>((_, rej) =>
      setTimeout(() => rej(new Error(`translate LLM timeout (${TIMEOUT_MS}ms)`)), TIMEOUT_MS),
    ),
  ]);
  const cleaned = cleanTranslation(raw);
  return trailing ? `${cleaned}\n${trailing}` : cleaned;
}

function cleanTranslation(raw: string): string {
  let t = stripMarkdown(raw).replace(/\r\n/g, '\n').trim();
  // LLM が「以下、翻訳です:」みたいな前置きを付けるケースを救済
  const preface = t.match(/^(翻訳|以下|訳文)[^\n]*?[:：]\s*/);
  if (preface) t = t.slice(preface[0].length);
  // 改行で分かれているが意味的に 1 段落なら連結。段落が複数なら保持。
  if (!/\n\s*\n/.test(t)) t = t.replace(/\n+/g, ' ');
  return stripWrappers(t);
}

export async function translateToJapanese(
  uri: string,
  text: string,
  langs?: string[] | undefined,
  opts: { force?: boolean } = {},
): Promise<string> {
  if (!opts.force) {
    const cached = await loadCachedTranslation(uri);
    if (cached) return cached;
  }
  const result = await enqueue(() => runLLM(text, langs));
  await saveCachedTranslation(uri, result);
  return result;
}

// ── React フック ──
export type TranslationState = 'idle' | 'loading' | 'done' | 'error';

export interface UseTranslationResult {
  state: TranslationState;
  translated: string | undefined;
  error: string | undefined;
  /** 自動翻訳 OFF の時に手動で翻訳を開始するためのトリガ */
  triggerTranslate: () => void;
  /** キャッシュを無視して再翻訳 (プロンプト改善後のキャッシュ起因ズレの救済) */
  retranslate: () => void;
  /** 自動翻訳の対象か (= 非日本語と判定されたか)。UI でボタン表示可否に使う */
  isNonJapanese: boolean;
}

export function useTranslation(
  uri: string | undefined,
  text: string,
  langs?: string[] | undefined,
): UseTranslationResult {
  const [state, setState] = useState<TranslationState>('idle');
  const [translated, setTranslated] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const startedRef = useRef(false);

  // モバイルは TinySwallow をロードした時点でクラッシュするので、翻訳機能
  // (自動・手動問わず) を完全に無効化する。isNonJapanese=false にして UI も
  // 一切出さない。
  const isNonJapanese = !isLowEndDevice() && shouldAutoTranslate(text, langs);
  const canTranslate = Boolean(uri) && isNonJapanese;

  const run = useCallback((force: boolean) => {
    if (!uri || !isNonJapanese) return;
    if (!force && startedRef.current) return;
    startedRef.current = true;
    setState('loading');
    setError(undefined);
    (async () => {
      try {
        const out = await translateToJapanese(uri, text, langs, { force });
        setTranslated(out);
        setState('done');
      } catch (e) {
        console.warn('[translate] failed', e);
        setError(String((e as Error)?.message ?? e));
        setState('error');
      }
    })();
  }, [uri, text, langs, isNonJapanese]);

  const start = useCallback(() => run(false), [run]);
  const retranslate = useCallback(() => run(true), [run]);

  // 自動翻訳が有効なら即時開始。
  // モバイル (iOS / Android) では TinySwallow (1.5B) をロードすると
  // メモリ上限を超えて他機能まで巻き込みクラッシュするので、設定値に
  // 関わらず強制 OFF。手動ボタンも押せないようにする。
  useEffect(() => {
    if (!canTranslate) return;
    if (isLowEndDevice()) return;
    if (!getAutoTranslate()) return;
    start();
  }, [canTranslate, start]);

  // uri が変わった時は state をリセット (同じコンポーネントが別投稿に使い回される場合)
  useEffect(() => {
    startedRef.current = false;
    setState('idle');
    setTranslated(undefined);
    setError(undefined);
  }, [uri]);

  return { state, translated, error, triggerTranslate: start, retranslate, isNonJapanese: canTranslate };
}
