/**
 * admin 編集の prompt 文字列内に `{key}` という placeholder を許可し、
 * 既知の変数を実行時に展開する小さな template engine。
 *
 * 使い方:
 *   applyPromptTemplate('{user} さん、こんにちは', { user: 'kojira' })
 *     → 'kojira さん、こんにちは'
 *
 * 仕様:
 * - キーは英数字 + アンダースコアのみ (日本語キーは未対応)
 * - vars[key] が **string で空文字でない** → その値で置換
 * - vars[key] が undefined / null / 空文字 → **placeholder をそのまま残す**
 *   (admin が typo に気付ける、かつ値未定の状態が UI で見えるため)
 * - 未登録キー → 同じくそのまま残す
 *
 * spiritChat の variables (現状サポート):
 *   {user}      — ユーザのハンドル先頭部分 (例: "kojira.io" → "kojira")
 *   {archetype} — 現在の職業名 (例: "賢者")。診断未実施なら未展開
 *   {level}     — 現職の LV (例: "5")。診断未実施なら未展開
 */

export type PromptVars = Record<string, string | undefined>;

const PLACEHOLDER_RE = /\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g;

export function applyPromptTemplate(body: string, vars: PromptVars): string {
  return body.replace(PLACEHOLDER_RE, (match, key: string) => {
    const v = vars[key];
    if (typeof v === 'string' && v.length > 0) return v;
    return match;
  });
}
