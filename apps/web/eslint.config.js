// ESLint (flat config)。目的を絞る: React フックのルール違反を作者時点で静的検出する。
// 2026-07-18 に「早期 return より後の useMemo」で World が React #310 でクラッシュし、
// unit テストも build もすり抜けた。rules-of-hooks があれば commit 時に弾けた。
//
// parser は @babel/eslint-parser を使う (typescript-eslint の parser は TS 7.0.2 と
// 非互換 = typescript-estree が `Cjs` undefined で落ちる)。rules-of-hooks は純粋な
// 構文ルールなので、babel で TS/JSX をパースできれば型情報なしで十分。
import babelParser from '@babel/eslint-parser';
import reactHooks from 'eslint-plugin-react-hooks';

export default [
  {
    files: ['src/**/*.{js,jsx,ts,tsx}'], // .jsx/.js も網羅 (現状 0 件だが将来の漏れ防止)
    ignores: ['**/*.test.ts', '**/*.test.tsx'],
    languageOptions: {
      parser: babelParser,
      parserOptions: {
        requireConfigFile: false,
        sourceType: 'module',
        babelOptions: {
          presets: [
            ['@babel/preset-typescript', { allowDeclareFields: true, isTSX: true, allExtensions: true }],
            ['@babel/preset-react', { runtime: 'automatic' }],
          ],
        },
      },
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      // フックのルール違反 (条件付き/早期 return 後/ループ内) はエラー = CI で落とす
      'react-hooks/rules-of-hooks': 'error',
      // 依存配列の漏れは警告のみ (既存コードに意図的な eslint-disable が多数あるため)
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
];
