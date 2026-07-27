/**
 * あおぞらワールドの HUD (HP/MP + 現在地) をマップ上にオーバーレイ表示する
 * (縦スクロールを不要にして没入感を上げるため)。
 *
 * **表示専用レイヤー** (pointerEvents: none)。下の仮想スティック操作を邪魔しない。
 * 操作系のオーバーレイ (コマンドメニュー・戦闘) は別コンポーネントで、HUD より
 * 上の層に置く。マップ relative コンテナ内のオーバーレイ層は以下で固定する:
 *   1 = (予約) 地形上の装飾
 *   2 = HUD (この表示専用レイヤー)
 *   3 = 操作オーバーレイ (コマンドメニュー等、pointerEvents: auto)
 *   ※ エンカウント演出 (encounter-wipe) は fixed / zIndex 1000 で全部の上。
 * docs/19-overworld.md「マップ上オーバーレイの層」に対応。
 */

export const HUD_Z = 2;
/** 操作オーバーレイ (コマンドメニュー・戦闘、pointerEvents: auto)。HUD の 1 つ上。 */
export const OVERLAY_Z = HUD_Z + 1;

/** 残量比で緑→黄→赤 (battle-view の HpBar と同じ閾値。フィールドで瀕死が
 *  分からない退化を防ぐ — レビュー ★★★)。 */
function hpColor(ratio: number): string {
  return ratio > 0.5 ? '#7ee08f' : ratio > 0.25 ? '#f5c542' : '#e8566a';
}

/** 地形の上でも沈まない白文字 (DESIGN.md: 背景が透けるので text-shadow で輪郭)。 */
const TEXT_SHADOW = '0 1px 2px rgba(0,0,0,0.85)';

function Bar({ label, value, max, fill, labelColor }: { label: string; value: number; max: number; fill: string; labelColor: string }) {
  const ratio = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, lineHeight: 1.2 }}>
      <span style={{ width: '1.4em', fontWeight: 700, color: labelColor, textShadow: TEXT_SHADOW }}>{label}</span>
      <div style={{ width: 52, height: 5, background: 'rgba(0,0,0,0.5)', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ width: `${ratio * 100}%`, height: '100%', background: fill, transition: 'width 300ms ease, background 300ms ease' }} />
      </div>
      <span style={{ fontFamily: 'ui-monospace, monospace', color: '#fff', minWidth: '3.6em', textShadow: TEXT_SHADOW }}>
        {Math.max(0, value)}/{max}
      </span>
    </div>
  );
}

export function WorldHud({
  hp,
  maxHp,
  mp,
  maxMp,
  power,
  locationLabel,
  zIndex = HUD_Z,
}: {
  hp: number;
  maxHp: number;
  mp: number;
  maxMp: number;
  /** あおぞらパワー残高。**所持金に近い役割**なので HP/MP と並べて常時見せる
   *。以前は本文の注意書きの末尾に埋もれていて、
   *  「1 戦 = 1 消費」なのに残りが見えなかった。未取得なら省く。 */
  power?: number | null;
  /** 街名 or 危険度ラベル (右上に小さく) */
  locationLabel: string;
  /** 通常は HUD_Z。戦闘オーバーレイ中は HP/MP を上枠で鮮明に見せるため
   *  OVERLAY_Z より上に持ち上げる (表示専用なので操作は妨げない)。 */
  zIndex?: number;
}) {
  const hpRatio = maxHp > 0 ? hp / maxHp : 0;
  const panel: React.CSSProperties = {
    position: 'absolute',
    top: 6,
    padding: '4px 7px',
    background: 'rgba(20, 22, 30, 0.75)',
    border: '1px solid rgba(255,255,255,0.4)',
    borderRadius: 5,
  };
  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex }}>
      {/* 左上: HP/MP パネル */}
      <div style={{ ...panel, left: 6, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <Bar label="HP" value={hp} max={maxHp} fill={hpColor(hpRatio)} labelColor="#7ee08f" />
        <Bar label="MP" value={mp} max={maxMp} fill="#8ab6f0" labelColor="#8ab6f0" />
        {power !== null && power !== undefined && (
          // バーではなく数値だけ (上限が無いので比率を描けない)。DQ の G 表示と同じ立ち位置。
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, lineHeight: 1.2 }}>
            <span style={{ width: '1.4em', fontWeight: 700, color: '#f5c542', textShadow: TEXT_SHADOW }}>P</span>
            <span style={{ fontFamily: 'ui-monospace, monospace', color: power < 1 ? '#e8566a' : '#fff', textShadow: TEXT_SHADOW }}>
              {Math.max(0, power).toLocaleString()}
            </span>
          </div>
        )}
      </div>
      {/* 右上: 現在地 */}
      <div
        style={{
          ...panel,
          right: 6,
          maxWidth: '52%',
          fontSize: 11,
          color: '#fff',
          textAlign: 'right',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          textShadow: TEXT_SHADOW,
        }}
      >
        {locationLabel}
      </div>
    </div>
  );
}
