import { createContext, useContext, useId, useState } from 'react';
import type { NpcImage, NpcImageKind } from '@aozoraquest/core';
import { npcImageUrl } from '@/lib/npc-image';

/** Editor-only local URLs; never serialized into NPC records. */
export const NpcImagePreviews = createContext<ReadonlyMap<string, string>>(new Map());
export function useNpcImageSource(id: string, kind: NpcImageKind, image?: NpcImage): string | undefined {
  const previews = useContext(NpcImagePreviews);
  return image ? previews.get(`${id}/${kind}`) ?? npcImageUrl(id, kind, image) : undefined;
}
export function UploadedNpcSprite({ image, src, fallback }: { image: NpcImage; src: string; fallback: React.ReactNode }) {
  const clip = useId().replace(/:/g, '');
  const [failed, setFailed] = useState<string | null>(null);
  if (failed === src) return <>{fallback}</>;
  const animated = image.width === image.height * 2;
  const frame = (x: number) => <image href={src} x={x} y={0} width={animated ? 64 : 32} height={32} preserveAspectRatio="none" style={{ imageRendering: 'pixelated' }} onError={() => setFailed(src)} />;
  return <g className="npc-sprite" data-uploaded-sprite="true">
    <defs><clipPath id={clip}><rect width={32} height={32} /></clipPath></defs>
    <g clipPath={`url(#${clip})`}>
      <g className={animated ? 'npc-frame-0' : undefined}>{frame(0)}</g>
      {animated && <g className="npc-frame-1">{frame(-32)}</g>}
    </g>
  </g>;
}
export function NpcPortrait({ src, name }: { src: string; name: string }) {
  const [failed, setFailed] = useState<string | null>(null);
  if (failed === src) return null;
  return <img src={src} alt={`${name}の会話イラスト`} onError={() => setFailed(src)} style={{ display: 'block', width: 'min(55vw, 240px)', height: 'min(28dvh, 240px)', maxHeight: '100%', objectFit: 'contain', margin: '0 auto', pointerEvents: 'none' }} />;
}
