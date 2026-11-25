import { EQUIPMENT, ITEMS, MAX_SHOP_EXCHANGE, type ShopExchangeEntry } from '@aozoraquest/core';

/**
 * 店エディタの「魔石の交換」欄 (D-MATERIAL-001)。町の魔石だけで買える品 (どうぐか装備) と魔石の数。
 * 品は ゲーム内の名前で選ぶ (id の自由入力は typo で「並んでいるのに買えない」を作る)。
 */
export function ShopExchangeEditor({ entries, onChange }: { entries: readonly ShopExchangeEntry[]; onChange: (next: ShopExchangeEntry[] | undefined) => void }) {
  const items = Object.entries(ITEMS).filter(([, it]) => !it.key);
  const set = (next: ShopExchangeEntry[]) => onChange(next.length ? next : undefined);
  const idOf = (e: ShopExchangeEntry) => (e.itemId ? `i:${e.itemId}` : `e:${e.equipmentId}`);
  const fromKey = (k: string, stones: number): ShopExchangeEntry => (k.startsWith('i:') ? { itemId: k.slice(2), stones } : { equipmentId: k.slice(2), stones });
  return (
    <div style={{ fontSize: '0.8em', display: 'flex', flexDirection: 'column', gap: '0.25em' }}>
      <div style={{ color: 'var(--color-muted)' }}>魔石の交換 (町の魔石だけで買える品。{MAX_SHOP_EXCHANGE} 品まで)</div>
      {entries.map((e, i) => (
        <div key={i} style={{ display: 'flex', gap: '0.3em', alignItems: 'center' }}>
          <select value={idOf(e)} onChange={(ev) => set(entries.map((x, j) => (j === i ? fromKey(ev.target.value, x.stones) : x)))}>
            <optgroup label="どうぐ">{items.map(([id, it]) => <option key={id} value={`i:${id}`}>{it.name}</option>)}</optgroup>
            <optgroup label="装備">{EQUIPMENT.filter((q) => !q.casinoOnly).map((q) => <option key={q.id} value={`e:${q.id}`}>{q.name} g{q.grade}</option>)}</optgroup>
          </select>
          <input
            type="number" min="1" max="99" step="1" aria-label="魔石の数"
            value={e.stones}
            onChange={(ev) => set(entries.map((x, j) => (j === i ? { ...x, stones: Math.max(1, Math.floor(Number(ev.target.value) || 1)) } : x)))}
            style={{ width: '4.5em' }}
          />
          <button type="button" onClick={() => set(entries.filter((_, j) => j !== i))} style={{ fontSize: '0.8em' }}>×</button>
        </div>
      ))}
      {entries.length < MAX_SHOP_EXCHANGE && (
        <button type="button" onClick={() => set([...entries, { itemId: 'herb', stones: 3 }])} style={{ fontSize: '0.8em', alignSelf: 'flex-start' }}>＋交換の品</button>
      )}
    </div>
  );
}
