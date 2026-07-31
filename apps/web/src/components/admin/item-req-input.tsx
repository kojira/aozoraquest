import { useEffect, useState } from 'react';
import type { ItemRequirement } from '@aozoraquest/core';

/** `herb×2 gate-key` を条件配列へ。`×`/`x`/`*` のどれでも区切れる。 */
function parse(text: string): ItemRequirement[] {
  return text.split(/\s+/).filter(Boolean).map((tok) => {
    // **区切りは全角× と * のみ。** 半角 x で切ると `elixir` が `eli` になる
    // (id に x を含む品が壊れる。レビュー ★★)。
    const m = /^(.+?)(?:[×*](\d+))?$/.exec(tok);
    const id = m?.[1] ?? tok;
    const n = Number(m?.[2]);
    return { itemId: id, ...(Number.isInteger(n) && n > 1 ? { count: n } : {}) };
  });
}

function format(value: ItemRequirement[] | undefined): string {
  return (value ?? []).map((r) => (r.count && r.count > 1 ? `${r.itemId}×${r.count}` : r.itemId)).join(' ');
}

/**
 * 持ち物条件の編集 (#426)。`herb×2 gate-key` のような空白区切りで書く。
 *
 * **打っている途中の文字列をそのまま保つ** — 正規化した文字列を毎回書き戻すと、
 * 「×」を打った瞬間に消える・空白を打つと 2 個目を打てない、という入力になる
 * (レビュー ★★)。確定 (blur) までは生のテキストを見せ、条件だけ親へ渡す。
 */
export function ItemReqInput({ value, onChange, placeholder }: {
  value: ItemRequirement[] | undefined;
  onChange: (next: ItemRequirement[] | undefined) => void;
  placeholder?: string;
}) {
  const [text, setText] = useState(() => format(value));
  // 外から値が差し替わったとき (別のゲート/クエストを選んだ等) だけ追随する。
  useEffect(() => { setText(format(value)); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [value === undefined ? '' : format(value)]);
  return (
    <input
      value={text}
      placeholder={placeholder ?? '(なし) 例: gate-key たいまつ×2'}
      onChange={(e) => {
        setText(e.target.value);
        const reqs = parse(e.target.value);
        onChange(reqs.length ? reqs : undefined);
      }}
      onBlur={() => setText(format(value))}
      style={{ width: '16em', fontFamily: 'ui-monospace, monospace' }}
    />
  );
}
