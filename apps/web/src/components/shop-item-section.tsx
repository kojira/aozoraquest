import { ITEMS, withCharacterNames } from '@aozoraquest/core';

/**
 * なんでも屋の「どうぐ」の段 (D-ITEM-001)。品揃え (stock.consumables) のうち値段のある品を、
 * 「名前・desc・値段 (パワー＋その店の値札の素材)・持っている数・かう」で並べる。
 * 足りなければ押せない (判定の正はサーバー。ここは押せるかの目安)。
 */
export function ShopItemSection({ consumables, materialId, materialName, balance, materials, busy, onBuy }: {
  consumables: readonly string[];
  materialId: string;
  materialName: string;
  balance: number;
  materials: Record<string, number>;
  busy: boolean;
  onBuy: (itemId: string) => void;
}) {
  const forSale = consumables.flatMap((id) => {
    const it = ITEMS[id];
    return it?.price ? [{ id, name: withCharacterNames(it.name), desc: it.desc, price: it.price }] : [];
  });
  if (forSale.length === 0) return null;
  return (
    <div style={{ border: '2px solid var(--color-border)', borderRadius: 4, padding: '0.4em 0.6em', fontSize: '0.85em' }}>
      <div style={{ marginBottom: 4 }}><strong>どうぐ</strong></div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {forSale.map(({ id, name, desc, price }) => {
          const affordable = balance >= price.power && (materials[materialId] ?? 0) >= price.materials;
          return (
            <div key={id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5em' }}>
              <div style={{ minWidth: 0 }}>
                <div>
                  <strong>{name}</strong>
                  <span style={{ marginLeft: '0.4em', color: 'var(--color-muted)' }}>所持{materials[id] ?? 0}</span>
                </div>
                {desc && <div style={{ fontSize: '0.85em', color: 'var(--color-muted)' }}>{desc}</div>}
                <div style={{ fontSize: '0.85em', opacity: affordable ? 1 : 0.65 }}>
                  {price.materials > 0 ? `パワー${price.power} + ${materialName} ×${price.materials}` : `パワー${price.power}`}
                </div>
              </div>
              <button
                type="button"
                disabled={busy || !affordable}
                onClick={() => onBuy(id)}
                style={{ fontSize: '0.85em', padding: '0.4em 0.9em', whiteSpace: 'nowrap' }}
              >
                かう
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
