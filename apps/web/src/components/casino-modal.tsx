/**
 * カジノの窓 (D-CASINO-001 PR3)。★のマスに立つと、そのマスの窓だけが開く (両替・景品・スロット・ハイロー・レース)。
 * 上にコインの数。結果はサーバーの返事が来てから出す (回している間はリールのアニメ)。ボタンは高さ 44px 以上。
 * 通信や上限の失敗は、サーバーのことば (「すこし休んでいきませんか。…」など) をそのまま出す。
 */
import { useEffect, useRef, useState } from 'react';
import {
  CASINO_BETS, casinoTables, EQUIPMENT_BY_ID, ITEMS, bonusText, highLowWinCount, type CasinoGame, type CasinoOutcome, type CasinoSpot, type MonsterSpecies,
} from '@aozoraquest/core';
import { ModalShell } from './world-item-modals';
import { MonsterSvg } from './monster-svg';
import type { CasinoResult, CasinoRunner } from '@/lib/casino-server';

/** 窓が呼ぶ操作 (use-casino が rkey・トークン・コインの反映を受け持つ)。失敗はサーバーのことばで throw。 */
export interface CasinoActions {
  exchange: (power: number) => Promise<CasinoResult>;
  bonus: () => Promise<CasinoResult>;
  prize: (id: string) => Promise<CasinoResult>;
  play: (game: CasinoGame, body: { bet?: number; choice?: Record<string, unknown> }) => Promise<CasinoResult>;
  raceLineup: () => Promise<CasinoRunner[]>;
}

const BTN = { minHeight: 44, minWidth: 44, padding: '0.4em 0.8em', fontSize: '0.92em' } as const;
const muted = { color: 'var(--color-muted)' } as const;
const TITLES: Record<CasinoSpot['kind'] | CasinoGame, string> = { exchange: '両替', prize: '景品', game: 'カジノ', slots: 'スロット', highlow: 'ハイロー', race: 'モンスターレース' };
/** 最初の両替の前に 1 回だけ出す注意 (§7)。 */
const FIRST_EXCHANGE_KEY = 'aozora:casino-first-exchange';

const symbolName = (id: string) => casinoTables().slots.symbols.find((s) => s.id === id)?.name ?? id;
const errText = (e: unknown) => (e instanceof Error && e.message ? e.message : '通信に失敗しました。もういちどどうぞ。');

export function CasinoModal({ spot, coins, power, actions, onClose }: { spot: CasinoSpot; coins: number; power: number; actions: CasinoActions; onClose: () => void }) {
  const title = spot.kind === 'game' ? TITLES[spot.game] : TITLES[spot.kind];
  return (
    <ModalShell title={`よあけの カジノ — ${title}`} onClose={onClose}>
      <p data-testid="casino-coins" style={{ margin: '0 0 0.5em', fontSize: '0.95em' }}>コイン <strong>{coins.toLocaleString()}</strong> 枚</p>
      {spot.kind === 'exchange' && <ExchangePanel power={power} actions={actions} />}
      {spot.kind === 'prize' && <PrizePanel coins={coins} actions={actions} />}
      {spot.kind === 'game' && spot.game === 'slots' && <SlotsPanel coins={coins} actions={actions} />}
      {spot.kind === 'game' && spot.game === 'highlow' && <HighLowPanel coins={coins} actions={actions} />}
      {spot.kind === 'game' && spot.game === 'race' && <RacePanel coins={coins} actions={actions} />}
    </ModalShell>
  );
}

function useAction() {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = async <T,>(f: () => Promise<T>, ok: (r: T) => string | null): Promise<T | null> => {
    setBusy(true); setError(null);
    try { const r = await f(); setMsg(ok(r)); return r; } catch (e) { setError(errText(e)); return null; } finally { setBusy(false); }
  };
  return { busy, msg, error, run, setMsg };
}

function Status({ msg, error }: { msg: string | null; error: string | null }) {
  return (
    <>
      {msg && <p role="status" style={{ margin: '0.5em 0 0', fontSize: '0.9em' }}>{msg}</p>}
      {error && <p role="alert" style={{ margin: '0.5em 0 0', fontSize: '0.9em', color: '#ff8a80' }}>{error}</p>}
    </>
  );
}

function BetPicker({ bet, setBet, disabled }: { bet: number; setBet: (n: number) => void; disabled: boolean }) {
  return (
    <div role="radiogroup" aria-label="賭けるコイン" style={{ display: 'flex', gap: 6, margin: '0.4em 0' }}>
      {CASINO_BETS.map((b) => (
        <button key={b} type="button" role="radio" aria-checked={bet === b} disabled={disabled} onClick={() => setBet(b)} style={{ ...BTN, flex: 1, fontWeight: bet === b ? 700 : 400, outline: bet === b ? '2px solid #f5c542' : undefined }}>
          {b} 枚
        </button>
      ))}
    </div>
  );
}

function ExchangePanel({ power, actions }: { power: number; actions: CasinoActions }) {
  const a = useAction();
  const [warned, setWarned] = useState(() => localStorage.getItem(FIRST_EXCHANGE_KEY) === '1');
  return (
    <div>
      <p style={{ margin: '0 0 0.4em', fontSize: '0.88em' }}>「両替ですね。パワー1でコイン10枚です。」</p>
      <p style={{ margin: '0 0 0.4em', fontSize: '0.82em', ...muted }}>いまの パワー {power}</p>
      {!warned ? (
        <div role="note" style={{ border: '1px solid #f5c542', borderRadius: 6, padding: '0.5em', margin: '0 0 0.5em', fontSize: '0.86em' }}>
          コインはパワーに戻せません。使うぶんだけ両替してください。
          <button type="button" style={{ ...BTN, display: 'block', marginTop: 6, width: '100%' }} onClick={() => { localStorage.setItem(FIRST_EXCHANGE_KEY, '1'); setWarned(true); }}>わかった</button>
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 6 }}>
          {[1, 10, 50].map((p) => (
            <button key={p} type="button" disabled={a.busy || power < p} style={{ ...BTN, flex: 1 }} onClick={() => void a.run(() => actions.exchange(p), () => `パワー ${p} を コイン ${p * 10} 枚に かえた。`)}>
              パワー {p}<br /><span style={{ fontSize: '0.8em' }}>→ {p * 10} 枚</span>
            </button>
          ))}
        </div>
      )}
      <button type="button" disabled={a.busy} style={{ ...BTN, width: '100%', marginTop: 8 }} onClick={() => void a.run(() => actions.bonus(), () => '今日の コインを 50 枚 もらった！')}>
        今日のコインを もらう (投稿した日だけ)
      </button>
      <Status msg={a.msg} error={a.error} />
    </div>
  );
}

function PrizePanel({ coins, actions }: { coins: number; actions: CasinoActions }) {
  const a = useAction();
  return (
    <div>
      <p style={{ margin: '0 0 0.4em', fontSize: '0.88em' }}>「ここの品は、ほかのお店にはありません。ゆっくり選んでください。」</p>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {casinoTables().prizes.map((p) => {
          const eq = p.kind === 'equipment' ? EQUIPMENT_BY_ID[p.id] : undefined;
          const name = eq?.name ?? ITEMS[p.id]?.name ?? p.id;
          const detail = eq ? `${bonusText(eq.bonus)}${eq.element === 'void' ? '・空' : ''}` : ITEMS[p.id]?.desc ?? '';
          return (
            <li key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0.3em 0', borderBottom: '1px solid rgba(255,255,255,0.12)' }}>
              <span style={{ flex: 1, minWidth: 0, fontSize: '0.88em' }}>{name}<br /><span style={{ fontSize: '0.82em', ...muted }}>{detail}</span></span>
              <button type="button" disabled={a.busy || coins < p.coins} aria-label={`${name}を ${p.coins} 枚で こうかん`} style={BTN}
                onClick={() => void a.run(() => actions.prize(p.id), () => `${name}を てにいれた！`)}>{p.coins.toLocaleString()} 枚</button>
            </li>
          );
        })}
      </ul>
      <Status msg={a.msg} error={a.error} />
    </div>
  );
}

function slotLine(o: Extract<CasinoOutcome, { game: 'slots' }>) {
  if (o.reels.every((r) => r === 'aozora')) return 'あおぞらが みっつ そろった！　コインが どっさり出てきた！';
  return o.payout > 0 ? `${o.payout} 枚 でてきた！` : 'はずれ。';
}

function SlotsPanel({ coins, actions }: { coins: number; actions: CasinoActions }) {
  const a = useAction();
  const [bet, setBet] = useState(10);
  const [reels, setReels] = useState<string[]>(['aozora', 'star', 'golem']);
  const [spinning, setSpinning] = useState(false);
  const symbols = casinoTables().slots.symbols;
  const spin = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => () => { if (spin.current) clearInterval(spin.current); }, []);
  const go = async (times: 1 | 10) => {
    setSpinning(true);
    spin.current = setInterval(() => setReels([0, 1, 2].map(() => symbols[Math.floor(Math.random() * symbols.length)]!.id)), 90);
    const r = await a.run(() => actions.play('slots', { bet, ...(times === 10 ? { choice: { times: 10 } } : {}) }), (res) => {
      const outs = (res.outcomes ?? []) as Array<Extract<CasinoOutcome, { game: 'slots' }>>;
      if (times === 10) return `10 回 まわして ${outs.reduce((s, o) => s + o.payout, 0)} 枚 でてきた。`;
      return outs[0] ? slotLine(outs[0]) : null;
    });
    if (spin.current) clearInterval(spin.current);
    const last = (r?.outcomes?.at(-1) as Extract<CasinoOutcome, { game: 'slots' }> | undefined);
    if (last) setReels(last.reels);
    setSpinning(false);
  };
  return (
    <div>
      <div aria-label="リール" style={{ display: 'flex', gap: 6, justifyContent: 'center', margin: '0.3em 0 0.5em' }}>
        {reels.map((r, i) => (
          <div key={i} data-testid="reel" style={{ flex: 1, maxWidth: 100, height: 64, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '2px solid #f5c542', borderRadius: 6, background: '#102040', fontSize: '0.95em', fontWeight: 700 }}>
            {symbolName(r)}
          </div>
        ))}
      </div>
      <BetPicker bet={bet} setBet={setBet} disabled={spinning} />
      <div style={{ display: 'flex', gap: 6 }}>
        <button type="button" disabled={spinning || coins < bet} style={{ ...BTN, flex: 2 }} onClick={() => void go(1)}>まわす</button>
        <button type="button" disabled={spinning || coins < bet * 10} style={{ ...BTN, flex: 1 }} onClick={() => void go(10)}>10 回</button>
      </div>
      <details style={{ marginTop: 6, fontSize: '0.78em', ...muted }}>
        <summary>そろったときの倍率</summary>
        {symbols.filter((s) => s.triple || s.any).map((s) => <div key={s.id}>{s.name}: {s.triple ? `3 つで ×${s.triple}` : `1 つ ×${s.any![0]}・2 つ ×${s.any![1]}・3 つ ×${s.any![2]}`}</div>)}
      </details>
      <Status msg={a.msg} error={a.error} />
    </div>
  );
}

function HighLowPanel({ coins, actions }: { coins: number; actions: CasinoActions }) {
  const a = useAction();
  const [bet, setBet] = useState(10);
  const [hand, setHand] = useState<{ first: number; stake: number; step: number } | null>(null);
  const [second, setSecond] = useState<number | null>(null);
  const deal = () => void a.run(() => actions.play('highlow', { bet }), (r) => {
    setSecond(null);
    setHand(r.highlow ?? null);
    return r.cashout ? `前の勝ちの ${r.cashout} 枚を 受けとった。` : '1 枚目を 配った。次は 上か 下か？';
  });
  const pick = (p: 'high' | 'low') => void a.run(() => actions.play('highlow', { choice: { pick: p } }), (r) => {
    const o = r.outcomes?.[0] as Extract<CasinoOutcome, { game: 'highlow' }> | undefined;
    setSecond(o?.second ?? null);
    setHand(r.highlow ?? null);
    if (!o?.win) return 'ざんねん。また遊んでくださいね。';
    return r.cashout ? `あたり！ ${r.cashout} 枚 受けとった。` : `あたり！ ${r.highlow?.stake} 枚に なった。もう1回いきますか？`;
  });
  const cashout = () => void a.run(() => actions.play('highlow', { choice: { cashout: true } }), (r) => { setHand(null); return `${r.cashout} 枚 受けとった。`; });
  const canHigh = hand ? highLowWinCount(hand.first, 'high') > 0 : false;
  const canLow = hand ? highLowWinCount(hand.first, 'low') > 0 : false;
  return (
    <div>
      <div style={{ display: 'flex', gap: 12, justifyContent: 'center', margin: '0.3em 0 0.5em' }}>
        <Card n={hand?.first ?? (second === null ? null : null)} label="1 枚目" />
        <Card n={second} label="2 枚目" />
      </div>
      {hand ? (
        <>
          <p style={{ margin: '0 0 0.4em', fontSize: '0.86em', textAlign: 'center' }}>いま {hand.stake} 枚 (続けたのは {hand.step} 回)。同じ数字は 負け。</p>
          <div style={{ display: 'flex', gap: 6 }}>
            <button type="button" disabled={a.busy || !canHigh} style={{ ...BTN, flex: 1 }} onClick={() => pick('high')}>上 (勝てる数 {hand ? highLowWinCount(hand.first, 'high') : 0})</button>
            <button type="button" disabled={a.busy || !canLow} style={{ ...BTN, flex: 1 }} onClick={() => pick('low')}>下 (勝てる数 {hand ? highLowWinCount(hand.first, 'low') : 0})</button>
          </div>
          {hand.step > 0 && <button type="button" disabled={a.busy} style={{ ...BTN, width: '100%', marginTop: 6 }} onClick={cashout}>やめて {hand.stake} 枚 受けとる</button>}
        </>
      ) : (
        <>
          <BetPicker bet={bet} setBet={setBet} disabled={a.busy} />
          <button type="button" disabled={a.busy || coins < bet} style={{ ...BTN, width: '100%' }} onClick={deal}>くばる</button>
        </>
      )}
      <Status msg={a.msg} error={a.error} />
    </div>
  );
}

function Card({ n, label }: { n: number | null; label: string }) {
  return (
    <div aria-label={`${label} ${n ?? 'まだ'}`} style={{ width: 72, height: 96, borderRadius: 8, border: '2px solid #fff', background: n ? '#fdfdfd' : '#1c3d6e', color: '#123', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.8em', fontWeight: 700 }}>
      {n ?? ''}
    </div>
  );
}

function RacePanel({ coins, actions }: { coins: number; actions: CasinoActions }) {
  const a = useAction();
  const [bet, setBet] = useState(10);
  const [runners, setRunners] = useState<CasinoRunner[] | null>(null);
  const [runner, setRunner] = useState(0);
  const [winner, setWinner] = useState<number | null>(null);
  const [running, setRunning] = useState(false);
  const odds = casinoTables().race.runners;
  useEffect(() => { void actions.raceLineup().then(setRunners, () => setRunners([])); }, [actions]);
  const go = async () => {
    setWinner(null);
    setRunning(true);
    a.setMsg('よーい……スタート！');
    const r = await a.run(() => actions.play('race', { bet, choice: { runner } }), () => 'よーい……スタート！');
    const o = r?.outcomes?.[0] as Extract<CasinoOutcome, { game: 'race' }> | undefined;
    if (!o) { setRunning(false); return; }
    await new Promise((res) => setTimeout(res, 4000));
    setWinner(o.winner);
    setRunning(false);
    const name = (r?.race?.runners ?? runners ?? [])[o.winner]?.name ?? '';
    a.setMsg(`${name}が いちばんに ゴール！${o.payout > 0 ? ` ${o.payout} 枚 もらった！` : ''}`);
    if (r?.race?.runners) setRunners(r.race.runners);
    void actions.raceLineup().then((next) => { if (!running) setRunners(next); }, () => {});
  };
  return (
    <div>
      <ul aria-label="出走" style={{ listStyle: 'none', padding: 0, margin: '0 0 0.4em' }}>
        {(runners ?? []).map((m, i) => (
          <li key={i}>
            <button type="button" role="radio" aria-checked={runner === i} disabled={running} onClick={() => setRunner(i)}
              style={{ ...BTN, width: '100%', display: 'flex', alignItems: 'center', gap: 8, textAlign: 'left', marginBottom: 4, outline: runner === i ? '2px solid #f5c542' : undefined, position: 'relative', overflow: 'hidden' }}>
              <span style={{ width: 32, height: 32, flex: '0 0 32px', transform: running ? 'translateX(0)' : undefined, animation: running ? `aq-race ${2.4 + i * 0.35}s ease-in-out infinite alternate` : undefined }}>
                <MonsterSvg species={m.species as MonsterSpecies} monsterId={m.id} size={32} />
              </span>
              <span style={{ flex: 1, minWidth: 0 }}>{i + 1}ばん にんき {m.name}{winner === i ? ' ★ゴール' : ''}</span>
              <span style={{ fontSize: '0.85em' }}>×{(odds[i]!.odds / 100).toFixed(2)}</span>
            </button>
          </li>
        ))}
      </ul>
      {!runners && <p style={{ fontSize: '0.85em', ...muted }}>よみこみちゅう…</p>}
      <BetPicker bet={bet} setBet={setBet} disabled={running} />
      <button type="button" disabled={running || a.busy || !runners?.length || coins < bet} style={{ ...BTN, width: '100%' }} onClick={() => void go()}>{runner + 1}ばんに 賭ける</button>
      <style>{'@keyframes aq-race { from { transform: translateX(0) } to { transform: translateX(14px) } }'}</style>
      <Status msg={a.msg} error={a.error} />
    </div>
  );
}
