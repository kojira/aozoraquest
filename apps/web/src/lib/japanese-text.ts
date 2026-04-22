/**
 * 日本語 post の前処理ユーティリティ。
 * scripts/finetune-soft-label.py の preprocess_text / has_japanese / split_long_post を
 * TS に忠実に移植したもの。cognitive 推論時も同じ処理を通す必要がある (学習と一致させる)。
 */

const URL_FULL_RE = /https?:\/\/\S+/gi;
// スキーマなし URL (www.xxx.com, vt.tiktok.com, youtu.be 等)。
// 末尾 TLD は 2-8 字、その後境界 (英数以外)、パス部分も食う。「...」省略末尾も食う。
const URL_NOSCHEME_RE =
  /(?:www\.)?[a-zA-Z0-9][-a-zA-Z0-9]*(?:\.[a-zA-Z0-9][-a-zA-Z0-9]*)*\.[a-zA-Z]{2,8}(?![a-zA-Z0-9])(?:\/[^\s]*)?(?:\.{2,})?/gi;
const ELLIPSIS_TAIL_RE = /\S*\.{3,}/g;
const HASHTAG_RE = /[#＃][\w\u3040-\u30ff\u4e00-\u9fff_ー\-]+/g;
const MENTION_RE = /@[A-Za-z0-9_.\-]+/g;
const MULTI_WS_RE = /\s+/g;
const JP_RE = /[\u3040-\u309f\u30a0-\u30ff\u4e00-\u9fff]/g;

/** URL / hashtag / mention を除去し、空白を圧縮する。学習時と同じ正規化。 */
export function preprocessText(text: string): string {
  if (typeof text !== 'string') return '';
  let t = text.replace(URL_FULL_RE, ' ');
  t = t.replace(URL_NOSCHEME_RE, ' ');
  t = t.replace(ELLIPSIS_TAIL_RE, ' ');
  t = t.replace(HASHTAG_RE, ' ');
  t = t.replace(MENTION_RE, ' ');
  t = t.replace(MULTI_WS_RE, ' ').trim();
  return t;
}

/**
 * 日本語 (ひらがな/カタカナ/漢字) + ASCII 英字の合計に対する日本語比率が minRatio 以上
 * なら true。Ruri は日本語モデルなので英語オンリーの post は除外する。
 */
export function hasJapanese(text: string, minRatio = 0.5): boolean {
  if (!text) return false;
  const jp = (text.match(JP_RE) ?? []).length;
  let ascii = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if ((c >= 65 && c <= 90) || (c >= 97 && c <= 122)) ascii++;
  }
  const denom = jp + ascii;
  if (denom === 0) return false;
  return jp / denom >= minRatio;
}

// 文分割デリミタは「。！？」と半角「!?」のみ (半角「.」は URL 残骸や略語を誤爆するので使わない)。
const SPLIT_DELIMS = new Set<string>(['。', '！', '？', '!', '?']);
const BRACKET_OPEN = new Set<string>(['「', '『', '(', '（', '【', '《', '〈', '[', '{', '"', '"']);
const BRACKET_CLOSE = new Set<string>(['」', '』', ')', '）', '】', '》', '〉', ']', '}', '"', '"']);

/**
 * 長文 post を括弧外の「。！？!?」で分割。
 * - 改行では分割しない (思考の流れを保持)
 * - 半角「.」は分割しない (URL 残骸/略語誤爆を回避)
 * - 鍵括弧「」『』等の内側では分割しない (セリフ/引用の分断を回避)
 * - デリミタは前文の末尾に残す (「。」を保持)
 *
 * threshold 字未満なら元文のみを返す。日本語を主に含まない post は分割しない。
 *
 * 返り値 pieces[0] = 元文、pieces[1..] = 分割断片 (minPiece 字以上のみ)。
 * 推論時は各 piece を個別に softmax → 平均を取る。
 */
export function splitLongPost(text: string, threshold = 120, minPiece = 15): string[] {
  const t = text.trim();
  if (t.length < threshold) return [t];
  if (!hasJapanese(t)) return [t];

  const parts: string[] = [];
  let buf = '';
  let depth = 0;
  for (const ch of t) {
    buf += ch;
    if (BRACKET_OPEN.has(ch)) depth++;
    else if (BRACKET_CLOSE.has(ch)) depth = Math.max(0, depth - 1);
    else if (depth === 0 && SPLIT_DELIMS.has(ch)) {
      parts.push(buf.trim());
      buf = '';
    }
  }
  if (buf.trim()) parts.push(buf.trim());

  const pieces: string[] = [t];
  for (const p of parts) {
    if (p.length >= minPiece && p !== t) pieces.push(p);
  }
  return pieces;
}
