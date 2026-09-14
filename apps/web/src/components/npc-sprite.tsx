import { decodeTileArt, npcArtKey, npcSpritePreset, tileArtFor, type NpcDef, type TileArt } from '@aozoraquest/core';
import { renderArt } from './world-tiles';
import './npc-sprite.css';

const frames = new Map<string, readonly TileArt[]>();
/** Shared appearance in the game, placement map and selection cards (32×32 SVG coordinates). */
export function NpcSprite({ npc, customArt = tileArtFor(npcArtKey(npc.id)) }: { npc: Pick<NpcDef, 'id' | 'spritePreset'>; customArt?: TileArt | null }) {
  if (npc.spritePreset) {
    let pair = frames.get(npc.spritePreset);
    if (!pair) {
      pair = npcSpritePreset(npc.spritePreset).frames.map(decodeTileArt);
      frames.set(npc.spritePreset, pair);
    }
    return <g className="npc-sprite" data-preset={npc.spritePreset}>
      <g className="npc-frame-0">{renderArt(pair[0])}</g>
      <g className="npc-frame-1">{renderArt(pair[1])}</g>
    </g>;
  }
  return renderArt(customArt ?? undefined) ?? <g>
    <circle cx={16} cy={11} r={6} fill="#f2c9a0" stroke="#7a5a3a" strokeWidth={1.5} />
    <path d="M8 28 q8 -12 16 0 Z" fill="#4a6fb3" stroke="#2e4a80" strokeWidth={1.5} />
  </g>;
}
