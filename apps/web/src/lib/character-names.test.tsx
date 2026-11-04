// @vitest-environment jsdom
/**
 * 人物の名前 {c:id} (D-CHAR-001) は、表示する直前に今の名前へ置き換わる。トークンのまま画面に出る経路を作らない。
 * 会話窓 (NPC・クエスト・お知らせ・会話データ・店主)、クエスト一覧、もちもの、戦闘の名前とひとことを通す。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { MONSTERS, activeMonsters, setMonsterOverrides, setCharacters, setGameQuests, setInteriors, setItemOverrides, setNpcs, activeItems, activeEquipment, type BattleState, type GameQuestDef } from '@aozoraquest/core';
import { DialogueWindow } from '@/components/dialogue-window';
import { InventoryModal } from '@/components/world-item-modals';
import { WorldBattleControls } from '@/components/world-battle-controls';
import { questLogEntries, questTermsLine } from './game-quest';
import { battleResultLines } from './world-battle-result';

const NPC = { id: 'n1', name: '{c:bluesky}ちゃん', x: 1, y: 1, lines: ['やあ'] };
const Q: GameQuestDef = { id: 'q1', title: '{c:homura}の はね', npcId: 'n1', intro: ['{c:twitter}を探して'], done: ['ok'], objective: { kind: 'collect', itemId: 'feather-h', count: 1 }, reward: { itemId: 'feather-h', count: 1 } };
const shownText = () => document.body.textContent ?? '';

beforeEach(() => {
  setCharacters([{ id: 'twitter', name: 'Twitter' }, { id: 'bluesky', name: 'Bluesky' }, { id: 'homura', name: 'ほむら' }, { id: 'x', name: 'X' }]);
  setItemOverrides({ items: [...activeItems(), { id: 'feather-h', name: '{c:homura}の はね', key: true }], equipment: [...activeEquipment()] });
  setNpcs([NPC]);
  setGameQuests([Q]);
});
afterEach(() => { cleanup(); vi.useRealTimers(); setGameQuests(null); setNpcs(null); setItemOverrides(null); setInteriors(null, null); setCharacters(null); });

describe('人物の名前の置き換え (D-CHAR-001)', () => {
  it('会話窓: 話者・本文・選択肢を置き換える', () => {
    vi.useFakeTimers();
    render(<DialogueWindow lines={[{ speaker: '{c:bluesky}ちゃん', text: 'ぼくは{c:twitter}の妹だよ' }]} choices={[{ label: '{c:x}を追う', onSelect: () => {} }]} onDone={() => {}} />);
    act(() => { vi.advanceTimersByTime(10_000); });
    expect(shownText()).toContain('Blueskyちゃん');
    expect(shownText()).toContain('ぼくはTwitterの妹だよ');
    expect(shownText()).toContain('Xを追う');
    expect(shownText()).not.toContain('{c:');
  });

  it('クエスト一覧: 題・依頼主・報酬の品の名前を置き換える', () => {
    const [e] = questLogEntries({ activeQuests: [{ id: 'q1', progress: 0 }], done: [] }, {});
    expect(e!.title).toBe('ほむらの はね');
    expect(e!.giver).toBe('依頼: Blueskyちゃん');
    expect(questTermsLine(Q)).toBe('条件: ほむらの はねを1こ。報酬: ほむらの はね ×1。');
  });

  it('もちもの・戦闘の結果: アイテム名を置き換える', () => {
    render(<InventoryModal materials={{ 'feather-h': 1 }} pieces={[]} onClose={() => {}} />);
    expect(shownText()).toContain('ほむらの はね');
    expect(shownText()).not.toContain('{c:');
    expect(battleResultLines({ xp: 0, drops: ['feather-h'] } as never, 'win', null)).toContain('ほむらの はねを手に入れた！');
  });

  it('戦闘: 登場のひとこと (敵の名前は core の monsterCombatant が置き換え済み)', () => {
    vi.useFakeTimers();
    const prev = activeMonsters().map((m) => ({ ...m }));
    const def = { ...MONSTERS[0]!, id: 'x-rocket', name: '{c:x}', intro: '{c:x}の影が落ちる。', storyOnly: true };
    setMonsterOverrides([...prev, def]);
    try {
      const fighter = { name: 'X', hp: 10, maxHp: 10, mp: 0, maxMp: 0, atk: 1, def: 1, agi: 1, int: 1, luk: 1, vit: 0, guarding: false, parrying: false, charging: false, focus: 0, statuses: [], passives: [] };
      const state = { seed: 1, turn: 0, player: { ...fighter, name: 'ゆうしゃ' }, monster: fighter, monsterId: def.id, playerSkill: { name: 'わざ', kind: 'smash' }, playerSkills: [], outcome: 'ongoing', lastEvents: [] } as unknown as BattleState;
      render(<WorldBattleControls state={state} phase="message" busy={false} showEnemyVitals={false} resultLines={[]} onCommand={() => {}} onAdvance={() => {}} />);
      act(() => { vi.advanceTimersByTime(10_000); });
      expect(shownText()).toContain('Xがあらわれた！　Xの影が落ちる。');
      expect(shownText()).not.toContain('{c:');
    } finally {
      setMonsterOverrides(prev);
    }
  });
});

// 店主のセリフ・会話データ・お知らせ・NPC のセリフは、どれも会話窓 (上の 1 つ目) を通る。
