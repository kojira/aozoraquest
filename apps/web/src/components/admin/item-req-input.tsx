import type { ItemRequirement } from '@aozoraquest/core';

/**
 * 持ち物条件の編集 (#426)。`herb×2 key-1` のような空白区切りで書く。
 * ドロップダウンを条件の数だけ並べるより、まとめて 1 行で書けるほうが速い。
 */
export function ItemReqInput({ value, onChange, placeholder }: {
  value: ItemRequirement[] | undefined;
  onChange: (next: ItemRequirement[] | undefined) => void;
  placeholder?: string;
}) {
  const text = (value ?? []).map((r) => (r.count && r.count > 1 ? `${r.itemId}×${r.count}` : r.itemId)).join(' ');
  return (
    <input
      value={text}
      placeholder={placeholder ?? '(なし) 例: gate-key たいまつ×2'}
      onChange={(e) => {
        const reqs = e.target.value.split(/\s+/).filter(Boolean).map((tok) => {
          const [id, n] = tok.split(/[×x*]/);
          const count = Number(n);
          return { itemId: id!, ...(Number.isFinite(count) && count > 1 ? { count } : {}) };
        });
        onChange(reqs.length ? reqs : undefined);
      }}
      style={{ width: '16em', fontFamily: 'ui-monospace, monospace' }}
    />
  );
}
