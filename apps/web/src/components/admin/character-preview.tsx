import { Link } from 'react-router-dom';
import { currentCharacters, withCharacterNames } from '@aozoraquest/core';

/**
 * 文の欄の下に出す「表示: …」(D-CHAR-001 §2-7)。人物の名前 {c:id} があるときだけ、
 * プレイヤーに見える文 (今の名前へ置き換えた結果) を 1 行出す。
 */
export function CharacterPreview({ text }: { text: string }) {
  if (!text.includes('{c:')) return null;
  return <div style={{ fontSize: '0.85em', color: 'var(--color-muted)', overflowWrap: 'anywhere' }}>{`表示: ${withCharacterNames(text)}`}</div>;
}

/** 欄の近くに出す、使える人物 id の一覧 (手で打つ id を間違えないため)。 */
export function CharacterIdList() {
  const list = currentCharacters();
  return (
    <details style={{ fontSize: '0.8em' }}>
      <summary>名前の差し込み {'{c:id}'} ({list.length})</summary>
      {list.length === 0 && <span style={{ color: 'var(--color-muted)' }}>まだ人物がいない。</span>}
      <ul style={{ margin: '0.2em 0', paddingLeft: '1.2em' }}>
        {list.map((c) => <li key={c.id}><code>{`{c:${c.id}} ${c.name}`}</code></li>)}
      </ul>
      <Link to="/admin/characters">人物の一覧へ</Link>
    </details>
  );
}
