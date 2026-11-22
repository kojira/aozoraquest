// @vitest-environment jsdom
/**
 * つよさ (#285)。メニューからは「だれの？」で主人公と仲間を切りかえる (#1003)。
 * - 仲間がいれば ゆうしゃ＋仲間、いなければ「だれの？」は出ない
 * - 仲間の値は戦闘と同じ partyMemberCombatant (着ている装備・ぬののふく込み)、装備ぶんの内訳つき
 *
 * 仲間の「つよさ」(#893)。メニューの「なかま」・ギルドのパーティ・ギルドの候補で、名前を押すと開く。
 * - 5 つの値は戦闘と同じ partyCombatants (定義と Lv が同じなら同じ数字)
 * - とくぎは skillsForJob(職, Lv)、けいけんちは仲間が自分の経験値を持つときだけ
 * - 候補は入ったときの Lv で見せ、くわえるボタンは そのまま
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { jobXpToNextLevel, partyCombatants, partyMemberCombatant, playerCombatant, skillsForJob, xpForAllyLevel, type NpcDef, type PartyRecruit, type RecruitCandidate } from '@aozoraquest/core';
import { PartyModal } from './party-modal';
import { partyStatusTargets, StatusModal, type HeroStatus } from './status-modal';
import { GuildPartyModal } from './guild-party-modal';
import type { ServerParty } from '@/lib/world-server';

const MIO: PartyRecruit = { id: 'g:2026-11-05:g:0:1', name: 'ミオ', archetype: 'miko', star: 2, minLevel: 5, line: 'ミオです。', xp: xpForAllyLevel('miko', 9) + 3 };
const SORA: RecruitCandidate = { id: 'g:2026-11-05:g:0:2', name: 'ソラ', archetype: 'mage', star: 3, level: 12, minLevel: 12, line: 'ソラです。' };
const GUILD: NpcDef = { id: 'g', name: 'うけつけ', x: 1, y: 1, lines: ['やあ'], guildReception: true };
const STAT_LABELS = [['atk', 'こうげき'], ['def', 'まもり'], ['agi', 'すばやさ'], ['int', 'かしこさ'], ['luk', 'うん']] as const;

afterEach(cleanup);
const detail = (name: string) => screen.getByRole('dialog', { name: `${name}の つよさ` });
/** 「こうげき」などの行の数字 (うしろの「(そうび+N)」は除く)。 */
const statValue = (box: HTMLElement, label: string) => {
  const row = within(box).getByText(label).parentElement!;
  return Number(row.lastElementChild!.firstChild!.textContent);
};
/** 「こうげき」などの行の「(そうび+N)」(無ければ null)。 */
const statNote = (box: HTMLElement, label: string) => within(box).getByText(label).parentElement!.lastElementChild!.children[0]?.textContent ?? null;

const HERO: HeroStatus = (() => {
  const gear = { weapon: { id: 'wp-club', level: 1 } };
  return { name: 'ゆうしゃ', avatarUrl: null, archetype: 'warrior', jobLv: 7, jobXp: 0, combat: playerCombatant('warrior', 7, 1, '', undefined, undefined, gear), combatBase: playerCombatant('warrior', 7, 1, ''), hp: null, mp: null, gear };
})();
const whoRadios = () => within(screen.getByRole('radiogroup', { name: 'だれの？' })).getAllByRole('radio').map((b) => b.textContent);

describe('つよさの「だれの？」(#1003)', () => {
  const party: ServerParty = { ids: [MIO.id], members: [MIO], hp: { [MIO.id]: 7 }, bond: { [MIO.id]: 72 }, gear: { [MIO.id]: { weapon: { id: 'wp-travel-sword', level: 0 }, head: { id: 'hd-leather-hat', level: 0 } } } };

  it('仲間がいれば ゆうしゃ＋仲間。はじめは ゆうしゃ', () => {
    render(<StatusModal hero={HERO} allies={partyStatusTargets(party, 7)} onClose={() => {}} />);
    expect(whoRadios()).toEqual(['▸ ゆうしゃ', 'ミオ']);
    const box = screen.getByRole('dialog', { name: 'つよさ' });
    expect(statValue(box, 'こうげき')).toBe(HERO.combat.atk);
    expect(box.textContent).toContain('こんぼう+1');
  });

  it('仲間を選ぶと、その仲間の値 (着ている装備・ぬののふく込み = partyMemberCombatant) と 装備ぶんの内訳・きずな・とくぎ・そうび', () => {
    render(<StatusModal hero={HERO} allies={partyStatusTargets(party, 7)} onClose={() => {}} />);
    fireEvent.click(screen.getByRole('radio', { name: 'ミオ' }));
    expect(whoRadios()).toEqual(['ゆうしゃ', '▸ ミオ']);
    const box = detail('ミオ');
    const c = partyMemberCombatant({ id: MIO.id, name: MIO.name, archetype: 'miko', level: 9, gear: party.gear![MIO.id] }, 9);
    const bare = playerCombatant('miko', 9, 1, 'ミオ');
    for (const [key, label] of STAT_LABELS) expect(statValue(box, label)).toBe(c[key]);
    expect(c.atk).toBeGreaterThan(bare.atk);
    expect(statNote(box, 'こうげき')).toBe(`(そうび+${c.atk - bare.atk})`);
    expect(statNote(box, 'まもり')).toBe(`(そうび+${c.def - bare.def})`);
    expect(box.textContent).toContain(`7 / ${c.maxHp}`);
    expect(box.textContent).toContain('きずな 72／150');
    expect(box.textContent).toContain(skillsForJob('miko', 9).map((s) => s.name).join('、'));
    for (const name of ['たびのつるぎ', 'かわのぼうし', 'ぬののふく']) expect(box.textContent).toContain(name);
    expect(box.textContent).toContain('Lv 9');
    const next = jobXpToNextLevel(MIO.xp, 'miko');
    expect(box.textContent).toContain(`Lv 10まであと${next.next - next.current}`);
  });

  it('仲間がいなければ「だれの？」は出ない (今と同じ)', () => {
    render(<StatusModal hero={HERO} allies={[]} onClose={() => {}} />);
    expect(screen.queryByRole('radiogroup', { name: 'だれの？' })).toBeNull();
    expect(screen.getByRole('dialog', { name: 'つよさ' }).textContent).toContain('とくせい');
  });
});

describe('AllyStatusModal (#893)', () => {
  it('メニューの「なかま」で名前を押すと、partyCombatants と同じ 5 つの値・とくぎ・つぎの Lv までが出る。Escape は つよさだけを閉じる', async () => {
    const party: ServerParty = { ids: [MIO.id], members: [MIO], hp: { [MIO.id]: 7 } };
    const onClose = vi.fn();
    render(<PartyModal jobLevel={3} load={async () => ({ party, flags: [] })} onClose={onClose} />);
    await act(async () => {});
    fireEvent.click(screen.getByRole('button', { name: 'ミオの つよさ' }));
    const box = detail('ミオ');
    const c = partyCombatants([{ id: MIO.id, name: MIO.name, archetype: 'miko', level: 9 }], 9)[0]!;
    for (const [key, label] of STAT_LABELS) expect(statValue(box, label)).toBe(c[key]);
    expect(box.textContent).toContain('Lv 9');
    expect(box.textContent).toContain(`7 / ${c.maxHp}`);
    expect(box.textContent).toContain(`${c.maxMp} / ${c.maxMp}`);
    const skills = skillsForJob('miko', 9).map((s) => s.name);
    expect(skills.length).toBeGreaterThan(0);
    expect(box.textContent).toContain(skills.join('、'));
    const next = jobXpToNextLevel(MIO.xp, 'miko');
    expect(box.textContent).toContain(`Lv 10まであと${next.next - next.current}`);
    expect(screen.queryByRole('radiogroup', { name: 'だれの？' })).toBeNull();
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'ミオの つよさ' })).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('ギルドの候補は、名前を押すと 入ったときの Lv で開く。けいけんちは出さず、くわえるボタンは そのまま', async () => {
    render(<GuildPartyModal guild={GUILD} jobLevel={6} load={async () => ({ party: { ids: [] }, flags: ['futaba_letter_done'] })} save={vi.fn()}
      candidates={async () => ({ day: '2026-11-05', candidates: [SORA], power: 3, rerollPower: 5 })} reroll={vi.fn()} onClose={vi.fn()} />);
    await act(async () => {});
    fireEvent.click(screen.getByRole('button', { name: 'ソラの つよさ' }));
    const box = detail('ソラ');
    const c = partyCombatants([{ id: SORA.id, name: SORA.name, archetype: 'mage', level: 12 }], 12)[0]!;
    for (const [key, label] of STAT_LABELS) expect(statValue(box, label)).toBe(c[key]);
    expect(box.textContent).toContain('Lv 12');
    expect(within(box).getByLabelText('★3').textContent).toBe('★★★');
    expect(box.textContent).toContain(skillsForJob('mage', 12).map((s) => s.name).join('、'));
    expect(box.textContent).not.toContain('けいけんち');
    fireEvent.click(within(box).getByRole('button', { name: 'とじる' }));
    expect((screen.getByRole('button', { name: 'ソラを パワー600で くわえる' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
