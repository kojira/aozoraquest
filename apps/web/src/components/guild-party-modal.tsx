import { useEffect, useState } from 'react';
import { jobDisplayName, partyCapacity, partyDefsOf, recruitById, type NpcDef, type PartyAlly, type RecruitCandidate } from '@aozoraquest/core';
import { ModalShell } from './world-item-modals';
import { PartyMemberList, starText, type PartyLoad } from './party-modal';
import type { ServerParty, ServerPartyCandidates } from '@/lib/world-server';
import { PARTY_LINES } from '@/lib/party-lines';

export { PARTY_LINES };

const muted = { color: 'var(--color-muted)' };
const small = { fontSize: '0.8em', padding: '0.3em 0.7em', flexShrink: 0, touchAction: 'manipulation' } as const;
const newRkey = () => [...crypto.getRandomValues(new Uint8Array(12))].map((b) => b.toString(16).padStart(2, '0')).join('');

/**
 * ギルドの「なかまを さがす」(D-PARTY-001 / D-PARTY-002)。上に今のパーティ、下にこのギルドに今日来ている冒険者 (edge の候補)。
 * くわえる / はずす / (いっぱいなら) いれかえる を選ぶと、その場でサーバーへ送る (権威は edge)。
 * はずす・いれかえるときは 1 回だけ確かめる (はずした仲間とは もう会えない)。
 * パワーを払って、今日の候補を引き直せる (§10)。パワーが足りなければボタンを押せない。
 */
export function GuildPartyModal({ guild, jobLevel, load, save, candidates, reroll, onClose }: {
  guild: NpcDef;
  jobLevel: number;
  load: PartyLoad;
  /** 新しい ids を送り、確定したパーティを返す。 */
  save: (ids: string[]) => Promise<ServerParty>;
  /** 今日の候補を読む。 */
  candidates: () => Promise<ServerPartyCandidates>;
  /** 候補を引き直す (rkey は押すたびに 1 つ)。 */
  reroll: (rkey: string) => Promise<ServerPartyCandidates>;
  onClose: () => void;
}) {
  const [data, setData] = useState<{ party: ServerParty; flags: string[] } | null>(null);
  const [offer, setOffer] = useState<ServerPartyCandidates | null>(null);
  const [line, setLine] = useState<string | null>(null);
  const [swapIn, setSwapIn] = useState<RecruitCandidate | null>(null);
  /** はずす前の確かめ。ids は確かめたあとに送る ids。 */
  const [parting, setParting] = useState<{ who: PartyAlly; ids: string[]; said: string } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    Promise.all([load(), candidates()]).then(([r, c]) => {
      if (!live) return;
      setData(r);
      setOffer(c);
      if (r.party.ids.length === 0) setLine(PARTY_LINES.first);
    }, () => live && setLine('読み込めなかった…もう一度 話しかけてね。'));
    return () => { live = false; };
  }, [load, candidates]);

  const send = async (ids: string[], said: string) => {
    if (!data || busy) return;
    setBusy(true);
    setSwapIn(null);
    setParting(null);
    try {
      const party = await save(ids);
      setData({ ...data, party });
      // 入れた人は今日の一覧から消える (edge も同じく met で除く)。
      setOffer((o) => (o ? { ...o, candidates: o.candidates.filter((c) => !party.ids.includes(c.id)) } : o));
      setLine(said);
    } catch (e) {
      setLine(e instanceof Error && e.message ? e.message : '通信に失敗した…');
      // 日付をまたいだなど、候補が変わっていたら読みなおす。
      candidates().then(setOffer, () => {});
    } finally {
      setBusy(false);
    }
  };
  const doReroll = async () => {
    if (busy) return;
    setBusy(true);
    setSwapIn(null);
    try {
      setOffer(await reroll(newRkey()));
      setLine(PARTY_LINES.rerolled);
    } catch (e) {
      setLine(e instanceof Error && e.message ? e.message : '通信に失敗した…');
    } finally {
      setBusy(false);
    }
  };
  // 今のデータに無い id (admin で消した冒険者) は数えず、送らない (edge も同じく落とす)。
  const members = data ? partyDefsOf(data.party, recruitById, jobLevel) : [];
  const ids = members.map((m) => m.id);
  const cap = data ? partyCapacity(data.flags) - 1 : 0;
  const offered = (offer?.candidates ?? []).filter((c) => !ids.includes(c.id));
  const canReroll = !!offer && offer.power >= offer.rerollPower;
  const add = (c: RecruitCandidate) => {
    if (ids.length >= cap) { setSwapIn(c); setLine(PARTY_LINES.full); return; }
    void send([...ids, c.id], PARTY_LINES.joined(c.name));
  };

  return (
    <ModalShell title="なかまを さがす" onClose={onClose}>
      <div style={{ overflowY: 'auto', minHeight: 0 }}>
        {line && <p aria-live="polite" style={{ fontSize: '0.85em', margin: '0 0 0.5em' }}>{line}</p>}
        {parting && (
          <div role="alertdialog" aria-label="はずす確認" style={{ border: '1px solid rgba(255,255,255,0.55)', borderRadius: 4, padding: '0.4em 0.5em', margin: '0 0 0.5em' }}>
            <p style={{ fontSize: '0.85em', margin: '0 0 0.4em' }}>{PARTY_LINES.partConfirm(parting.who.name)}</p>
            <div style={{ display: 'flex', gap: '0.5em' }}>
              <button type="button" disabled={busy} style={small} onClick={() => void send(parting.ids, parting.said)}>はずす</button>
              <button type="button" style={small} onClick={() => setParting(null)}>やめる</button>
            </div>
          </div>
        )}
        {data && offer && (
          <>
            <section aria-label="いまの パーティ" style={{ marginBottom: '0.6em' }}>
              <div style={{ fontSize: '0.72em', ...muted, margin: '0 0 2px' }}>いまの パーティ（{ids.length}/{Math.max(cap, 0)}）</div>
              <PartyMemberList party={data.party} jobLevel={jobLevel} right={(r) => swapIn
                ? <button type="button" disabled={busy || !!parting} style={small} onClick={() => setParting({ who: r, ids: ids.map((id) => (id === r.id ? swapIn.id : id)), said: PARTY_LINES.joined(swapIn.name) })}>{r.name}と いれかえる</button>
                : <button type="button" disabled={busy || !!parting} style={small} onClick={() => setParting({ who: r, ids: ids.filter((id) => id !== r.id), said: PARTY_LINES.left(r.name) })}>{r.name}を はずす</button>} />
              {swapIn && <button type="button" style={small} onClick={() => { setSwapIn(null); setLine(null); }}>やめる</button>}
            </section>
            <section aria-label={PARTY_LINES.heading}>
              <div style={{ fontSize: '0.8em', margin: '0 0 2px' }}>{PARTY_LINES.heading}</div>
              <div style={{ fontSize: '0.72em', ...muted, margin: '0 0 4px' }}>{PARTY_LINES.onceOnly}</div>
              {offered.length === 0 ? <p style={{ fontSize: '0.85em', margin: '0.2em 0' }}>{PARTY_LINES.goneToday}</p> : offered.map((c) => {
                const locked = jobLevel < c.minLevel;
                return (
                  <div key={c.id} data-candidate style={{ display: 'flex', alignItems: 'center', gap: '0.5em', padding: '0.35em 0.4em', margin: '0 0 4px', fontSize: '0.85em', ...(locked ? { opacity: 0.5 } : {}) }}>
                    <span style={{ flex: '1 1 auto', minWidth: 0 }}>
                      <strong>{c.name}</strong> <span style={muted}>{jobDisplayName(c.archetype)} Lv{c.level}</span> <span aria-label={`★${c.star}`} style={{ color: '#f5c542' }}>{starText(c.star)}</span>
                      {locked && <span style={muted}>（Lv {c.minLevel} から）</span>}
                      <span style={{ display: 'block', fontSize: '0.9em' }}>「{c.line}」</span>
                    </span>
                    <button type="button" disabled={busy || !!swapIn || !!parting || locked} style={small} onClick={() => add(c)}>{c.name}を くわえる</button>
                  </div>
                );
              })}
              <button type="button" disabled={busy || !canReroll} style={{ ...small, marginTop: '0.3em' }} onClick={() => void doReroll()}>{PARTY_LINES.reroll(offer.rerollPower)}</button>
              <span style={{ fontSize: '0.72em', ...muted, marginLeft: '0.5em' }}>パワー {offer.power}</span>
            </section>
          </>
        )}
      </div>
    </ModalShell>
  );
}
