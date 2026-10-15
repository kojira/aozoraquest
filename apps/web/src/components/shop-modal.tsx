import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CRAFT_TUNING,
  EQUIPMENT_BY_ID,
  ITEMS,
  SALE_TUNING,
  bonusText,
  canEquip,
  equipHands,
  forgedLevel,
  isMasterwork,
  isSellableMaterial,
  jobDisplayName,
  leveledName,
  salePowerFor,
  signed,
  townShopStock,
  type Archetype,
  type EquipmentDef,
  type Town,
  shopKeeperFor,
  worldOverlay,
} from '@aozoraquest/core';
import type { CraftedPiece } from '@/lib/crafting';
import { DialogueWindow } from '@/components/dialogue-window';
import type { DialogueLine } from '@/lib/dialogue';

/**
 * なんでも屋 (docs/20, W6b)。街に入ると開ける制作 + 合成モーダル。
 *
 * - **制作** (つくってもらう): パワー + 素材をわたす。できあがりの強化値は
 *   −1〜+5 で、制作時の luk が下限を引き上げる (「うんが高いほど下振れしにくい」)。
 * - **合成** (きたえてもらう): 同じアイテム・同じ強化値 2 つ → +1。+6 以上への
 *   唯一の道 = 過剰なアイテムを燃やすシンク。
 * - 装備できない品も制作・所持は可能 (転職準備 / クエスト交換の材料 — docs/20)。
 */

export type LastShopAction =
  | { kind: 'craft' | 'forge'; piece: CraftedPiece }
  // ひきとりの結果もモーダル内のセリフ窓で出す (#607) — 以前は世界の通知行に出していて、
  // この全画面モーダルの背面に描かれてプレイヤーには見えなかった。
  | { kind: 'sell'; materialId: string; count: number; powerGained: number };

/** 初回チュートリアル (最初の街のなんでも屋) を出したか。 */
const SHOP_TUTORIAL_KEY = 'aozora:shop-tutorial-done';

/** アイテムごとの「合成できる最良の組」(同強化値 2 個体の最大レベル)。
 *  装備中の個体は候補から除外 (そうび中の武器が黙って燃えるのを防ぐ)。 */
function bestForgePair(pieces: CraftedPiece[], equippedRkeys: readonly string[]): { level: number; rkeys: [string, string] } | null {
  const equipped = new Set(equippedRkeys);
  const byLevel = new Map<number, CraftedPiece[]>();
  for (const p of pieces) {
    if (equipped.has(p.rkey)) continue;
    if (p.level >= CRAFT_TUNING.levelMax) continue;
    const list = byLevel.get(p.level) ?? [];
    list.push(p);
    byLevel.set(p.level, list);
  }
  let best: { level: number; rkeys: [string, string] } | null = null;
  for (const [level, list] of byLevel) {
    if (list.length >= 2 && (!best || level > best.level)) {
      best = { level, rkeys: [list[0]!.rkey, list[1]!.rkey] };
    }
  }
  return best;
}

export function ShopModal({
  town,
  townIndex,
  archetype,
  balance,
  materials,
  pieces,
  equippedRkeys,
  busy,
  lastAction,
  errorText,
  noticeText,
  onCraft,
  onForge,
  onSell,
  onClose,
}: {
  town: Town;
  townIndex: number;
  archetype: Archetype | null;
  balance: number;
  materials: Record<string, number>;
  /** 所持している制作品 (強化値つき個体) */
  pieces: CraftedPiece[];
  /** 装備中の個体 rkey (合成候補から除外する) */
  equippedRkeys: readonly string[];
  busy: boolean;
  lastAction: LastShopAction | null;
  /** 失敗の理由 (#551)。**モーダル内に出す** — ページ本体の通知行に出しても、
   *  この全画面オーバーレイの背面に描かれてプレイヤーには見えない。 */
  errorText: string | null;
  /** 記帳だけ落ちたときの控えめな知らせ (#642)。品もパワーも動いていないので赤字にしない。 */
  noticeText?: string | null;
  onCraft: (def: EquipmentDef) => void;
  onForge: (def: EquipmentDef, level: number, rkeys: [string, string]) => void;
  /** 素材のひきとり (count は materialsPerPower の倍数) */
  onSell: (materialId: string, count: number) => void;
  onClose: () => void;
}) {
  const stock = useMemo(() => townShopStock(town, townIndex), [town, townIndex]);
  // 店主 (#385)。既定は街ごとに決定的な口調で、エディタ (#422) から上書きできる。
  const keeper = useMemo(() => shopKeeperFor(town.x, town.y), [town]);
  const materialName = ITEMS[stock.materialId]?.name ?? stock.materialId;
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const piecesByItem = useMemo(() => {
    const m = new Map<string, CraftedPiece[]>();
    for (const p of pieces) {
      const list = m.get(p.itemId) ?? [];
      list.push(p);
      m.set(p.itemId, list);
    }
    return m;
  }, [pieces]);

  useEffect(() => {
    closeBtnRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // ── 店主のセリフ窓 (#607) ──────────────────────────────
  // セリフはインライン文でなく **DialogueWindow をモーダルの上に重ねて**出す
  // (z 901 > モーダル 300)。品目リストと文字が重ならず、DQ の作法にも合う。
  const say = (text: string): DialogueLine => (keeper.name ? { speaker: keeper.name, text } : { text: `「${text}」` });
  // nonce で窓を必ず remount する — talk を差し替えるだけだと DialogueWindow の
  // 行 index が持ち越され、短い配列に替わった瞬間に index 超過で不可視のまま固着する
  // (レビュー ★★: Tab で背面ボタンに抜けて操作した場合に成立)。
  const [talk, setTalk] = useState<{ n: number; lines: DialogueLine[]; tutorial?: boolean } | null>(null);
  const talkSeq = useRef(0);
  const openTalk = (lines: DialogueLine[], tutorial = false) => setTalk({ n: ++talkSeq.current, lines, ...(tutorial ? { tutorial } : {}) });
  useEffect(() => {
    // 入店時のあいさつ。**最初の街 (spawn の村) の初回だけ**は店の使い方を話す
    // チュートリアルにする — 毎回の説明文は出さない。
    // 既読フラグは開いた瞬間でなく**読み終えたとき** (onDone) に立てる — 開いた瞬間に
    // 立てると、途中で閉じたら二度と読めず、StrictMode の二重実行でも即座に既読化して
    // 一度も表示されない (レビュー ★★)。
    const sp = worldOverlay().spawn;
    let done = true;
    try { done = localStorage.getItem(SHOP_TUTORIAL_KEY) === '1'; } catch { /* private mode */ }
    if (town.x === sp.x && town.y === sp.y && !done) {
      openTalk([
        say(keeper.greeting),
        say('ここは なんでも屋。あおぞらパワーと 素材を もってくれば、そうびを つくるよ。'),
        say('できばえは −1〜+5。うんが 高いほど いい品に なりやすい。'),
        say('おなじ品を 2つ もってくれば、1つ上に きたえてやろう。'),
        say('素材は このへんの モンスターが おとす。いらない素材は ひきとって パワーに かえるよ。'),
      ], true);
    } else {
      openTalk([say(keeper.greeting)]);
    }
    // 入店時に 1 回だけ。keeper/town はモーダルの寿命中変わらない。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!lastAction) return;
    if (lastAction.kind === 'sell') {
      openTalk([
        { text: `${ITEMS[lastAction.materialId]?.name ?? lastAction.materialId} ×${lastAction.count} を ひきとってもらい、パワーが ${lastAction.powerGained} ふえた!` },
        say(keeper.sell),
      ]);
      return;
    }
    const def = EQUIPMENT_BY_ID[lastAction.piece.itemId];
    if (!def) return;
    openTalk([
      {
        text: `${isMasterwork(lastAction.piece.level) ? '✨ ' : ''}${leveledName(def, lastAction.piece.level)} ${
          lastAction.kind === 'forge' ? 'に きたえあげた!' : 'が できた!'}`,
      },
      say(lastAction.kind === 'forge' ? keeper.forge : keeper.craft),
    ]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastAction]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="なんでも屋"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 300,
        background: 'rgba(0, 0, 0, 0.72)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1em',
      }}
    >
      <div
        className="dq-window"
        onClick={(e) => e.stopPropagation()}
        style={{
          padding: 10,
          width: 'min(94vw, 520px)',
          maxHeight: '86svh',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
          <strong style={{ fontSize: '0.95em' }}>🔨 {town.name} のなんでも屋</strong>
          <button ref={closeBtnRef} type="button" onClick={onClose} style={{ fontSize: '0.8em', padding: '0.3em 0.9em' }}>
            とじる
          </button>
        </div>
        {/* 説明文は毎回出さない (#607) — 使い方は最初の街の初回チュートリアルで店主が話す。
            もちもの (残高) だけコンパクトに常設する。 */}
        <p style={{ margin: '0 0 0.5em', fontSize: '0.8em', color: 'var(--color-muted)' }}>
          もちもの: パワー <strong style={{ color: 'var(--color-fg)' }}>{balance}</strong> / {materialName}{' '}
          <strong style={{ color: 'var(--color-fg)' }}>×{materials[stock.materialId] ?? 0}</strong>
        </p>
        {/* 失敗の理由はボタンのそばに残す (セリフ窓に出すと閉じた瞬間に消えて読み逃す)。
            live region は常設して中身を差し替える (条件付きマウントは初回読み上げが
            落ちることがある — レビュー指摘) */}
        <p
          aria-live="polite"
          style={{
            margin: '0 0 0.5em',
            fontSize: '0.85em',
            fontWeight: 700,
            minHeight: errorText ? '1.4em' : 0,
            color: 'var(--color-danger, #e8566a)',
          }}
        >
          {errorText}
        </p>
        {/* live region は**常設**して中身だけ差し替える (条件付きマウントは初回読み上げが
            落ちることがある — 上のエラー行と同じ理由。レビュー ★★) */}
        <p
          aria-live="polite"
          style={{
            margin: noticeText ? '0 0 0.5em' : 0,
            fontSize: '0.8em',
            minHeight: noticeText ? '1.3em' : 0,
            color: 'var(--color-muted)',
          }}
        >
          {noticeText}
        </p>
        <div style={{ overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
          {stock.equipment.map((id) => {
            const def = EQUIPMENT_BY_ID[id];
            if (!def) return null;
            const equipable = archetype ? canEquip(archetype, def) : false;
            const affordable = balance >= def.price.power && (materials[stock.materialId] ?? 0) >= def.price.materials;
            const owned = piecesByItem.get(id) ?? [];
            const forge = bestForgePair(owned, equippedRkeys);
            // 装備を外せば鍛えられる組があるのに、装備中除外で不成立の場合の注記
            const forgeBlockedByEquip = !forge && bestForgePair(owned, []) !== null;
            const bestOwned = owned.length > 0 ? Math.max(...owned.map((p) => p.level)) : null;
            return (
              <div
                key={id}
                style={{
                  border: '2px solid var(--color-border)',
                  borderRadius: 4,
                  padding: '0.4em 0.6em',
                  fontSize: '0.85em',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: '0.5em',
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div>
                    <strong>{def.name}</strong>
                    {equipHands(def) === 2 && <span style={{ marginLeft: '0.3em', fontSize: '0.8em', color: 'var(--color-muted)' }}>(両手)</span>}
                    {owned.length > 0 && (
                      <span style={{ marginLeft: '0.4em', color: 'var(--color-muted)' }}>
                        所持 {owned.length}{bestOwned !== null && bestOwned !== 0 ? ` (最高${signed(bestOwned)})` : ''}
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: '0.85em', color: 'var(--color-muted)' }}>
                    {bonusText(def.bonus)}
                    {def.jobOnly && (
                      <span style={{ marginLeft: '0.5em', color: equipable ? 'var(--color-accent)' : 'var(--color-danger)' }}>
                        (要: {jobDisplayName(def.jobOnly, 'default')})
                      </span>
                    )}
                    {!def.jobOnly && !equipable && (
                      <span style={{ marginLeft: '0.5em' }}>(いまのジョブでは装備できない)</span>
                    )}
                  </div>
                  <div style={{ fontSize: '0.85em', opacity: affordable ? 1 : 0.65 }}>
                    パワー {def.price.power} + {materialName} ×{def.price.materials}
                  </div>
                </div>
                <span style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'stretch' }}>
                  {confirmId === id ? (
                    <span style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                      {!equipable && (
                        <span style={{ fontSize: '0.72em', color: 'var(--color-muted)', whiteSpace: 'nowrap' }}>
                          いまは装備できないけど
                        </span>
                      )}
                      <button
                        type="button"
                        disabled={busy || !affordable}
                        onClick={() => {
                          setConfirmId(null);
                          onCraft(def);
                        }}
                        style={{ fontSize: '0.85em', padding: '0.4em 0.8em' }}
                      >
                        つくる!
                      </button>
                      <button
                        type="button"
                        className="secondary"
                        onClick={() => setConfirmId(null)}
                        style={{ fontSize: '0.85em', padding: '0.4em 0.6em' }}
                      >
                        やめる
                      </button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      disabled={busy || !affordable}
                      onClick={() => setConfirmId(id)}
                      style={{ fontSize: '0.85em', padding: '0.4em 0.9em', whiteSpace: 'nowrap' }}
                    >
                      つくってもらう
                    </button>
                  )}
                  {forge && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => onForge(def, forgedLevel(forge.level), forge.rkeys)}
                      style={{ fontSize: '0.8em', padding: '0.35em 0.7em', whiteSpace: 'nowrap' }}
                    >
                      きたえる ({signed(forge.level)}×2 → {signed(forgedLevel(forge.level))})
                    </button>
                  )}
                  {forgeBlockedByEquip && (
                    <span style={{ fontSize: '0.7em', color: 'var(--color-muted)', whiteSpace: 'nowrap' }}>
                      そうびを外すと きたえられる
                    </span>
                  )}
                </span>
              </div>
            );
          })}
          {/* 素材のひきとり (素材 → パワー。レートは無限ループ防止で低め — docs/20) */}
          {(() => {
            const sellable = Object.entries(materials).filter(
              ([id, n]) => isSellableMaterial(id) && n >= SALE_TUNING.materialsPerPower,
            );
            if (sellable.length === 0) return null;
            return (
              <div style={{ border: '2px solid var(--color-border)', borderRadius: 4, padding: '0.4em 0.6em', fontSize: '0.85em' }}>
                <div style={{ marginBottom: 4 }}>
                  <strong>素材のひきとり</strong>{' '}
                  <span style={{ color: 'var(--color-muted)', fontSize: '0.85em' }}>
                    ({SALE_TUNING.materialsPerPower} 個 = パワー 1)
                  </span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {sellable.map(([id, n]) => {
                    const power = salePowerFor(n);
                    const count = power * SALE_TUNING.materialsPerPower;
                    return (
                      <div key={id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5em' }}>
                        <span>
                          {ITEMS[id]?.name ?? id} ×{n}
                        </span>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => onSell(id, count)}
                          style={{ fontSize: '0.85em', padding: '0.35em 0.8em', whiteSpace: 'nowrap' }}
                        >
                          ×{count} ひきとり → パワー {power}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })()}
        </div>
      </div>
      {talk && (
        <DialogueWindow
          key={talk.n}
          lines={talk.lines}
          onDone={() => {
            if (talk.tutorial) {
              try { localStorage.setItem(SHOP_TUTORIAL_KEY, '1'); } catch { /* private mode */ }
            }
            setTalk(null);
          }}
        />
      )}
    </div>
  );
}
