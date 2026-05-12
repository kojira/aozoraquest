/**
 * TinySwallow 指示追従性ベンチで使う 50 件のテスト定義 + 補助 util。
 * Node 版 (scripts/bench-tinyswallow-instruction-following.mjs) と
 * HTML 版 (docs/bench/tinyswallow-instruction-following.html) で共有する。
 *
 * ※ 純粋 JS。Node 専用 API (fs / path) も DOM API も使わないこと。
 *    両環境で動かすため「`type=module` で読める」ことが要件。
 */

// ── 共通 helper ──────────────────────────────────

export const countMatches = (s, re) => (s.match(re) ?? []).length;

export const countSentences = (s) =>
  s.split(/[。！？!?]/).map((x) => x.trim()).filter((x) => x.length > 0).length;

export const ONLY_HIRAGANA = /^[\u3040-\u309fー、。！？!?\s]*$/;
export const ONLY_KATAKANA = /^[\u30a0-\u30ffー、。！？!?\s]*$/;
export const HAS_KANJI = /[\u4e00-\u9fff]/;
export const HAS_DIGITS = /[0-9０-９]/;
export const HAS_ALPHA = /[a-zA-Z]/;
export const HAS_NEWLINE = /\n/;

/** 開始/終了判定用に外側の引用符を剥がす。
 *  モデルが応答を「...」「『...』」"..." 等で囲む癖がある (instruction 内の
 *  括弧を literal に解釈してしまう) ため、開始・終了の比較ではこれらを除去
 *  してから判定する。文字数・含む等の判定では使わない。 */
export const unquote = (s) =>
  s.trim()
    .replace(/^[「『（(\[【〔《\u201c\u201d"']+/, '')
    .replace(/[」』）)\]】〕》\u201c\u201d"']+$/, '');

// ── ユーザ質問プール ──────────────────────────────

const Q1 = '今日の天気は？';
const Q2 = 'おはよう。';
const Q3 = '元気?';
const Q4 = '何してる?';
const Q5 = '好きな食べ物は?';

// ── 50 件のテスト ─────────────────────────────────

export const TESTS = [
  // 文字数 (8)
  { instruction: '10 字以内で答えてください。', q: Q3, check: (t) => ({ pass: t.length <= 10, reason: `len=${t.length}` }) },
  { instruction: '20 字以内で答えてください。', q: Q1, check: (t) => ({ pass: t.length <= 20, reason: `len=${t.length}` }) },
  { instruction: '30 字以内で答えてください。', q: Q1, check: (t) => ({ pass: t.length <= 30, reason: `len=${t.length}` }) },
  { instruction: '50 字以内で答えてください。', q: Q5, check: (t) => ({ pass: t.length <= 50, reason: `len=${t.length}` }) },
  { instruction: '5 字ちょうどで答えてください。', q: Q3, check: (t) => ({ pass: t.length === 5, reason: `len=${t.length}` }) },
  { instruction: '15 字ちょうどで答えてください。', q: Q4, check: (t) => ({ pass: t.length === 15, reason: `len=${t.length}` }) },
  { instruction: '長くても 100 字以内で。', q: Q1, check: (t) => ({ pass: t.length <= 100, reason: `len=${t.length}` }) },
  { instruction: '40 字以内で短く。', q: Q5, check: (t) => ({ pass: t.length <= 40, reason: `len=${t.length}` }) },

  // 文数 (4)
  { instruction: '1 文だけで答えてください。', q: Q1, check: (t) => { const n = countSentences(t); return { pass: n === 1, reason: `sentences=${n}` }; } },
  { instruction: '2 文で答えてください。', q: Q5, check: (t) => { const n = countSentences(t); return { pass: n === 2, reason: `sentences=${n}` }; } },
  { instruction: '3 文ちょうどで答えてください。', q: Q4, check: (t) => { const n = countSentences(t); return { pass: n === 3, reason: `sentences=${n}` }; } },
  { instruction: '1 文以内で簡潔に。', q: Q3, check: (t) => { const n = countSentences(t); return { pass: n <= 1, reason: `sentences=${n}` }; } },

  // 開始 (5) — unquote で外側引用符を剥がして判定
  { instruction: '「はい、」で始めてください。', q: Q3, check: (t) => { const u = unquote(t); return { pass: u.startsWith('はい、'), reason: `start="${u.slice(0, 6)}"` }; } },
  { instruction: '「いいえ、」で始めてください。', q: Q3, check: (t) => { const u = unquote(t); return { pass: u.startsWith('いいえ、'), reason: `start="${u.slice(0, 6)}"` }; } },
  { instruction: '「そうだね」で始めてください。', q: Q4, check: (t) => { const u = unquote(t); return { pass: u.startsWith('そうだね'), reason: `start="${u.slice(0, 6)}"` }; } },
  { instruction: '「えっと」で始めてください。', q: Q5, check: (t) => { const u = unquote(t); return { pass: u.startsWith('えっと'), reason: `start="${u.slice(0, 4)}"` }; } },
  { instruction: '「うん、」で始めてください。', q: Q2, check: (t) => { const u = unquote(t); return { pass: u.startsWith('うん、'), reason: `start="${u.slice(0, 4)}"` }; } },

  // 終了 (5)
  { instruction: '「。」で終えてください。', q: Q1, check: (t) => { const u = unquote(t); return { pass: /。\s*$/.test(u), reason: `end="${u.slice(-3)}"` }; } },
  { instruction: '「！」で終えてください。', q: Q5, check: (t) => { const u = unquote(t); return { pass: /[！!]\s*$/.test(u), reason: `end="${u.slice(-3)}"` }; } },
  { instruction: '「？」で終えてください。', q: Q4, check: (t) => { const u = unquote(t); return { pass: /[？?]\s*$/.test(u), reason: `end="${u.slice(-3)}"` }; } },
  { instruction: '「ね。」で終えてください。', q: Q1, check: (t) => { const u = unquote(t); return { pass: /ね。\s*$/.test(u), reason: `end="${u.slice(-3)}"` }; } },
  { instruction: '「よ。」で終えてください。', q: Q3, check: (t) => { const u = unquote(t); return { pass: /よ。\s*$/.test(u), reason: `end="${u.slice(-3)}"` }; } },

  // 含む (8)
  { instruction: '答えに「青空」を含めてください。', q: Q1, check: (t) => ({ pass: t.includes('青空'), reason: t.includes('青空') ? '' : '青空 not found' }) },
  { instruction: '答えに「風」を含めてください。', q: Q1, check: (t) => ({ pass: t.includes('風'), reason: t.includes('風') ? '' : '風 not found' }) },
  { instruction: '答えに「猫」を含めてください。', q: Q5, check: (t) => ({ pass: t.includes('猫'), reason: t.includes('猫') ? '' : '猫 not found' }) },
  { instruction: '答えに「銀河」を含めてください。', q: Q4, check: (t) => ({ pass: t.includes('銀河'), reason: t.includes('銀河') ? '' : '銀河 not found' }) },
  { instruction: '数字「7」を含めてください。', q: Q1, check: (t) => ({ pass: t.includes('7'), reason: t.includes('7') ? '' : '7 not found' }) },
  { instruction: '「!」を 3 個ちょうど含めてください。', q: Q5, check: (t) => { const n = countMatches(t, /[！!]/g); return { pass: n === 3, reason: `count=${n}` }; } },
  { instruction: '「、」を 2 個ちょうど含めてください。', q: Q4, check: (t) => { const n = countMatches(t, /、/g); return { pass: n === 2, reason: `count=${n}` }; } },
  { instruction: '答えのどこかに「ありがとう」を含めて。', q: Q3, check: (t) => ({ pass: t.includes('ありがとう'), reason: t.includes('ありがとう') ? '' : 'not found' }) },

  // 除外 (8)
  { instruction: '改行を使わずに 1 行で答えて。', q: Q5, check: (t) => ({ pass: !HAS_NEWLINE.test(t), reason: HAS_NEWLINE.test(t) ? 'has \\n' : '' }) },
  { instruction: '数字を一切使わずに答えて。', q: Q1, check: (t) => ({ pass: !HAS_DIGITS.test(t), reason: HAS_DIGITS.test(t) ? 'has digit' : '' }) },
  { instruction: '英字 (アルファベット) を使わずに。', q: Q5, check: (t) => ({ pass: !HAS_ALPHA.test(t), reason: HAS_ALPHA.test(t) ? 'has alpha' : '' }) },
  { instruction: '絵文字を使わずに答えて。', q: Q4, check: (t) => { const has = /\p{Extended_Pictographic}/u.test(t); return { pass: !has, reason: has ? 'has emoji' : '' }; } },
  { instruction: '「私」という文字を使わずに。', q: Q4, check: (t) => ({ pass: !t.includes('私'), reason: t.includes('私') ? 'has 私' : '' }) },
  { instruction: '「は」という文字を使わずに。', q: Q5, check: (t) => ({ pass: !t.includes('は'), reason: t.includes('は') ? 'has は' : '' }) },
  { instruction: '感嘆符 (! / ！) を使わないで。', q: Q5, check: (t) => ({ pass: !/[!！]/.test(t), reason: /[!！]/.test(t) ? 'has !' : '' }) },
  { instruction: 'カタカナを使わないで。', q: Q5, check: (t) => { const has = /[\u30a0-\u30ff]/.test(t); return { pass: !has, reason: has ? 'has カタカナ' : '' }; } },

  // スクリプト (4)
  { instruction: '答えを全てひらがなで。漢字・カタカナ・英字を使わない。', q: Q3, check: (t) => ({ pass: ONLY_HIRAGANA.test(t.trim()), reason: ONLY_HIRAGANA.test(t.trim()) ? '' : 'not all hiragana' }) },
  { instruction: '答えを全てカタカナで。', q: Q3, check: (t) => ({ pass: ONLY_KATAKANA.test(t.trim()), reason: ONLY_KATAKANA.test(t.trim()) ? '' : 'not all katakana' }) },
  { instruction: '漢字を 1 個も使わずに答えて。', q: Q4, check: (t) => ({ pass: !HAS_KANJI.test(t), reason: HAS_KANJI.test(t) ? 'has kanji' : '' }) },
  { instruction: '漢字を 3 個以上含めて答えて。', q: Q1, check: (t) => { const n = countMatches(t, /[\u4e00-\u9fff]/g); return { pass: n >= 3, reason: `kanji=${n}` }; } },

  // 形式 (4)
  { instruction: '箇条書きで 3 項目に分けて。各行を「・」で始める。', q: Q5, check: (t) => { const lines = t.split('\n').filter((l) => l.trim().startsWith('・')); return { pass: lines.length === 3, reason: `bullets=${lines.length}` }; } },
  { instruction: '番号付きリストで 3 項目。「1.」「2.」「3.」を含む。', q: Q5, check: (t) => ({ pass: /1\./.test(t) && /2\./.test(t) && /3\./.test(t), reason: 'numbered list missing' }) },
  { instruction: '改行で区切って 4 行で答えて。', q: Q5, check: (t) => { const lines = t.split('\n').filter((l) => l.trim().length > 0); return { pass: lines.length === 4, reason: `lines=${lines.length}` }; } },
  { instruction: '答えを括弧 () で囲んで。', q: Q3, check: (t) => { const tt = t.trim(); return { pass: (tt.startsWith('(') || tt.startsWith('(')) && (tt.endsWith(')') || tt.endsWith(')')), reason: 'no enclosing paren' }; } },

  // 口調 (4)
  { instruction: '敬語 (です・ます) で答えて。', q: Q1, check: (t) => ({ pass: /です|ます/.test(t), reason: /です|ます/.test(t) ? '' : 'no です/ます' }) },
  { instruction: 'タメ口で答えて。「です」「ます」は使わない。', q: Q1, check: (t) => ({ pass: !/です|ます/.test(t), reason: /です|ます/.test(t) ? 'has です/ます' : '' }) },
  { instruction: '質問形 (?で終わる文) で答えて。', q: Q1, check: (t) => ({ pass: /[?？]\s*$/.test(t.trim()), reason: 'not a question' }) },
  { instruction: '体言止め (動詞・助動詞で終わらない) で。', q: Q5, check: (t) => { const trimmed = t.trim().replace(/[。、！？!?\s]+$/, ''); const last = trimmed.slice(-1); return { pass: !/[るたいだねよか]/.test(last), reason: `last="${last}"` }; } },
];

if (TESTS.length !== 50) {
  // throw して early に気付かせる (無音で 49 件で動くより)
  throw new Error(`TESTS.length must be 50, got ${TESTS.length}`);
}

/** LLM 出力の特殊トークンや role prefix を除去する共通クリーナ。 */
export function cleanOutput(s) {
  return String(s)
    .replace(/^<\|.*?\|>/g, '')
    .replace(/<\|.*?\|>$/g, '')
    .replace(/^(assistant|system):\s*/i, '')
    .trim();
}
