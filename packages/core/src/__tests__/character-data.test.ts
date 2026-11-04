/**
 * 人物 ID 化 (D-CHAR-001)。名前は world.characters に 1 か所だけ持ち、文には `{c:<id>}` を書く。
 * 守る不変条件:
 * - 表示の直前に今の名前へ置き換わる (改名 = characters の 1 行を変えるだけ)
 * - 形の壊れた `{c:` は読み込みで弾く。id の有無は保存のときだけ見る (読み込みで全体を落とさない)
 * - トークンの無い今のデータはそのまま通り、見た目も変わらない
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  ADMIN_WORLD_RECORDS, DIALOGUE_SCENE_IDS, MONSTERS, loadAdminWorld, setCharacters, setDialogue, setGameQuests, setNpcs, setScenario,
  validateCharacters, validateDialogue, validateGameQuests, validateNpcs, validateScenario, withCharacterNames, missingCharacterRef,
  characterTokenIds, monsterCombatant, worldRefs, danglingRefs, currentCharacters, type DialogueData, type NpcDef,
} from '../index.js';

const CHARS = [{ id: 'twitter', name: 'Twitter' }, { id: 'bluesky', name: 'Bluesky' }];
const dialogueWith = (text: string): DialogueData => ({ scenes: DIALOGUE_SCENE_IDS.map((id) => ({ id, lines: [{ text: id === 'guild.first' ? text : 'やあ' }] })) });

afterEach(() => { setCharacters(null); setNpcs(null); setGameQuests(null); setScenario(null); setDialogue(null); });

describe('withCharacterNames', () => {
  it('{c:id} を今の名前に置き換え、改名すると表示も変わる', () => {
    setCharacters(CHARS);
    expect(withCharacterNames('ぼくの名は{c:twitter}。{c:bluesky}の兄だ。')).toBe('ぼくの名はTwitter。Blueskyの兄だ。');
    setCharacters([{ id: 'twitter', name: 'あおいとり' }, { id: 'bluesky', name: 'Bluesky' }]);
    expect(withCharacterNames('ぼくの名は{c:twitter}。')).toBe('ぼくの名はあおいとり。');
  });

  it('トークンの無い文はそのまま。知らない id は id をそのまま出す (黙って空にしない)', () => {
    setCharacters(CHARS);
    expect(withCharacterNames('ようこそ {price} の宿へ')).toBe('ようこそ {price} の宿へ');
    expect(withCharacterNames('{c:nobody}が来た')).toBe('nobodyが来た');
  });
});

describe('検証', () => {
  it('characters: id は英小文字・数字・-、名前は 16 字まで、重複は不可', () => {
    expect(() => validateCharacters(CHARS)).not.toThrow();
    expect(() => validateCharacters([{ id: 'Twitter', name: 'x' }])).toThrow();
    expect(() => validateCharacters([{ id: 'a', name: '' }])).toThrow();
    expect(() => validateCharacters([{ id: 'a', name: 'あ'.repeat(17) }])).toThrow();
    expect(() => validateCharacters([{ id: 'a', name: 'x' }, { id: 'a', name: 'y' }])).toThrow();
  });

  it('形の壊れた {c: は NPC・クエスト・シナリオ・会話の読み込みで弾く。正しい形なら id が無くても通す', () => {
    const npc = (line: string, name = '長老'): NpcDef => ({ id: 'n', name, x: 1, y: 1, lines: [line] });
    expect(() => validateNpcs([npc('{c:twitter}だよ', '{c:bluesky}ちゃん')])).not.toThrow();
    expect(() => validateNpcs([npc('{c:Twitter}だよ')])).toThrow(/人物/);
    expect(() => validateNpcs([npc('やあ', '{c:}')])).toThrow(/人物/);
    const quest = (title: string) => ({ id: 'q', title, npcId: 'n', intro: ['{c:x}が来る'], done: ['ok'], objective: { kind: 'talk' as const, npcId: 'n', line: 'やあ' } });
    setNpcs([npc('やあ')]);
    expect(() => validateGameQuests([quest('{c:homura}の はね')])).not.toThrow();
    expect(() => validateGameQuests([quest('{c:bad id}')])).toThrow(/人物/);
    expect(() => validateScenario([{ id: 'e', title: 't', when: [], setFlags: ['f'], notice: '{c:x}が {c:BAD}' }])).toThrow(/人物/);
    expect(() => validateDialogue(dialogueWith('ようこそ、{c:bluesky}のギルドへ'))).not.toThrow();
    expect(() => validateDialogue(dialogueWith('{c:Bad}'))).toThrow();
  });

  it('id の有無は保存のときに見る (missingCharacterRef)', () => {
    expect(characterTokenIds(['{c:twitter}と{c:x}', 'やあ'])).toEqual(['twitter', 'x']);
    expect(missingCharacterRef(['{c:twitter}と{c:x}'], new Set(['twitter']))).toMatch(/x/);
    expect(missingCharacterRef(['{c:twitter}'], new Set(['twitter']))).toBeNull();
  });
});

describe('読み込み・参照・戦闘', () => {
  it('characters は読み込み順の先頭 (どのレコードより先に名前がそろう)', () => {
    expect(ADMIN_WORLD_RECORDS[0]).toBe('characters');
  });

  it('loadAdminWorld で characters が入り、無ければ前の値を保つ', async () => {
    await loadAdminWorld(async (name) => (name === 'characters' ? { characters: CHARS } : null), () => {});
    expect(currentCharacters()).toEqual(CHARS);
    await loadAdminWorld(async () => null, () => {});
    expect(currentCharacters()).toEqual(CHARS);
  });

  it('使われている人物は worldRefs に挙がり、消すと切れる参照になる', () => {
    setCharacters(CHARS);
    setNpcs([{ id: 'n', name: '{c:bluesky}ちゃん', x: 1, y: 1, lines: ['{c:twitter}を知ってる？'] }]);
    const ids = worldRefs('character').map((r) => r.id);
    expect(ids).toEqual(expect.arrayContaining(['bluesky', 'twitter']));
    expect(danglingRefs('character', ['bluesky']).map((r) => r.id)).toEqual(['twitter']);
  });

  it('戦闘の敵の名前も置き換わる (edge が作る「〇〇は…」の文もこの名前を使う)', () => {
    setCharacters([{ id: 'x', name: 'X' }]);
    const c = monsterCombatant({ ...MONSTERS[0]!, name: '{c:x}' }, 0, () => 0);
    expect(c.name).toBe('X');
  });
});
