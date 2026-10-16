import { MAX_NPC_LINE, type NpcDef, type SceneLine } from '@aozoraquest/core';
import { ScenarioEffectsField } from '@/components/scenario-effects-field';

/** 話者の種類 (D-DIALOGUE-006 §5)。地の文 / NPC / 名前だけ / その場の人。 */
type SpeakerKind = 'none' | 'npc' | 'name' | 'here';
const speakerKind = (l: SceneLine): SpeakerKind => (l.npcId !== undefined ? 'npc' : l.speaker !== undefined ? 'name' : l.here ? 'here' : 'none');

/** 話者の欄を 1 つだけにして作り直す (検証は「話者の欄は 1 つまで」)。 */
function withSpeaker(l: SceneLine, kind: SpeakerKind, npcs: readonly NpcDef[]): SceneLine {
  const { npcId: _n, speaker: _s, here: _h, ...rest } = l;
  if (kind === 'npc') return { ...rest, npcId: npcs[0]?.id ?? '' };
  if (kind === 'name') return { ...rest, speaker: '？？？' };
  if (kind === 'here') return { ...rest, here: true };
  return rest;
}

/** 会話の 1 行の編集 (話者・本文・演出・↑↓・削除)。 */
export function DialogueLineEditor({ line, index, count, npcs, onChange, onMove, onDelete }: {
  line: SceneLine; index: number; count: number; npcs: readonly NpcDef[];
  onChange: (next: SceneLine) => void; onMove: (delta: -1 | 1) => void; onDelete: () => void;
}) {
  const n = index + 1;
  const kind = speakerKind(line);
  return (
    <div style={{ borderTop: '1px solid var(--color-border)', padding: '0.3em 0', display: 'flex', flexDirection: 'column', gap: '0.2em' }}>
      <div style={{ display: 'flex', gap: '0.3em', alignItems: 'center', flexWrap: 'wrap', fontSize: '0.85em' }}>
        <strong>{n}</strong>
        <select aria-label={`${n} 行目の話者`} value={kind} onChange={(e) => onChange(withSpeaker(line, e.target.value as SpeakerKind, npcs))}>
          <option value="none">地の文</option>
          <option value="npc">NPC</option>
          <option value="name">名前だけ</option>
          <option value="here">その場の人</option>
        </select>
        {kind === 'npc' && (
          <select aria-label={`${n} 行目の NPC`} value={line.npcId} onChange={(e) => onChange({ ...line, npcId: e.target.value })}>
            {!npcs.some((p) => p.id === line.npcId) && <option value={line.npcId}>{line.npcId} (見つからない)</option>}
            {npcs.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.id})</option>)}
          </select>
        )}
        {kind === 'name' && (
          <input aria-label={`${n} 行目の話者の名前`} value={line.speaker} onChange={(e) => onChange({ ...line, speaker: e.target.value })} style={{ width: '7em' }} />
        )}
        <span style={{ marginLeft: 'auto', display: 'flex', gap: '0.2em' }}>
          <button type="button" aria-label={`${n} 行目を上へ`} disabled={index === 0} onClick={() => onMove(-1)}>↑</button>
          <button type="button" aria-label={`${n} 行目を下へ`} disabled={index === count - 1} onClick={() => onMove(1)}>↓</button>
          <button type="button" aria-label={`${n} 行目を削除`} className="secondary" onClick={onDelete}>削除</button>
        </span>
      </div>
      <textarea aria-label={`${n} 行目の本文`} value={line.text} maxLength={MAX_NPC_LINE} rows={2}
        onChange={(e) => onChange({ ...line, text: e.target.value })} style={{ width: '100%', boxSizing: 'border-box' }} />
      <ScenarioEffectsField effects={line.effects ?? []} disabled={false} label="演出 (この行を出す瞬間に地図へ)" idPrefix={`${n} 行目の`}
        onChange={(next) => {
          const { effects: _e, ...rest } = line;
          onChange(next.length ? { ...rest, effects: next } : rest);
        }} />
    </div>
  );
}
