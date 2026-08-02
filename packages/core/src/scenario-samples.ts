/**
 * **シナリオのサンプル** (#545)。3 つが順に繋がる最小の筋書き。
 *
 * 「フラグをどう繋ぐか」は文章で説明するより**動くものを 1 つ入れて触る**ほうが早い。
 * エディタの「サンプルを入れる」から差し込み、そのまま保存して遊べる。
 *
 * ## 繋がり方
 *
 * 1. `ch1_start` — 条件なし = 全員が最初から。ものがたりの起点
 * 2. `ch2_herbs`  — 1 の後に **やくそうを 3 つ**持つと発火
 * 3. `ch3_proof`  — 2 の後に **スライムのしずくを 1 つ**持つと発火
 *
 * ## 参照を持たない作りにしてある
 *
 * クエストや NPC を条件にすると、それらが無い環境では**保存できない**
 * (検証が実在を見る)。サンプルは最初から在る素材だけを条件にしてあるので、
 * 何も用意していなくても入る。繋いだ先 (NPC のセリフ・クエストの解禁・ゲートの解錠) は
 * 立ったフラグ名を書くだけで足せる。
 */
import type { ScenarioEvent } from './scenario.js';

export const SAMPLE_SCENARIO: readonly ScenarioEvent[] = [
  {
    id: 'sample-1',
    title: '1. たびだち',
    when: [], // 条件なし = 最初から発火する (導入)
    setFlags: ['ch1_start'],
    notice: 'ふしぎな よかんが した。なにかが はじまろうとしている…',
  },
  {
    id: 'sample-2',
    title: '2. やくそうを あつめる',
    when: [
      { kind: 'flag', flag: 'ch1_start' },
      { kind: 'itemCount', itemId: 'herb', count: 3 },
    ],
    setFlags: ['ch2_herbs'],
    notice: 'やくそうが 3つ そろった。むらの ひとが よろこびそうだ。',
  },
  {
    id: 'sample-3',
    title: '3. まもののあかし',
    when: [
      { kind: 'flag', flag: 'ch2_herbs' },
      { kind: 'itemCount', itemId: 'slime-drop', count: 1 },
    ],
    setFlags: ['ch3_proof'],
    notice: 'スライムのしずくを 手に入れた。これで みとめてもらえるはずだ。',
  },
];

/** サンプルが立てるフラグ (エディタの案内に出す)。 */
export const SAMPLE_FLAGS = ['ch1_start', 'ch2_herbs', 'ch3_proof'] as const;
