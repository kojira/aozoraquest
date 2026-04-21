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
      ? `0 0 0 2px rgba(0,0,0,0.9), 0 0 0 4px ${equipment.accentColor}, 0 0 10px ${equipment.accentColor}`
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
          {/* primary: 右下、アクセント色のハロー + 黒シャドウでどんな背景でも浮かせる */}
          <span
            aria-hidden
            style={{
              position: 'absolute',
              right: `-${Math.round(size * 0.2)}px`,
              bottom: `-${Math.round(size * 0.2)}px`,
              width: Math.round(size * 0.62),
              height: Math.round(size * 0.62),
              pointerEvents: 'none',
              filter: `drop-shadow(0 0 6px ${equipment.accentColor}) drop-shadow(0 2px 3px rgba(0,0,0,0.95))`,
              display: 'block',
              lineHeight: 0,
            }}
          >
            {equipment.primary}
          </span>
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
                filter: `drop-shadow(0 0 5px ${equipment.accentColor}) drop-shadow(0 2px 3px rgba(0,0,0,0.95))`,
                display: 'block',
                lineHeight: 0,
              }}
            >
              {equipment.secondary}
            </span>
          )}
        </>
      )}
    </span>
  );
}
