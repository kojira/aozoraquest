import { useCallback, useEffect, useState } from 'react';
import { jobDisplayName, partyCombatants, partyDefsOf, recruitById, type NpcDef, type PartyAlly } from '@aozoraquest/core';
import { ModalShell } from './world-item-modals';
import type { ServerParty, ServerPartyCandidates } from '@/lib/world-server';
import { GuildPartyModal } from './guild-party-modal';

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

/** 仲間の一覧 (名前・職・★・Lv・HP/MP)。right はギルドの「はずす」など行ごとの操作。jobLevel は経験値の無いなじみの Lv。 */
export function PartyMemberList({ party, jobLevel, right }: { party: ServerParty; jobLevel: number; right?: (a: PartyAlly) => React.ReactNode }) {
  const members = partyDefsOf(party, recruitById, jobLevel);
  if (members.length === 0) return <p style={{ fontSize: '0.82em', ...muted, margin: '0.2em 0' }}>まだ だれも いない</p>;
  return (
    <>
      {members.map((r) => {
        const v = partyMemberView(r, party);
        return (
          <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5em', padding: '0.35em 0.4em', margin: '0 0 4px', fontSize: '0.85em', opacity: v.hp <= 0 ? 0.5 : 1 }}>
            <span style={{ flex: '1 1 auto', minWidth: 0 }}>
              <strong>{v.name}</strong> <span style={muted}>{v.job} Lv{v.level}</span> <span aria-label={`★${v.star.length}`} style={{ color: '#f5c542' }}>{v.star}</span>
              <span style={{ display: 'block', fontFamily: 'ui-monospace, monospace', fontSize: '0.9em' }}>HP {v.hp}/{v.maxHp}　MP {v.mp}/{v.maxMp}</span>
            </span>
            {right?.(r)}
          </div>
        );
      })}
    </>
  );
}

/** メニューの「なかま」: 一覧だけ (外すのはギルドで)。 */
export function PartyModal({ jobLevel, load, onClose }: { jobLevel: number; load: PartyLoad; onClose: () => void }) {
  const [party, setParty] = useState<ServerParty | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let live = true;
    load().then((r) => live && setParty(r.party), () => live && setError(true));
    return () => { live = false; };
  }, [load]);
  return (
    <ModalShell title="なかま" onClose={onClose}>
      {party ? <PartyMemberList party={party} jobLevel={jobLevel} /> : <p style={{ fontSize: '0.82em', ...muted }}>{error ? '読み込めなかった…' : 'よみこみちゅう…'}</p>}
      <p style={{ fontSize: '0.72em', ...muted, margin: '0.4em 0 0' }}>入れる・外すのは 冒険者ギルドで できます。</p>
    </ModalShell>
  );
}

/**
 * world.tsx から開くパーティの窓 (D-PARTY-001)。ギルドの編成 (npcTalk.guild === 'party') とメニューの「なかま」。
 * world.tsx の行数を増やさないため、開く条件と閉じたあとの戻り先をここに置く。
 */
export function PartyModals({ guildNpc, menuOpen, jobLevel, load, save, candidates, reroll, onGuildClose, onMenuClose }: {
  guildNpc: NpcDef | null;
  menuOpen: boolean;
  jobLevel: number;
  load: PartyLoad;
  save: (guild: string, ids: string[]) => Promise<ServerParty>;
  candidates: (guild: string) => Promise<ServerPartyCandidates>;
  reroll: (guild: string, rkey: string) => Promise<ServerPartyCandidates>;
  onGuildClose: () => void;
  onMenuClose: () => void;
}) {
  // 読み込み (load) は world の party を更新して ここを描き直す。候補の関数を毎回作ると GuildPartyModal の読み込みが
  // 取り消されて読み直しを繰り返し、窓が空のままになる。ギルドが同じあいだは同じ関数を渡す。
  const guildId = guildNpc?.id;
  const guildCandidates = useCallback(() => candidates(guildId ?? ''), [candidates, guildId]);
  if (guildNpc) return <GuildPartyModal guild={guildNpc} jobLevel={jobLevel} load={load} save={(ids) => save(guildNpc.id, ids)} candidates={guildCandidates} reroll={(rkey) => reroll(guildNpc.id, rkey)} onClose={onGuildClose} />;
  return menuOpen ? <PartyModal jobLevel={jobLevel} load={load} onClose={onMenuClose} /> : null;
}
