import { useEffect, useState } from 'react';
import { jobDisplayName, partyCapacity, recruitById, recruitLevelOk, recruitsAt, type NpcDef, type RecruitDef } from '@aozoraquest/core';
import { ModalShell } from './world-item-modals';
import { PartyMemberList, type PartyLoad } from './party-modal';
import type { ServerParty } from '@/lib/world-server';
import { PARTY_LINES } from '@/lib/party-lines';

export { PARTY_LINES };

const muted = { color: 'var(--color-muted)' };
const small = { fontSize: '0.8em', padding: '0.3em 0.7em', flexShrink: 0, touchAction: 'manipulation' } as const;

/**
 * ギルドの「なかまを さがす」(D-PARTY-001)。上に今のパーティ、下にこのギルドで紹介できる冒険者。
 * くわえる / はずす / (いっぱいなら) いれかえる を選ぶと、その場でサーバーへ送る (権威は edge)。
 */
export function GuildPartyModal({ guild, jobLevel, load, save, onClose }: {
  guild: NpcDef;
  jobLevel: number;
  load: PartyLoad;
  /** 新しい ids を送り、確定したパーティを返す。 */
  save: (ids: string[]) => Promise<ServerParty>;
  onClose: () => void;
}) {
  const [data, setData] = useState<{ party: ServerParty; flags: string[] } | null>(null);
  const [line, setLine] = useState<string | null>(null);
  const [swapIn, setSwapIn] = useState<RecruitDef | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    load().then((r) => {
      if (!live) return;
      setData(r);
      if (r.party.ids.length === 0) setLine(PARTY_LINES.first);
    }, () => live && setLine('読み込めなかった…もう一度 話しかけてね。'));
    return () => { live = false; };
  }, [load]);

  const send = async (ids: string[], said: string) => {
    if (!data || busy) return;
    setBusy(true);
    setSwapIn(null);
    try {
      const party = await save(ids);
      setData({ ...data, party });
      setLine(said);
    } catch (e) {
      setLine(e instanceof Error && e.message ? e.message : '通信に失敗した…');
    } finally {
      setBusy(false);
    }
  };
  // 今のデータに無い id (admin で消した冒険者) は数えず、送らない (edge も同じく落とす)。
  const ids = (data?.party.ids ?? []).filter((id) => recruitById(id));
  const cap = data ? partyCapacity(data.flags) - 1 : 0;
  const offered = data ? recruitsAt(guild.id, data.flags).filter((r) => !ids.includes(r.id)) : [];
  const add = (r: RecruitDef) => {
    if (ids.length >= cap) { setSwapIn(r); setLine(PARTY_LINES.full); return; }
    void send([...ids, r.id], PARTY_LINES.joined(r.name));
  };

  return (
    <ModalShell title="なかまを さがす" onClose={onClose}>
      <div style={{ overflowY: 'auto', minHeight: 0 }}>
        {line && <p aria-live="polite" style={{ fontSize: '0.85em', margin: '0 0 0.5em' }}>{line}</p>}
        {data && (
          <>
            <section aria-label="いまの パーティ" style={{ marginBottom: '0.6em' }}>
              <div style={{ fontSize: '0.72em', ...muted, margin: '0 0 2px' }}>いまの パーティ（{ids.length}/{Math.max(cap, 0)}）</div>
              <PartyMemberList party={data.party} jobLevel={jobLevel} right={(r) => swapIn
                ? <button type="button" disabled={busy} style={small} onClick={() => void send(ids.map((id) => (id === r.id ? swapIn.id : id)), PARTY_LINES.joined(swapIn.name))}>{r.name}と いれかえる</button>
                : <button type="button" disabled={busy} style={small} onClick={() => void send(ids.filter((id) => id !== r.id), PARTY_LINES.left(r.name))}>{r.name}を はずす</button>} />
              {swapIn && <button type="button" style={small} onClick={() => { setSwapIn(null); setLine(null); }}>やめる</button>}
            </section>
            <section aria-label={PARTY_LINES.heading}>
              {offered.length === 0 ? <p style={{ fontSize: '0.85em', margin: '0.2em 0' }}>{PARTY_LINES.none}</p> : (
                <>
                  <div style={{ fontSize: '0.8em', margin: '0 0 4px' }}>{PARTY_LINES.heading}</div>
                  {offered.map((r) => {
                    const locked = !recruitLevelOk(r, jobLevel);
                    return (
                      <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5em', padding: '0.35em 0.4em', margin: '0 0 4px', fontSize: '0.85em', ...(locked ? { opacity: 0.5 } : {}) }}>
                        <span style={{ flex: '1 1 auto', minWidth: 0 }}>
                          <strong>{r.name}</strong> <span style={muted}>{jobDisplayName(r.archetype)}</span>
                          {locked && <span style={muted}>（Lv {r.minLevel} から）</span>}
                          <span style={{ display: 'block', fontSize: '0.9em' }}>「{r.line}」</span>
                        </span>
                        <button type="button" disabled={busy || !!swapIn || locked} style={small} onClick={() => add(r)}>{r.name}を くわえる</button>
                      </div>
                    );
                  })}
                </>
              )}
            </section>
          </>
        )}
      </div>
    </ModalShell>
  );
}
