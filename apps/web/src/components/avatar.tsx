import type { CSSProperties } from 'react';
import type { Archetype } from '@aozoraquest/core';
import { getJobEquipment } from './job-equipment';

interface AvatarProps {
  src?: string | undefined;
  alt?: string;
  size?: number;
  style?: CSSProperties;
  /** 表示したい本人のジョブ。指定すると装備と accent リングが重なる。 */
  archetype?: Archetype | null | undefined;
}

/**
 * 円形アバター。archetype を渡すとジョブに応じた装備アイコンを周囲に配置する。
 */
export function Avatar({ src, alt = '', size = 32, style, archetype }: AvatarProps) {
  const equipment = archetype ? getJobEquipment(archetype) : null;

  const outer: CSSProperties = {
    position: 'relative',
    width: size,
    height: size,
    minWidth: size,
    flexShrink: 0,
    display: 'inline-block',
    ...style,
  };

  const inner: CSSProperties = {
    width: size,
    height: size,
    borderRadius: '50%',
    overflow: 'hidden',
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    boxShadow: equipment
      ? `0 0 0 2px rgba(0,0,0,0.9), 0 0 0 4px ${equipment.accentColor}`
      : 'none',
    display: 'block',
  };

  const img: CSSProperties = {
    width: '100%',
    height: '100%',
    display: 'block',
    objectFit: 'cover',
  };

  const imgEl = src ? (
    <img
      src={src}
      alt={alt}
      width={size * 2}
      height={size * 2}
      loading="lazy"
      decoding="async"
      style={img}
    />
  ) : (
    <div aria-hidden style={{ width: '100%', height: '100%' }} />
  );

  return (
    <span style={outer}>
      <span style={inner}>{imgEl}</span>
      {equipment && (
        <>
          {/* primary: 右下コーナー */}
          {equipment.primary && (
            <span
              aria-hidden
              style={{
                position: 'absolute',
                right: `-${Math.round(size * 0.2)}px`,
                bottom: `-${Math.round(size * 0.2)}px`,
                width: Math.round(size * 0.62),
                height: Math.round(size * 0.62),
                pointerEvents: 'none',
                filter: 'drop-shadow(0 2px 3px rgba(0,0,0,0.95))',
                display: 'block',
                lineHeight: 0,
              }}
            >
              {equipment.primary}
            </span>
          )}
          {/* secondary: 左上コーナー */}
          {equipment.secondary && (
            <span
              aria-hidden
              style={{
                position: 'absolute',
                left: `-${Math.round(size * 0.12)}px`,
                top: `-${Math.round(size * 0.12)}px`,
                width: Math.round(size * 0.44),
                height: Math.round(size * 0.44),
                pointerEvents: 'none',
                filter: 'drop-shadow(0 2px 3px rgba(0,0,0,0.95))',
                display: 'block',
                lineHeight: 0,
              }}
            >
              {equipment.secondary}
            </span>
          )}
          {/* leftSide: キャラの右手 (viewer の左) — 剣などの攻撃装備 */}
          {equipment.leftSide && (
            <span
              aria-hidden
              style={{
                position: 'absolute',
                left: `-${Math.round(size * 0.42)}px`,
                top: `${Math.round(size * 0.2)}px`,
                width: Math.round(size * 0.6),
                height: Math.round(size * 0.6),
                pointerEvents: 'none',
                filter: 'drop-shadow(0 2px 3px rgba(0,0,0,0.95))',
                display: 'block',
                lineHeight: 0,
                zIndex: 1,
              }}
            >
              {equipment.leftSide}
            </span>
          )}
          {/* rightSide: キャラの左手 (viewer の右) — 盾などの防御装備 */}
          {equipment.rightSide && (
            <span
              aria-hidden
              style={{
                position: 'absolute',
                right: `-${Math.round(size * 0.42)}px`,
                top: `${Math.round(size * 0.2)}px`,
                width: Math.round(size * 0.6),
                height: Math.round(size * 0.6),
                pointerEvents: 'none',
                filter: 'drop-shadow(0 2px 3px rgba(0,0,0,0.95))',
                display: 'block',
                lineHeight: 0,
                zIndex: 1,
              }}
            >
              {equipment.rightSide}
            </span>
          )}
          {/* crown: 頭上中央 */}
          {equipment.crown && (
            <span
              aria-hidden
              style={{
                position: 'absolute',
                left: '50%',
                top: `-${Math.round(size * 0.55)}px`,
                transform: 'translateX(-50%)',
                width: Math.round(size * 1.05),
                height: Math.round(size * 0.8),
                pointerEvents: 'none',
                filter: 'drop-shadow(0 2px 3px rgba(0,0,0,0.95))',
                display: 'block',
                lineHeight: 0,
                zIndex: 2,
              }}
            >
              {equipment.crown}
            </span>
          )}
        </>
      )}
    </span>
  );
}
