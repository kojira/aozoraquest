import { useState } from 'react';
import { ModalShell } from './world-item-modals';
import type { QuestLogEntry } from '@/lib/game-quest';

/**
 * 「クエスト」窓: 受注中の依頼を ギルド / 個人 に分けて見せる (読み取り専用)。
 * 報告・辞退は発注 NPC / ギルドでだけ行う (権威経路を増やさない)。達成済みは出さない。
 */

const SECTIONS = [
  { key: 'guild', label: 'ギルドの依頼' },
  { key: 'personal', label: '個人の依頼' },
] as const;

const muted = { color: 'var(--color-muted)' };

export function QuestLogModal({ entries, onClose }: { entries: readonly QuestLogEntry[]; onClose: () => void }) {
  const [openId, setOpenId] = useState<string | null>(null);
  return (
    <ModalShell title="クエスト" onClose={onClose}>
      {SECTIONS.map(({ key, label }) => {
        const list = entries.filter(e => e.section === key);
        return (
          <section key={key} aria-label={label} style={{ marginBottom: '0.6em' }}>
            <div style={{ fontSize: '0.72em', ...muted, margin: '0 0 2px' }}>{label}</div>
            {list.length === 0 ? (
              <p style={{ fontSize: '0.82em', ...muted, margin: '0.2em 0' }}>受注中の依頼は ありません</p>
            ) : list.map(e => {
              const open = openId === e.id;
              return (
                <button
                  key={e.id}
                  type="button"
                  aria-expanded={e.detail ? open : undefined}
                  disabled={!e.detail}
                  onClick={() => setOpenId(open ? null : e.id)}
                  style={{ display: 'block', width: '100%', textAlign: 'left', padding: '0.4em 0.5em', margin: '0 0 4px', fontSize: '0.85em', overflowWrap: 'anywhere', touchAction: 'manipulation' }}
                >
                  <span style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5em' }}>
                    <strong>{e.title}</strong>
                    {e.ready && <span style={{ flexShrink: 0 }}>報告できます</span>}
                  </span>
                  {e.giver && <span style={{ display: 'block', fontSize: '0.9em', ...muted }}>{e.giver}</span>}
                  {e.progress && <span style={{ display: 'block', fontSize: '0.9em' }}>{e.progress}</span>}
                  {open && <span style={{ display: 'block', fontSize: '0.9em', marginTop: '0.3em' }}>{e.detail}</span>}
                </button>
              );
            })}
          </section>
        );
      })}
      {entries.length > 0 && (
        <div style={{ fontSize: '0.72em', ...muted }}>
          <p style={{ margin: '0.2em 0' }}>同じ敵の依頼は、受注しているものすべてに数えます。</p>
          <p style={{ margin: '0.2em 0' }}>所持品は ほかの依頼・どうぐ・制作と共通です。報告すると減ります。</p>
        </div>
      )}
    </ModalShell>
  );
}
