import { useCallback, useEffect, useState } from 'react';
import { type AllyMode, bondHearts, jobDisplayName, partyCombatants, partyDefsOf, recruitById, type NpcDef, type PartyAlly } from '@aozoraquest/core';
import { ModalShell } from './world-item-modals';
import type { ServerParty, ServerPartyCandidates } from '@/lib/world-server';
import { GuildPartyModal } from './guild-party-modal';
import { AllyNameButton, AllyStatusModal } from './ally-status-modal';
import { heartsText } from '@/lib/bond-view';

/** さくせん を変える (サーバーへ送り、world の party を更新する。D-PARTY-004)。 */
export type PartyModeSave = (id: string, mode: AllyMode | null) => Promise<void>;

/** パーティの読み込み (権威 state の party と flags)。 */
export type PartyLoad = () => Promise<{ party: ServerParty; flags: string[] }>;

const muted = { color: 'var(--color-muted)' };

/** ★の表示 (★1〜3)。 */
export const starText = (star: number | undefined) => '★'.repeat(Math.max(1, Math.min(3, star ?? 1)));

/** 仲間 1 人ぶんの表示値 (職・★・Lv・HP/MP)。Lv は仲間の経験値から (D-PARTY-002)、HP/MP は持ちこし (値が無ければ全快)。 */
export function partyMemberView(a: PartyAlly, party: ServerParty) {
  const c = partyCombatants([a], a.level)[0]!;
  return { name: a.name, job: jobDisplayName(a.archetype), star: starText(a.star), level: a.level, hp: party.hp?.[a.id] ?? c.maxHp, maxHp: c.maxHp, mp: party.mp?.[a.id] ?? c.maxMp, maxMp: c.maxMp };
}

/** 仲間の一覧 (名前・職・★・Lv・HP/MP)。名前を押すと つよさ。right はギルドの「はずす」など行ごとの操作。jobLevel は経験値の無いなじみの Lv。 */
export function PartyMemberList({ party, jobLevel, right, onMode }: { party: ServerParty; jobLevel: number; right?: (a: PartyAlly) => React.ReactNode; onMode?: PartyModeSave | undefined }) {
  const [viewing, setViewing] = useState<PartyAlly | null>(null);
  const closeView = useCallback(() => setViewing(null), []);
  const members = partyDefsOf(party, recruitById, jobLevel);
  if (members.length === 0) return <p style={{ fontSize: '0.82em', ...muted, margin: '0.2em 0' }}>まだ だれも いない</p>;
  return (
    <>
      {members.map((r) => {
        const v = partyMemberView(r, party);
        return (
          <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5em', padding: '0.35em 0.4em', margin: '0 0 4px', fontSize: '0.85em', opacity: v.hp <= 0 ? 0.5 : 1 }}>
            <span style={{ flex: '1 1 auto', minWidth: 0 }}>
              <AllyNameButton name={v.name} onOpen={() => setViewing(r)} /> <span style={muted}>{v.job} Lv{v.level}</span> <span aria-label={`★${v.star.length}`} style={{ color: '#f5c542' }}>{v.star}</span> <span aria-label={`きずな ♥${bondHearts(party.bond?.[r.id])}`} style={{ color: '#e8667a' }}>{heartsText(party.bond?.[r.id])}</span>
              <span style={{ display: 'block', fontFamily: 'ui-monospace, monospace', fontSize: '0.9em' }}>HP {v.hp}/{v.maxHp}　MP {v.mp}/{v.maxMp}</span>
            </span>
            {right?.(r)}
          </div>
        );
      })}
      {viewing && <AllyStatusModal ally={{ ...viewing, xp: ownXp(viewing, party), bond: party.bond?.[viewing.id] ?? 0, mode: party.mode?.[viewing.id] }} hp={party.hp?.[viewing.id]} mp={party.mp?.[viewing.id]} onClose={closeView}
        {...(onMode ? { onMode: (m: AllyMode | null) => onMode(viewing.id, m) } : {})} />}
    </>
  );
}

/** 仲間が自分で持っている経験値 (生成の仲間は members、なじみは party.xp)。§11 より前に入れたなじみには無い。 */
const ownXp = (a: PartyAlly, party: ServerParty) => party.members?.find((m) => m.id === a.id)?.xp ?? party.xp?.[a.id];

/** メニューの「なかま」: 一覧だけ (外すのはギルドで)。 */
export function PartyModal({ jobLevel, load, onClose, onMode }: { jobLevel: number; load: PartyLoad; onClose: () => void; onMode?: PartyModeSave | undefined }) {
  const [party, setParty] = useState<ServerParty | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let live = true;
    load().then((r) => live && setParty(r.party), () => live && setError(true));
    return () => { live = false; };
  }, [load]);
  return (
    <ModalShell title="なかま" onClose={onClose}>
      {party ? <PartyMemberList party={party} jobLevel={jobLevel} {...(onMode ? { onMode: async (id: string, m: AllyMode | null) => { await onMode(id, m); setParty((p) => (p ? { ...p, mode: { ...Object.fromEntries(Object.entries(p.mode ?? {}).filter(([k]) => k !== id)), ...(m ? { [id]: m } : {}) } } : p)); } } : {})} /> : <p style={{ fontSize: '0.82em', ...muted }}>{error ? '読み込めなかった…' : 'よみこみちゅう…'}</p>}
      <p style={{ fontSize: '0.72em', ...muted, margin: '0.4em 0 0' }}>入れる・外すのは 冒険者ギルドで できます。</p>
    </ModalShell>
  );
}

/**
 * world.tsx から開くパーティの窓 (D-PARTY-001)。ギルドの編成 (npcTalk.guild === 'party') とメニューの「なかま」。
 * world.tsx の行数を増やさないため、開く条件と閉じたあとの戻り先をここに置く。
 */
export function PartyModals({ guildNpc, menuOpen, jobLevel, load, save, candidates, reroll, onGuildClose, onMenuClose, onMode }: {
  guildNpc: NpcDef | null;
  menuOpen: boolean;
  jobLevel: number;
  load: PartyLoad;
  save: (guild: string, ids: string[], payRkey?: string) => Promise<{ party: ServerParty; power: number }>;
  candidates: (guild: string) => Promise<ServerPartyCandidates>;
  reroll: (guild: string, rkey: string) => Promise<ServerPartyCandidates>;
  onGuildClose: () => void;
  onMenuClose: () => void;
  onMode?: PartyModeSave | undefined;
}) {
  // 読み込み (load) は world の party を更新して ここを描き直す。候補の関数を毎回作ると GuildPartyModal の読み込みが
  // 取り消されて読み直しを繰り返し、窓が空のままになる。ギルドが同じあいだは同じ関数を渡す。
  const guildId = guildNpc?.id;
  const guildCandidates = useCallback(() => candidates(guildId ?? ''), [candidates, guildId]);
  if (guildNpc) return <GuildPartyModal guild={guildNpc} jobLevel={jobLevel} load={load} save={(ids, payRkey) => save(guildNpc.id, ids, payRkey)} candidates={guildCandidates} reroll={(rkey) => reroll(guildNpc.id, rkey)} onClose={onGuildClose} />;
  return menuOpen ? <PartyModal jobLevel={jobLevel} load={load} onClose={onMenuClose} onMode={onMode} /> : null;
}
