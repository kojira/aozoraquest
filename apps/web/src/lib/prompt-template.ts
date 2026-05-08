/**
 * admin 編集の prompt 文字列内に `{key}` という placeholder を許可し、
 * 既知の変数を実行時に展開する小さな template engine。
 *
 * 使い方:
 *   applyPromptTemplate('{user} さん、こんにちは', { user: 'kojira' })
 *     → 'kojira さん、こんにちは'
 *
 * - 未知の `{foo}` はそのまま残す (admin が typo に気付けるように消さない)
 * - キーは英数字 + アンダースコアのみ。日本語キーは未対応
 * - 値が空文字の場合は空文字で置換 (= 削除と同じ効果)
 *
 * spiritChat の variables (現状サポート):
 *   {user}      — ユーザのハンドル先頭部分 (例: "kojira.io" → "kojira")
 *   {archetype} — 現在の職業名 (例: "賢者")。診断未実施なら空文字
 *   {level}     — 現職の LV (例: "5")。診断未実施なら空文字
 */

export type PromptVars = Record<string, string>;

const PLACEHOLDER_RE = /\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g;

export function applyPromptTemplate(body: string, vars: PromptVars): string {
  return body.replace(PLACEHOLDER_RE, (match, key: string) => {
    if (key in vars) return vars[key] ?? '';
    return match;
  });
}
