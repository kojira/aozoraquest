import { encodeTileArt, type TileArtRecord } from './tile-art.js';
import { BLUESKY_NPC_FRAMES } from './bluesky-npc-art.js';

export const NPC_SPRITE_PRESET_IDS = ['boy', 'girl', 'young-man', 'young-woman', 'middle-aged-man', 'middle-aged-woman', 'old-man', 'old-woman', 'bluesky'] as const;
export type NpcSpritePresetId = typeof NPC_SPRITE_PRESET_IDS[number];
export interface NpcSpritePreset { id: NpcSpritePresetId; name: string; frames: readonly [TileArtRecord, TileArtRecord] }

// Original front-facing villagers: a fixed head and two opposite arm/leg poses.
// Each frame stays in the same 16×16 cell; only the hand-drawn limbs take a step.
const symbols = '.ohsEcabt';
function drawings(head: string[], steps: [string[], string[]], colors: string[]): readonly [TileArtRecord, TileArtRecord] {
  const palette = ['', '#302b37', ...colors.slice(0, 5), colors[6]!, colors[7]!];
  const frame = (body: string[]) => encodeTileArt({
    size: 16, palette, pixels: Uint8Array.from([...head, ...body].join(''), (c) => symbols.indexOf(c)),
  });
  return [frame(steps[0]), frame(steps[1])];
}
export const NPC_SPRITE_PRESETS: readonly NpcSpritePreset[] = [
  { id: 'boy', name: '男の子', frames: drawings([
    '................','................','......oooo......','.....ohhhho.....',
    '....ohhhhhho....','....ohssssho....','.....sEssEs.....','.....osssso.....',
    '......ossa......',
  ], [[
    '....occcccco....','....ssccccco....','.....occccss....','.....obbbbo.....',
    '.....ob..bo.....','.....ob..tto....','....otto........',
  ], [
    '....occcccco....','....occcccss....','....sscccco.....','.....obbbbo.....',
    '.....ob..bo.....','....ott..bo.....','........otto....',
  ]], ['#65432f','#f0bd87','#302b37','#4e9ac7','#d39461','#e6c567','#455075','#563d36']) },
  { id: 'girl', name: '女の子', frames: drawings([
    '................','.....aa..aa.....','....ohhoohho....','....ohhhhhho....',
    '....ohssssho....','....ohEssEho....','....ohssssho....','.....oassao.....',
    '......ocao......',
  ], [[
    '....occcccco....','....ssccccco....','.....occccss....','.....occcco.....',
    '....oaccccao....','......s..to.....','.....oto........',
  ], [
    '....occcccco....','....occcccss....','....sscccco.....','.....occcco.....',
    '....oaccccao....','.....ot..s......','........oto.....',
  ]], ['#754235','#f3c598','#302b37','#d56583','#f4ba68','#f3ddac','#68395a','#613f3a']) },
  { id: 'young-man', name: '若い男性', frames: drawings([
    '......oooo......','.....ohhhho.....','....ohhhhhho....','....ohssssho....',
    '.....sEssEs.....','.....osssso.....','......ossa......','.....ocbbco.....',
    '....occbbbcco...',
  ], [[
    '....occbbbcco...','....sscbbcco....','.....ocaaass....','.....obbbbo.....',
    '.....ob..bo.....','.....ob..tto....','....otto........',
  ], [
    '...occbbbcco....','....occbbcss....','....ssaaaco.....','.....obbbbo.....',
    '.....ob..bo.....','....ott..bo.....','........otto....',
  ]], ['#343943','#dfae80','#302b37','#448c84','#bd8857','#dab564','#3f5572','#4c3941']) },
  { id: 'young-woman', name: '若い女性', frames: drawings([
    '......oooo......','.....ohhhho.....','....ohhhhhho....','....ohssssho....',
    '....ohEssEho....','....ohssssho....','....ohassaho....','....ohcbbcho....',
    '....ohcbbcho....',
  ], [[
    '....occcccco....','....ssccccco....','.....occccss....','.....obbbbo.....',
    '.....obbbbo.....','......s..to.....','.....oto........',
  ], [
    '....occcccco....','....occcccss....','....sscccco.....','.....obbbbo.....',
    '.....obbbbo.....','.....ot..s......','........oto.....',
  ]], ['#493849','#ecc09a','#302b37','#a57abe','#c8916c','#f6d080','#565677','#4c3941']) },
  { id: 'middle-aged-man', name: '中年男性', frames: drawings([
    '......oooo......','.....ohhhho.....','....ohsssshso...','....osssssso....',
    '....osEssEso....','....oshaahhso...','.....oshhso.....','....oaccccao....',
    '...occcbbccco...',
  ], [[
    '...occcbbccco...','...ssccaaccco...','....occccccss...','....obbbbbbo....',
    '.....ob..bo.....','.....ob..tto....','....otto........',
  ], [
    '...occcbbccco...','...occcaaccss...','...sscccccco....','....obbbbbbo....',
    '.....ob..bo.....','....ott..bo.....','........otto....',
  ]], ['#705348','#dda77c','#302b37','#b37c45','#b6815d','#ead9a1','#465063','#493a34']) },
  { id: 'middle-aged-woman', name: '中年女性', frames: drawings([
    '.......ooo......','......ohhho.....','.....ohhhho.....','....ohhhhhho....',
    '....ohssssho....','.....sEssEs.....','.....osssso.....','....oaccccao....',
    '...occaaaacco...',
  ], [[
    '...occaaaacco...','...sscaaaacco...','....ocaaaacss...','....ocaaaaco....',
    '....occcccco....','.....os..to.....','.....oto........',
  ], [
    '...occaaaacco...','...occaaaacss...','...sscaaaaco....','....ocaaaaco....',
    '....occcccco....','.....ot..so.....','........oto.....',
  ]], ['#593c35','#e6b088','#302b37','#4a8b70','#f0dbae','#dfae86','#425b53','#473a38']) },
  { id: 'old-man', name: 'おじいちゃん', frames: drawings([
    '......oooo......','.....ohssho.....','....ohssssho....','....ohssssho....',
    '.....sEssEs.....','.....oshhso.....','.....ohhhho.....','......ohho......',
    '.....occcco..tt.',
  ], [[
    '....occbccco.to.','....ssccccco.to.','.....ocaaass.to.','.....occcco..to.',
    '.....obbbbo..to.','.....ob..tto.to.','....otto.....to.',
  ], [
    '....occbccco.to.','....occcccss.to.','....ssaaaco..to.','.....occcco..to.',
    '.....obbbbo..to.','....ott..bo..to.','........otto.to.',
  ]], ['#e7e0d4','#dab590','#302b37','#796a9d','#b99973','#eddbb2','#4b4c65','#896544']) },
  { id: 'old-woman', name: 'おばあちゃん', frames: drawings([
    '.......ooo......','......ohhho.....','.....ohhhho.....','....ohhhhhho....',
    '....ohssssho....','....ohEssEho....','.....osssso.....','....oaaassaaao..',
    '...oaaaccaaao...',
  ], [[
    '...ocaaaaacco...','...ssccaacco....','.....occccss....','.....occcco.....',
    '....occcccco....','.....os..to.....','.....oto........',
  ], [
    '...ocaaaaacco...','....occaaccss...','....sscccco.....','.....occcco.....',
    '....occcccco....','.....ot..so.....','........oto.....',
  ]], ['#eee7da','#dfb994','#302b37','#a3667b','#e6cfa5','#ecdcbc','#665163','#50423e']) },
  { id: 'bluesky', name: 'Blueskyちゃん', frames: BLUESKY_NPC_FRAMES },
];
export function npcSpritePreset(id: NpcSpritePresetId): NpcSpritePreset {
  return NPC_SPRITE_PRESETS.find((preset) => preset.id === id)!;
}
