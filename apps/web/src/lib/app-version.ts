/**
 * アプリの公開バージョン。形式は `YYYY.MM.DD-N` (例 `2026.06.14-1`)。
 * - `YYYY.MM.DD`: 本番 (main) へ反映したリリース日
 * - `-N`: 同日内のリリース枝番。その日最初は `-1`、追加リリースごとに `-2`, `-3` …
 *
 * package.json の `version` は semver 制約 (先頭ゼロ不可・3 セグメント) でこの表記を
 * 表現できないため、表示用バージョンはこのファイルを唯一の出所 (single source) とする。
 *
 * リリース手順 (dev → main):
 *   1. この APP_VERSION を「リリース日 + 枝番」に更新してコミット (feature ブランチで)
 *   2. dev → main の PR をマージ (オーナーのリリース判断)
 *   3. 同じ値で git tag を打つ:
 *        git tag v2026.06.14-1 && git push origin v2026.06.14-1
 */
export const APP_VERSION = '2026.06.19-3';

/** APP_VERSION が `YYYY.MM.DD-N` 形式かを検証する (テスト/CI で形式崩れを検出)。
 *  月 01-12 / 日 01-31 のゼロ詰め 2 桁、枝番は先頭ゼロ不可の 1 以上まで一本でガードする。 */
export const APP_VERSION_PATTERN = /^\d{4}\.(0[1-9]|1[0-2])\.(0[1-9]|[12]\d|3[01])-[1-9]\d*$/;
