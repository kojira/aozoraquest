import { ITEMS, STONE_IDS, formulaStonesFor, monsterStoneElement, type MonsterDef } from '@aozoraquest/core';

/**
 * 敵エディタの「魔石」欄 (D-MATERIAL-001)。勝つと必ず落とす魔石の属性と数を見せ、数だけ整数で上書きできる。
 * 空欄 = 式の値 (1 + 想定Lv÷10、ボス +2、めずらしい敵 ×3)。属性は敵の属性 (無ければ空)。
 */
export function MonsterStonesEditor({ monster, onChange }: { monster: MonsterDef; onChange: (stones: number | undefined) => void }) {
  const stoneName = ITEMS[STONE_IDS[monsterStoneElement(monster)]]?.name ?? '';
  const formula = formulaStonesFor(monster);
  return (
    <label style={{ display: 'flex', gap: '0.4em', alignItems: 'center', fontSize: '0.8em' }}>
      <span style={{ color: 'var(--color-muted)' }}>魔石</span>
      <span>{stoneName}</span>
      <input
        type="number" min="1" max="99" step="1"
        aria-label="魔石の数"
        placeholder={`${formula} (式)`}
        value={monster.stones ?? ''}
        onChange={(e) => onChange(e.target.value === '' ? undefined : Math.max(1, Math.floor(Number(e.target.value))))}
        style={{ width: '6em' }}
      />
      <span style={{ color: 'var(--color-muted)' }}>空欄 = 式の {formula} 個</span>
    </label>
  );
}
