import { HUD_Z } from '@/components/world-hud';

/** 「じぶんを タップ → コマンド」のコーチマーク (マップ中央の脈打つ輪)。 */
export function WorldMenuHint() {
  return (
    <div
      aria-hidden
      style={{
        position: 'absolute',
        left: '50%',
        top: '50%',
        transform: 'translate(-50%, -50%)',
        pointerEvents: 'none',
        zIndex: HUD_Z,
        textAlign: 'center',
      }}
    >
      <div className="aq-menu-hint-ring" style={{ width: 64, height: 64, borderRadius: '50%', border: '3px solid #fff', margin: '0 auto', boxShadow: '0 0 8px rgba(0,0,0,0.6)' }} />
      <div style={{ marginTop: 4, fontSize: 12, fontWeight: 700, color: '#fff', textShadow: '0 1px 3px rgba(0,0,0,0.9)' }}>
        じぶんを タップ → コマンド
      </div>
      <style>{`
@keyframes aq-menu-hint { 0% { transform: scale(0.8); opacity: 0.9; } 70% { transform: scale(1.25); opacity: 0; } 100% { opacity: 0; } }
.aq-menu-hint-ring { animation: aq-menu-hint 1.5s ease-out infinite; }
@media (prefers-reduced-motion: reduce) { .aq-menu-hint-ring { animation: none; } }
`}</style>
    </div>
  );
}
