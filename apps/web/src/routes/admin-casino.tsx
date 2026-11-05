import { useCallback, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  activeEquipment, activeItems, CASINO_TABLE_RTP_MAX, CASINO_TABLE_RTP_MIN, casinoEffectiveRtp, casinoShapeIssue, casinoTableRtp, casinoTables,
  CasinoDataError, SLOT_REEL_SIZE, type CasinoGame, type CasinoPrize, type CasinoTables,
} from '@aozoraquest/core';
import { useSession } from '@/lib/session';
import { isAdminDid } from '@/lib/runtime-config';
import { saveCasino } from '@/lib/world-authoring';
import { useAuthoredWorld } from '@/lib/use-authored-world';
import { AuthoredWorldGate } from '@/components/admin/authored-world-gate';

/**
 * **カジノの表のエディタ** (D-CASINO-001 PR4)。スロットのコマ数・倍率、ハイローの倍率、レースの確率と倍率、景品と値段。
 * 保存の前に表の RTP (うんの補正の前) を計算して見せ、85〜98% の外・形の壊れた表は保存できない。
 * 実際に遊ぶときの RTP は うん で決まる (luk 0 で 94%・60 で 97%)。表を変えても、その値に合わせて倍率がかかる。
 * 倍率はレコードが整数しか持てないので 100 倍 (235 = ×2.35)、確率は %。
 */
const GAME_LABEL: Record<CasinoGame, string> = { slots: 'スロット', highlow: 'ハイロー', race: 'レース' };
const muted = { color: 'var(--color-muted)' } as const;
const num = { width: '5em', fontSize: '0.85em' } as const;
const pct = (v: number) => `${(v * 100).toFixed(2)}%`;

export function AdminCasino() {
  const session = useSession();
  const admin = isAdminDid(session.did ?? null);
  const [t, setT] = useState<CasinoTables>(() => structuredClone(casinoTables()));
  const [dirty, setDirty] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const loaded = useAuthoredWorld(session.agent ?? null, () => setT(structuredClone(casinoTables())));
  const edit = useCallback((f: (d: CasinoTables) => void) => { setT((cur) => { const d = structuredClone(cur); f(d); return d; }); setDirty(true); }, []);

  const shape = casinoShapeIssue(t);
  const rtp = useMemo(() => (shape ? null : casinoTableRtp(t)), [t, shape]);
  const outOfRange = rtp ? (Object.keys(rtp) as CasinoGame[]).filter((g) => !(rtp[g] >= CASINO_TABLE_RTP_MIN && rtp[g] <= CASINO_TABLE_RTP_MAX)) : [];
  const blocker = shape ?? (outOfRange.length ? `${outOfRange.map((g) => GAME_LABEL[g]).join('・')} の RTP が ${CASINO_TABLE_RTP_MIN * 100}〜${CASINO_TABLE_RTP_MAX * 100}% の外` : null);
  const reelTotal = t.slots.symbols.reduce((a, s) => a + s.count, 0);
  const prizeOptions = useMemo(() => [
    ...activeEquipment().filter((e) => e.casinoOnly).map((e) => ({ kind: 'equipment' as const, id: e.id, name: e.name })),
    ...activeItems().filter((i) => i.casinoOnly).map((i) => ({ kind: 'item' as const, id: i.id, name: i.name })),
  ], [loaded]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = useCallback(async () => {
    if (!session.agent || blocker) return;
    try {
      await saveCasino(session.agent, t);
      setDirty(false);
      setNote('保存した。サーバーは最大 5 分で拾う');
    } catch (e) {
      setNote(e instanceof CasinoDataError ? `保存できない: ${e.message}` : `保存できなかった: ${String(e)}`);
    }
  }, [session.agent, t, blocker]);

  if (!admin) return <div style={{ padding: '1em' }}><p>この画面は管理者だけが使えます。</p><Link to="/admin">管理ダッシュボードへ</Link></div>;

  return (
    <div className="admin-page" style={{ padding: '0.8em' }}>
      <AuthoredWorldGate loaded={loaded}>
        <div className="admin-head">
          <Link to="/admin" style={{ fontSize: '0.8em' }}>← 管理</Link>
          <strong>カジノ</strong>
          <button type="button" onClick={() => void save()} disabled={!session.agent || !dirty || !loaded || !!blocker} style={{ marginLeft: 'auto', fontSize: '0.85em' }}>保存</button>
        </div>
        {note && <p style={{ fontSize: '0.8em', color: 'var(--color-accent)', margin: '0 0 0.4em' }}>{note}</p>}

        <section aria-label="RTP" style={{ fontSize: '0.82em', margin: '0 0 0.8em' }}>
          <strong>表の RTP (保存できるのは {CASINO_TABLE_RTP_MIN * 100}〜{CASINO_TABLE_RTP_MAX * 100}%)</strong>
          {blocker && <p role="alert" style={{ color: 'var(--color-danger)', margin: '0.2em 0' }}>保存できない: {blocker}</p>}
          {rtp && (
            <table style={{ borderCollapse: 'collapse', marginTop: 4 }}>
              <thead><tr><th /><th>表</th><th>luk 0</th><th>luk 30</th><th>luk 60</th></tr></thead>
              <tbody>
                {(Object.keys(rtp) as CasinoGame[]).map((g) => (
                  <tr key={g} data-testid={`rtp-${g}`}>
                    <td>{GAME_LABEL[g]}</td>
                    <td style={{ padding: '0 0.6em', color: outOfRange.includes(g) ? 'var(--color-danger)' : undefined }}>{pct(rtp[g])}</td>
                    {[0, 30, 60].map((l) => <td key={l} style={{ padding: '0 0.6em', ...muted }}>{pct(casinoEffectiveRtp(t, g, l))}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p style={{ ...muted, margin: '0.2em 0 0' }}>遊ぶときは うん で 94%→97% に合わせて倍率がかかる (ハイローは有利なほう・レースはいちばん得な 1 頭で)。</p>
        </section>

        <section aria-label="スロット" style={{ fontSize: '0.82em', margin: '0 0 0.8em' }}>
          <strong>スロット</strong> <span style={{ color: reelTotal === SLOT_REEL_SIZE ? undefined : 'var(--color-danger)' }}>コマ数 {reelTotal}/{SLOT_REEL_SIZE}</span>
          {t.slots.symbols.map((s, i) => (
            <div key={s.id} style={{ display: 'flex', gap: '0.5em', alignItems: 'center', margin: '0.2em 0' }}>
              <span style={{ width: '5em' }}>{s.name}</span>
              <label>コマ <input type="number" min={1} style={num} aria-label={`${s.name}のコマ数`} value={s.count} onChange={(e) => edit((d) => { d.slots.symbols[i]!.count = Number(e.target.value); })} /></label>
              {s.triple !== undefined && <label>3 つで × <input type="number" min={1} style={num} aria-label={`${s.name}の倍率`} value={s.triple} onChange={(e) => edit((d) => { d.slots.symbols[i]!.triple = Number(e.target.value); })} /></label>}
              {s.any && s.any.map((v, k) => (
                <label key={k}>{k + 1} つ × <input type="number" min={0} style={num} aria-label={`${s.name}の ${k + 1} つの倍率`} value={v} onChange={(e) => edit((d) => { d.slots.symbols[i]!.any![k] = Number(e.target.value); })} /></label>
              ))}
            </div>
          ))}
        </section>

        <section aria-label="ハイロー" style={{ fontSize: '0.82em', margin: '0 0 0.8em' }}>
          <strong>ハイロー</strong> <span style={muted}>勝てる数ごとの倍率 (×100)</span>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4em', marginTop: 4 }}>
            {t.highlow.mult.map((m, k) => (
              <label key={k}>{k + 1}: <input type="number" min={1} style={num} aria-label={`ハイロー 勝てる数 ${k + 1} の倍率`} value={m} onChange={(e) => edit((d) => { d.highlow.mult[k] = Number(e.target.value); })} /></label>
            ))}
          </div>
        </section>

        <section aria-label="レース" style={{ fontSize: '0.82em', margin: '0 0 0.8em' }}>
          <strong>レース</strong> <span style={muted}>にんき順。確率 % (合計 100) と倍率 (×100)</span>
          {t.race.runners.map((r, i) => (
            <div key={i} style={{ display: 'flex', gap: '0.5em', margin: '0.2em 0' }}>
              <span style={{ width: '4em' }}>{i + 1}ばん</span>
              <label>確率 <input type="number" min={1} style={num} aria-label={`${i + 1}ばんの確率`} value={r.prob} onChange={(e) => edit((d) => { d.race.runners[i]!.prob = Number(e.target.value); })} /></label>
              <label>倍率 <input type="number" min={1} style={num} aria-label={`${i + 1}ばんの倍率`} value={r.odds} onChange={(e) => edit((d) => { d.race.runners[i]!.odds = Number(e.target.value); })} /></label>
              <span style={muted}>{pct((r.prob / 100) * (r.odds / 100))}</span>
            </div>
          ))}
        </section>

        <section aria-label="景品" style={{ fontSize: '0.82em', margin: '0 0 0.8em' }}>
          <strong>景品</strong> <span style={muted}>casinoOnly の品だけ (アイテムの画面で付ける)</span>
          {t.prizes.map((p, i) => (
            <div key={p.id} style={{ display: 'flex', gap: '0.5em', alignItems: 'center', margin: '0.2em 0' }}>
              <span style={{ flex: '0 0 10em' }}>{prizeOptions.find((o) => o.id === p.id)?.name ?? p.id}</span>
              <label>コイン <input type="number" min={1} style={{ ...num, width: '7em' }} aria-label={`${p.id}の値段`} value={p.coins} onChange={(e) => edit((d) => { d.prizes[i]!.coins = Number(e.target.value); })} /></label>
              <button type="button" className="secondary" style={{ fontSize: '0.8em' }} onClick={() => edit((d) => { d.prizes.splice(i, 1); })}>はずす</button>
            </div>
          ))}
          {prizeOptions.filter((o) => !t.prizes.some((p) => p.id === o.id)).map((o) => (
            <button key={o.id} type="button" className="secondary" style={{ fontSize: '0.8em', marginRight: 4 }} onClick={() => edit((d) => { d.prizes.push({ kind: o.kind, id: o.id, coins: 1000 } as CasinoPrize); })}>+ {o.name}</button>
          ))}
        </section>
      </AuthoredWorldGate>
    </div>
  );
}
