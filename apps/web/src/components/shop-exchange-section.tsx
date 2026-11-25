import { EQUIPMENT_BY_ID, ITEMS, bonusText, tierForRegion, townExchange, withCharacterNames, type Town } from '@aozoraquest/core';

/**
 * なんでも屋の「魔石の交換」の段 (D-MATERIAL-001)。その町の魔石だけで買える品 (パワーはいらない)。
 * 品と数は店のデータ (core の townExchange)。足りなければ押せない (判定の正はサーバー)。
 */
export function ShopExchangeSection({ town, materials, busy, onExchange }: {
  town: Town;
  materials: Readonly<Record<string, number>>;
  busy: boolean;
  onExchange: (id: string) => void;
}) {
  const { stoneId, entries } = townExchange(town, tierForRegion(town.region));
  if (entries.length === 0) return null;
  const stoneName = withCharacterNames(ITEMS[stoneId]?.name ?? stoneId);
  const have = materials[stoneId] ?? 0;
  return (
    <div style={{ border: '2px solid var(--color-border)', borderRadius: 4, padding: '0.4em 0.6em', fontSize: '0.85em' }}>
      <div style={{ marginBottom: 4 }}>
        <strong>魔石の交換</strong>{' '}
        <span style={{ color: 'var(--color-muted)', fontSize: '0.85em' }}>({stoneName}だけで交換できる)</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {entries.map((e) => {
          const id = (e.itemId ?? e.equipmentId)!;
          const item = e.itemId ? ITEMS[e.itemId] : undefined;
          const equip = e.equipmentId ? EQUIPMENT_BY_ID[e.equipmentId] : undefined;
          if (!item && !equip) return null;
          const name = withCharacterNames(item?.name ?? equip!.name);
          const desc = item?.desc ?? (equip ? bonusText(equip.bonus) : undefined);
          const affordable = have >= e.stones;
          return (
            <div key={id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5em' }}>
              <div style={{ minWidth: 0 }}>
                <div>
                  <strong>{name}</strong>
                  {item && <span style={{ marginLeft: '0.4em', color: 'var(--color-muted)' }}>所持{materials[id] ?? 0}</span>}
                </div>
                {desc && <div style={{ fontSize: '0.85em', color: 'var(--color-muted)' }}>{desc}</div>}
                <div style={{ fontSize: '0.85em', opacity: affordable ? 1 : 0.65 }}>{stoneName} ×{e.stones}</div>
              </div>
              <button
                type="button"
                disabled={busy || !affordable}
                onClick={() => onExchange(id)}
                style={{ fontSize: '0.85em', padding: '0.4em 0.9em', whiteSpace: 'nowrap' }}
              >
                こうかん
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
