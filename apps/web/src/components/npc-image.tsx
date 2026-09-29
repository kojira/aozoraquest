import { createContext, useContext, useId, useState } from 'react';
import type { NpcImage, NpcImageKind } from '@aozoraquest/core';
import { npcImageUrl } from '@/lib/npc-image';

/** Editor-only local URLs; never serialized into NPC records. */
export const NpcImagePreviews = createContext<ReadonlyMap<string, string>>(new Map());
/** Preview key; expression portraits (D-DIALOGUE-005) are `id/portrait:tag`. */
export const npcImagePreviewKey = (id: string, kind: NpcImageKind, expression?: string) => `${id}/${kind}${expression ? `:${expression}` : ''}`;
export function useNpcImageSource(id: string, kind: NpcImageKind, image?: NpcImage): string | undefined {
  const previews = useContext(NpcImagePreviews);
  return image ? previews.get(npcImagePreviewKey(id, kind)) ?? npcImageUrl(id, kind, image) : undefined;
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
export function NpcPortrait({ src, name, fitMap = false }: { src: string; name: string; fitMap?: boolean }) {
  const [failed, setFailed] = useState<string | null>(null);
  // Line-level expressions (D-DIALOGUE-005) switch src within one conversation. Each portrait keeps
  // its own mounted <img> (hidden when not current), and the previous one stays visible until the
  // next is loaded: switching back is instant and the area never blanks while an image downloads.
  const [srcs, setSrcs] = useState<readonly string[]>([src]);
  const [loaded, setLoaded] = useState<ReadonlySet<string>>(new Set());
  const [lastShown, setLastShown] = useState(src);
  if (!srcs.includes(src)) setSrcs([...srcs, src]);
  const shown = loaded.has(src) || !loaded.has(lastShown) ? src : lastShown;
  if (shown !== lastShown) setLastShown(shown);
  if (failed === src) return null;
  const style: React.CSSProperties = {
    display: 'block', width: 'min(55vw, 240px)', height: 'min(28dvh, 240px)', maxHeight: '100%',
    objectFit: 'contain', margin: '0 auto', pointerEvents: 'none',
    ...(fitMap ? { width: '100%', maxWidth: 240, height: 240, minHeight: 0, flex: '0 1 240px' } : {}),
  };
  return <>{srcs.map((s) => failed === s ? null : <img key={s} src={s} alt={s === shown ? `${name}の会話イラスト` : ''} aria-hidden={s === shown ? undefined : true}
    onLoad={() => setLoaded((l) => new Set(l).add(s))} onError={() => setFailed(s)} style={s === shown ? style : { display: 'none' }} />)}</>;
}
