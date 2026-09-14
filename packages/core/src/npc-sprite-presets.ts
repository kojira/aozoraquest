import { encodeTileArt, type TileArtRecord } from './tile-art.js';

export const NPC_SPRITE_PRESET_IDS = ['boy', 'girl', 'young-man', 'young-woman', 'middle-aged-man', 'middle-aged-woman', 'old-man', 'old-woman'] as const;
export type NpcSpritePresetId = typeof NPC_SPRITE_PRESET_IDS[number];
export interface NpcSpritePreset { id: NpcSpritePresetId; name: string; frames: readonly [TileArtRecord, TileArtRecord] }

// Original front-facing villagers. Each row is 16 pixels, transparent outside the silhouette.
// E marks the eyes: the second drawing closes them without shifting the feet or the whole sprite.
const symbols = '.ohsEcabt';
function drawings(rows: string[], colors: string[]): readonly [TileArtRecord, TileArtRecord] {
  const pixels = Uint8Array.from(rows.join(''), (c) => symbols.indexOf(c));
  const blink = pixels.slice();
  rows.join('').split('').forEach((c, i) => { if (c === 'E') blink[i] = symbols.indexOf('a'); });
  const palette = ['', '#302b37', ...colors.slice(0, 5), colors[6]!, colors[7]!];
  return [encodeTileArt({ size: 16, palette, pixels }), encodeTileArt({ size: 16, palette, pixels: blink })];
}
export const NPC_SPRITE_PRESETS: readonly NpcSpritePreset[] = [
  { id: 'boy', name: '男の子', frames: drawings([
    '................','................','......oooo......','.....ohhhho.....',
    '....ohhhhhho....','....ohssssho....','.....sEssEs.....','.....osssso.....',
    '......ossa......','.....occcco.....','....socccccos...','....soaccaso....',
    '.....obbbbo.....','.....ob..bo.....','.....ot..to.....','................',
  ], ['#65432f','#f0bd87','#302b37','#4e9ac7','#d39461','#e6c567','#455075','#563d36']) },
  { id: 'girl', name: '女の子', frames: drawings([
    '................','.....aa..aa.....','....ohhoohho....','....ohhhhhho....',
    '....ohssssho....','....ohEssEho....','....ohssssho....','.....oassao.....',
    '......ocao......','.....occcco.....','....socccccos...','....soccccso....',
    '.....occcco.....','....oaccccao....','......s..s......','.....ot..to.....',
  ], ['#754235','#f3c598','#302b37','#d56583','#f4ba68','#f3ddac','#68395a','#613f3a']) },
  { id: 'young-man', name: '若い男性', frames: drawings([
    '......oooo......','.....ohhhho.....','....ohhhhhho....','....ohssssho....',
    '.....sEssEs.....','.....osssso.....','......ossa......','.....ocbbco.....',
    '....occbbbcco...','....occbbbcco...','....socbbcos....','....socaaacos...',
    '.....obbbbo.....','.....ob..bo.....','.....ob..bo.....','....ott..tto....',
  ], ['#343943','#dfae80','#302b37','#448c84','#bd8857','#dab564','#3f5572','#4c3941']) },
  { id: 'young-woman', name: '若い女性', frames: drawings([
    '......oooo......','.....ohhhho.....','....ohhhhhho....','....ohssssho....',
    '....ohEssEho....','....ohssssho....','....ohassaho....','....ohcbbcho....',
    '....ohcbbcho....','....osccccso....','....osccccso....','.....occcco.....',
    '.....obbbbo.....','.....obbbbo.....','......s..s......','.....ot..to.....',
  ], ['#493849','#ecc09a','#302b37','#a57abe','#c8916c','#f6d080','#565677','#4c3941']) },
  { id: 'middle-aged-man', name: '中年男性', frames: drawings([
    '......oooo......','.....ohhhho.....','....ohsssshso...','....osssssso....',
    '....osEssEso....','....oshaahhso...','.....oshhso.....','....oaccccao....',
    '...occcbbccco...','...occcbbccco...','...soccaaccos...','...socccccccos..',
    '....obbbbbbo....','.....ob..bo.....','.....ob..bo.....','....ott..tto....',
  ], ['#705348','#dda77c','#302b37','#b37c45','#b6815d','#ead9a1','#465063','#493a34']) },
  { id: 'middle-aged-woman', name: '中年女性', frames: drawings([
    '.......ooo......','......ohhho.....','.....ohhhho.....','....ohhhhhho....',
    '....ohssssho....','.....sEssEs.....','.....osssso.....','....oaccccao....',
    '...occaaaacco...','...occaaaacco...','...socaaaacos...','...socaaaacos...',
    '....ocaaaaco....','....occcccco....','.....os..so.....','.....ot..to.....',
  ], ['#593c35','#e6b088','#302b37','#4a8b70','#f0dbae','#dfae86','#425b53','#473a38']) },
  { id: 'old-man', name: 'おじいちゃん', frames: drawings([
    '......oooo......','.....ohssho.....','....ohssssho....','....ohssssho....',
    '.....sEssEs.....','.....oshhso.....','.....ohhhho.....','......ohho......',
    '.....occcco..tt.','....occbccco.to.','....socccccos.to','....socaaacos.to',
    '.....occcco..to.','.....obbbbo..to.','.....ob..bo..to.','....ott..tto.to.',
  ], ['#e7e0d4','#dab590','#302b37','#796a9d','#b99973','#eddbb2','#4b4c65','#896544']) },
  { id: 'old-woman', name: 'おばあちゃん', frames: drawings([
    '.......ooo......','......ohhho.....','.....ohhhho.....','....ohhhhhho....',
    '....ohssssho....','....ohEssEho....','.....osssso.....','....oaaassaaao..',
    '...oaaaccaaao...','...ocaaaaacco...','...soccaaccos...','....soccccso....',
    '.....occcco.....','....occcccco....','.....os..so.....','.....ot..to.....',
  ], ['#eee7da','#dfb994','#302b37','#a3667b','#e6cfa5','#ecdcbc','#665163','#50423e']) },
];
export function npcSpritePreset(id: NpcSpritePresetId): NpcSpritePreset {
  return NPC_SPRITE_PRESETS.find((preset) => preset.id === id)!;
}
