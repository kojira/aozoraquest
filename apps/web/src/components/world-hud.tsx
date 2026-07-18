/**
 * あおぞらワールドの HUD (HP/MP + 現在地) をマップ上にオーバーレイ表示する
 * (オーナー要望 2026-07-18「HP/MP の表示もマップの上にオーバーレイ表示。
 * 縦スクロールしなくてもよいように没入感を高める」)。
 *
 * マップの relative コンテナ内に絶対配置する。地形の上でも読めるよう半透明の
 * 暗パネルを敷く。pointerEvents: none で下の仮想スティック操作を邪魔しない。
 */

function Bar({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const ratio = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, lineHeight: 1.2 }}>
      <span style={{ width: '1.4em', fontWeight: 700, color }}>{label}</span>
      <div style={{ width: 52, height: 5, background: 'rgba(0,0,0,0.45)', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ width: `${ratio * 100}%`, height: '100%', background: color }} />
      </div>
      <span style={{ fontFamily: 'ui-monospace, monospace', color: '#fff', minWidth: '3.6em' }}>
        {value}/{max}
      </span>
    </div>
  );
}

export function WorldHud({
  hp,
  maxHp,
  mp,
  maxMp,
  locationLabel,
}: {
  hp: number;
  maxHp: number;
  mp: number;
  maxMp: number;
  /** 街名 or 危険度ラベル (右上に小さく) */
  locationLabel: string;
}) {
  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 2 }}>
      {/* 左上: HP/MP パネル */}
      <div
        style={{
          position: 'absolute',
          top: 6,
          left: 6,
          padding: '4px 7px',
          background: 'rgba(20, 22, 30, 0.62)',
          border: '1px solid rgba(255,255,255,0.35)',
          borderRadius: 5,
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
        }}
      >
        <Bar label="HP" value={hp} max={maxHp} color="#7ee08f" />
        <Bar label="MP" value={mp} max={maxMp} color="#8ab6f0" />
      </div>
      {/* 右上: 現在地 */}
      <div
        style={{
          position: 'absolute',
          top: 6,
          right: 6,
          maxWidth: '52%',
          padding: '3px 8px',
          background: 'rgba(20, 22, 30, 0.62)',
          border: '1px solid rgba(255,255,255,0.35)',
          borderRadius: 5,
          fontSize: 11,
          color: '#fff',
          textAlign: 'right',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {locationLabel}
      </div>
    </div>
  );
}
