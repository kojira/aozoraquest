import { useEffect, useRef, useState } from 'react';
import { partyDefsOf, partyMemberCombatant, partyMemberGear, playerCombatant, recruitById, type AllyMode, type Archetype, type Combatant, type GearSelection, type PartyAlly, type RecruitStar } from '@aozoraquest/core';
import { StatusSheet } from './status-sheet';
import { WhosePicker } from './whose-picker';
import { AllyTacticSelect } from './ally-tactic-select';
import type { ServerParty } from '@/lib/world-server';

/** つよさの主人公 (world.tsx が戦闘に渡すのと同じ combat)。 */
export interface HeroStatus {
  name: string;
  avatarUrl: string | null;
  archetype: Archetype;
  jobLv: number;
  jobXp: number;
  /** 装備込みの実効値 (戦闘に渡すものと同一) */
  combat: Combatant;
  /** 装備なしの素の値 (装備ぶんの内訳表示用) */
  combatBase: Combatant;
  /** フィールドの現在 HP/MP (null = 全快) */
  hp: number | null;
  mp: number | null;
  /** 戦闘で着ている装備 (resolveGear の selection) */
  gear: GearSelection;
}

/** つよさに出す仲間 (パーティの仲間か、ギルドの候補)。xp は仲間が自分の経験値を持つときだけ (D-PARTY-002 §11)。 */
export interface AllyStatusTarget {
  id: string;
  name: string;
  archetype: Archetype;
  star?: RecruitStar | undefined;
  level: number;
  xp?: number | undefined;
  /** 着ている装備 (D-PARTY-004)。戦闘では からだが空なら ぬののふく を着る (partyMemberGear)。 */
  gear?: GearSelection | undefined;
  /** 持ちこしの HP/MP (無い＝全快)。 */
  hp?: number | undefined;
  mp?: number | undefined;
  /** パーティの仲間の きずな (D-PARTY-004)。ギルドの候補には無い。 */
  bond?: number | undefined;
  /** いまの さくせん (無い＝おまかせ)。 */
  mode?: AllyMode | undefined;
}

/** パーティの仲間 1 人を つよさ に出す形に (経験値・きずな・さくせん・持ちこしの HP/MP は party から)。 */
export function partyStatusTarget(a: PartyAlly, party: ServerParty): AllyStatusTarget {
  // 仲間が自分で持っている経験値 (生成の仲間は members、なじみは party.xp)。§11 より前に入れたなじみには無い。
  const xp = party.members?.find((m) => m.id === a.id)?.xp ?? party.xp?.[a.id];
  return { ...a, xp, bond: party.bond?.[a.id] ?? 0, mode: party.mode?.[a.id], hp: party.hp?.[a.id], mp: party.mp?.[a.id] };
}

/** パーティの仲間全員 (入れている順)。jobLevel は経験値の無いなじみの Lv。 */
export function partyStatusTargets(party: ServerParty, jobLevel: number): AllyStatusTarget[] {
  return partyDefsOf(party, recruitById, jobLevel).map((a) => partyStatusTarget(a, party));
}

/**
 * つよさの窓 (#285)。メニューからは主人公＋仲間を「だれの？」(そうびと同じ切りかえ。#1003) で選べる。
 * なかま・ギルドの窓からは、名前を押した仲間を選んだ状態で開く。仲間の値は戦闘と同じ partyMemberCombatant (着ている装備込み)。
 * over: ほかの窓の上に重ねて開く。Escape は先に (capture で) 受けてこの窓だけを閉じ、窓は不透明 (下の一覧を透かさない)。
 */
export function StatusModal({ hero, allies, initial, over = false, onMode, onClose }: {
  hero?: HeroStatus | undefined;
  allies: readonly AllyStatusTarget[];
  /** はじめに出す人 ('hero' か 仲間の id)。無ければ主人公 (主人公がいなければ最初の仲間)。 */
  initial?: string | undefined;
  over?: boolean;
  /** さくせん を変える (♥2 から。パーティの仲間だけ)。 */
  onMode?: ((id: string, mode: AllyMode | null) => Promise<void>) | undefined;
  onClose: () => void;
}) {
  const [who, setWho] = useState(initial ?? (hero ? 'hero' : allies[0]?.id ?? 'hero'));
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeBtnRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (over) e.stopPropagation();
      onClose();
    };
    window.addEventListener('keydown', onKey, over);
    return () => window.removeEventListener('keydown', onKey, over);
  }, [onClose, over]);
  const ally = allies.find((a) => a.id === who);
  const options = [...(hero ? [{ who: 'hero', name: hero.name || 'ぼうけんしゃ' }] : []), ...allies.map((a) => ({ who: a.id, name: a.name }))];
  const whose = hero && allies.length ? { options, current: ally?.id ?? 'hero', onChange: setWho } : undefined;
  return (
    <div role="dialog" aria-modal="true" aria-label={ally ? `${ally.name}の つよさ` : 'つよさ'} onClick={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: over ? 310 : 300, background: 'rgba(0, 0, 0, 0.72)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1em' }}>
      <div className="dq-window" onClick={(e) => e.stopPropagation()}
        style={{ ...(over ? { background: 'var(--color-window-solid)' } : {}), padding: 10, width: 'min(94vw, 420px)', maxHeight: '86svh', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
          <strong style={{ fontSize: '0.95em' }}>つよさ</strong>
          <button ref={closeBtnRef} type="button" onClick={onClose} style={{ fontSize: '0.8em', padding: '0.3em 0.9em' }}>
            とじる
          </button>
        </div>
        <WhosePicker whose={whose} />
        <div style={{ overflowY: 'auto' }}>
          {ally ? <AllySheet key={ally.id} ally={ally} onMode={onMode} /> : hero ? <StatusSheet {...hero} trait /> : null}
        </div>
      </div>
    </div>
  );
}

/** 仲間 1 人の中身。強さは戦闘と同じ partyMemberCombatant、内訳は装備なしの playerCombatant との差。 */
function AllySheet({ ally, onMode }: { ally: AllyStatusTarget; onMode?: ((id: string, mode: AllyMode | null) => Promise<void>) | undefined }) {
  const combat = partyMemberCombatant(ally, ally.level);
  const combatBase = playerCombatant(ally.archetype, ally.level, 1, ally.name);
  const tactic = onMode && ally.bond !== undefined ? <AllyTacticSelect bond={ally.bond} mode={ally.mode} onChange={(m) => onMode(ally.id, m)} /> : undefined;
  return (
    <StatusSheet name={ally.name} archetype={ally.archetype} jobLv={ally.level} jobXp={ally.xp} combat={combat} combatBase={combatBase}
      hp={ally.hp ?? null} mp={ally.mp ?? null} gear={partyMemberGear(ally.gear, ally.level)} trait={false} star={ally.star ?? 1} bond={ally.bond} tactic={tactic} />
  );
}

/** 一覧の名前 (押すと つよさを開く)。見た目は今の太字の名前のまま。 */
export function AllyNameButton({ name, onOpen }: { name: string; onOpen: () => void }) {
  return (
    <button type="button" className="secondary" aria-label={`${name}の つよさ`} onClick={onOpen}
      style={{ border: 'none', boxShadow: 'none', padding: 0, fontWeight: 700, fontSize: '1em', textDecoration: 'underline dotted', textUnderlineOffset: '0.2em', touchAction: 'manipulation' }}>
      {name}
    </button>
  );
}
