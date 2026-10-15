/**
 * vitest の setupFiles (core / edge / web 共通)。ゲームコードはモンスターを持たないので
 * (D-MONSTER-001)、テストファイルごとに fixture の 20 体を入れてから始める。
 */
import { setMonsterOverrides } from '../../monster-data.js';
import { TEST_MONSTERS } from './monster-fixture.js';

setMonsterOverrides(TEST_MONSTERS);
