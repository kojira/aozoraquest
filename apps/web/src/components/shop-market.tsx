/**
 * なんでも屋の「中古」と「うる」(D-MARKET-001)。ほかのユーザーが出した品が並ぶ、はじめての画面。
 *
 * - 中古: その街の棚を安い順に。出品者は Bluesky の @handle (押すとプロフィール)。自分の品は「じぶんの」で買えない
 * - うる: 出せる品だけに「うる」。値段は出品者が決める (1 以上の整数)。目安 marketPrice を最初から入れておく
 * - 出せない品は理由を薄い字で (装備中・この街では扱えない など)。下に自分の出品と「とりさげ」
 * 値段・出せるか・手取り・上限は core の market.ts だけで決める (edge と同じ式)。
 */
import { useState } from 'react';
import {
  EQUIPMENT_BY_ID, MARKET_LIMITS, bonusText, bonusWithLevel, canEquip, isValidMarketPrice, leveledName, listable, marketPrice, marketSellerTake, townAt,
  type Archetype, type GearSelection, type Town, type UnlistableReason,
} from '@aozoraquest/core';
import { useHandle } from '@/lib/handle-cache';
import { GearDeltaText } from './gear-delta-text';
import type { CraftedPiece } from '@/lib/crafting';
import type { MarketMyListing, MarketShelfItem } from '@/lib/market-server';

const BTN = { minHeight: 44, padding: '0.35em 0.8em', fontSize: '0.85em', whiteSpace: 'nowrap' } as const;
const ROW = { border: '2px solid var(--color-border)', borderRadius: 4, padding: '0.4em 0.6em', fontSize: '0.85em', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5em' } as const;
const MUTED = { fontSize: '0.85em', color: 'var(--color-muted)' } as const;

export type ShopTab = 'shop' | 'used' | 'sell';
const TABS: ReadonlyArray<[ShopTab, string]> = [['shop', 'みせ'], ['used', '中古'], ['sell', 'うる']];

/** 店の名前の下のタブ。390px でも 3 つが 1 行に入る。 */
export function ShopTabs({ tab, onTab }: { tab: ShopTab; onTab: (t: ShopTab) => void }) {
  return (
    <div role="tablist" aria-label="なんでも屋" style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
      {TABS.map(([id, label]) => (
        <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? undefined : 'secondary'} onClick={() => onTab(id)} style={{ ...BTN, flex: 1 }}>
          {label}
        </button>
      ))}
    </div>
  );
}

/** 出品者の @handle。解決できなかったら「だれか」。押すと Bluesky のプロフィール。表示はここ 1 か所。 */
export function SellerHandle({ did }: { did: string }) {
  const { handle, state } = useHandle(did);
  const text = state === 'resolved' && handle ? `@${handle}` : state === 'loading' ? '…' : 'だれか';
  return (
    <a href={`https://bsky.app/profile/${did}`} target="_blank" rel="noreferrer" style={{ color: 'inherit', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>
      {text}
    </a>
  );
}

/** 中古: その街の棚 (安い順はサーバーが並べる)。 */
export function UsedShelf({ shelf, me, archetype, gear, balance, busy, onBuy }: {
  shelf: MarketShelfItem[] | null;
  me: string | null;
  archetype: Archetype | null;
  /** 主人公のいまの装備 (いまとの差を出す。D-GEAR-DIFF-001)。 */
  gear?: GearSelection | undefined;
  balance: number;
  busy: boolean;
  onBuy: (item: MarketShelfItem) => void;
}) {
  const [confirm, setConfirm] = useState<string | null>(null);
  if (shelf === null) return <p style={MUTED}>たなを みている…</p>;
  if (shelf.length === 0) return <p style={MUTED}>この街の たなには まだ なにも ない。</p>;
  return (
    <>
      {shelf.map((it) => {
        const def = EQUIPMENT_BY_ID[it.itemId];
        if (!def) return null;
        const mine = it.seller === me;
        const key = `${it.seller}|${it.id}`;
        const equipable = archetype ? canEquip(archetype, def) : false;
        return (
          <div key={key} style={ROW}>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div><strong>{leveledName(def, it.level)}</strong></div>
              <div style={MUTED}>
                {bonusText(bonusWithLevel(def, it.level))}
                {!equipable && <span style={{ marginLeft: '0.5em' }}>(いまのジョブでは装備できない)</span>}
              </div>
              {archetype && equipable && gear && <GearDeltaText archetype={archetype} gear={gear} slot={def.slot} piece={{ id: it.itemId, level: it.level }} prefix="いまと比べて" />}
              <div style={{ fontSize: '0.85em', display: 'flex', gap: '0.3em', minWidth: 0 }}>
                <span style={{ flexShrink: 0, opacity: balance >= it.price ? 1 : 0.65 }}>パワー{it.price} ・</span>
                <SellerHandle did={it.seller} />
              </div>
            </div>
            {mine ? (
              <span style={{ ...MUTED, whiteSpace: 'nowrap' }}>じぶんの</span>
            ) : confirm === key ? (
              <span style={{ display: 'flex', gap: 4 }}>
                <button type="button" disabled={busy || balance < it.price} onClick={() => { setConfirm(null); onBuy(it); }} style={BTN}>かう!</button>
                <button type="button" className="secondary" onClick={() => setConfirm(null)} style={BTN}>やめる</button>
              </span>
            ) : (
              <button type="button" disabled={busy || balance < it.price} onClick={() => setConfirm(key)} style={BTN}>かう</button>
            )}
          </div>
        );
      })}
    </>
  );
}

const REASON_TEXT: Record<UnlistableReason | 'equipped', string> = {
  casino: 'カジノの けいひんは うれない',
  no_price: 'うれない品',
  bad_level: 'うれない品',
  grade_over_town: 'この街では あつかえない',
  equipped: 'そうび中',
};

/** うる: 出せる品と、自分の出品の一覧。 */
export function SellPanel({ town, pieces, equippedRkeys, wornKeys, listings, busy, onList, onCancel }: {
  town: Town;
  pieces: CraftedPiece[];
  /** 主人公が着ている個体の rkey。 */
  equippedRkeys: readonly string[];
  /** 仲間が着ている (品・強化値) → 人数。その数だけ「そうび中」にする。 */
  wornKeys: ReadonlyMap<string, number>;
  listings: MarketMyListing[];
  busy: boolean;
  onList: (piece: CraftedPiece, price: number) => void;
  onCancel: (listing: MarketMyListing) => void;
}) {
  const [confirm, setConfirm] = useState<string | null>(null);
  const [prices, setPrices] = useState<Record<string, string>>({});
  const here = listings.filter((l) => l.town.x === town.x && l.town.y === town.y).length;
  const full = listings.length >= MARKET_LIMITS.perUser || here >= MARKET_LIMITS.perUserPerTown;
  // 仲間が着ているぶんは、同じ (品・強化値) の個体から順に「そうび中」に数える。
  const allyLeft = new Map(wornKeys);
  const hero = new Set(equippedRkeys);
  const rows = pieces.map((p) => {
    const def = EQUIPMENT_BY_ID[p.itemId];
    if (!def) return null;
    const k = `${p.itemId}+${p.level}`;
    let reason: UnlistableReason | 'equipped' | null = null;
    if (hero.has(p.rkey)) reason = 'equipped';
    else if ((allyLeft.get(k) ?? 0) > 0) { allyLeft.set(k, allyLeft.get(k)! - 1); reason = 'equipped'; }
    else { const ok = listable(def, p.level, town); if (!ok.ok) reason = ok.reason; }
    return { p, def, reason };
  }).filter((r): r is NonNullable<typeof r> => r !== null);
  rows.sort((a, b) => Number(a.reason !== null) - Number(b.reason !== null));
  return (
    <>
      <p style={{ ...MUTED, margin: '0 0 2px' }}>出品中 {listings.length}/{MARKET_LIMITS.perUser}（この街 {here}/{MARKET_LIMITS.perUserPerTown}）。売れたら 1割が てすうりょうで きえる。</p>
      {rows.length === 0 && <p style={MUTED}>もちものに 装備が ない。</p>}
      {rows.map(({ p, def, reason }) => {
        const hint = marketPrice(def, p.level);
        const raw = prices[p.rkey] ?? String(hint);
        const price = Number(raw);
        const ok = isValidMarketPrice(price);
        return (
          <div key={p.rkey} style={{ ...ROW, opacity: reason ? 0.6 : 1 }}>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div><strong>{leveledName(def, p.level)}</strong></div>
              {reason ? (
                <div style={MUTED}>{REASON_TEXT[reason]}</div>
              ) : (
                <label style={{ fontSize: '0.85em', display: 'flex', alignItems: 'center', gap: '0.3em', flexWrap: 'wrap' }}>
                  パワー
                  <input type="number" inputMode="numeric" min={1} step={1} value={raw} aria-label={`${leveledName(def, p.level)}のねだん`}
                    onChange={(e) => setPrices((m) => ({ ...m, [p.rkey]: e.target.value }))} style={{ width: '5.5em', minHeight: 36, fontSize: '1em' }} />
                  <span style={{ color: 'var(--color-muted)' }}>めやす{hint}・手取り{ok ? marketSellerTake(price) : '-'}</span>
                </label>
              )}
            </div>
            {!reason && (confirm === p.rkey ? (
              <span style={{ display: 'flex', gap: 4 }}>
                <button type="button" disabled={busy || !ok || full} onClick={() => { setConfirm(null); onList(p, price); }} style={BTN}>出品する!</button>
                <button type="button" className="secondary" onClick={() => setConfirm(null)} style={BTN}>やめる</button>
              </span>
            ) : (
              <button type="button" disabled={busy || !ok || full} onClick={() => setConfirm(p.rkey)} style={BTN}>うる</button>
            ))}
          </div>
        );
      })}
      {listings.length > 0 && <div style={{ ...MUTED, marginTop: 4 }}><strong>じぶんの出品</strong></div>}
      {listings.map((l) => {
        const def = EQUIPMENT_BY_ID[l.itemId];
        return (
          <div key={l.id} style={ROW}>
            <div style={{ minWidth: 0 }}>
              <div><strong>{def ? leveledName(def, l.level) : l.itemId}</strong></div>
              <div style={MUTED}>{townAt(l.town.x, l.town.y)?.name ?? `(${l.town.x}, ${l.town.y})`} ・ パワー{l.price}</div>
            </div>
            <button type="button" className="secondary" disabled={busy} onClick={() => onCancel(l)} style={BTN}>とりさげ</button>
          </div>
        );
      })}
    </>
  );
}
