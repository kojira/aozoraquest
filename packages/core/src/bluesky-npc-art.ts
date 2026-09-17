import { encodeTileArt, type TileArtRecord } from './tile-art.js';

// Blueskyちゃん: reference-inspired sky hair/curl, broad green hat and pale tunic.
// 32px art uses the existing renderer; the shared head never blinks or bobs.
const symbols = '.ohbHCOgGlspmntB';
const palette = ['', '#304759', '#507b9c', '#80b1cc', '#bbdfe6', '#e5f5ef', '#4c683f', '#719d4b', '#b6d48a', '#e7f1cc', '#fff0df', '#e9b5b3', '#bd748a', '#344e77', '#567599', '#233449'];
const head = [
  '...........OOOOOOOO.............',
  '..........OllllllllO............',
  '........OOlCCCCCCClllO..........',
  '.......OllCCCCCCCCClllO.........',
  '.......OClllllllllllglO.........',
  '......OglllllllllllggglO........',
  '......OgggggggggggllllgO........',
  '....OOOGGGGGGGgggggggggOO.......',
  '...OOGllllllGGGGGGGGGGggOOOOO...',
  '..OGllGGGOOOOOOOOOOOGGGGGGGGGG..',
  '...GGGGOohHCChhhHhhbbbHOGGGGGGO.',
  '...OOOO.hhHHHHHhhhhHHHbhOOOGOO..',
  '.......ohhHHHHhssshhHbHHhOOOO...',
  '.......hhhHhhhssssshHHHhho......',
  '......ohhbhssosssssohhhhho......',
  '......oHHbosososssososobho......',
  '......oCCCoppsssssssppobho......',
  '......oHHboosssmmmssssobho......',
  '......oHHbbbosssssssoobbho......',
  '......oohbbbhlOlOOloobbbho......',
];
const steps = [[
  '......oohoobOllllllOhbbbho......',
  '......oohsoOlCClllllOoobho......',
  '.....oohosoOlCClllllOpobhho.....',
  '.....oohbssollllllllopobHHo.....',
  '....oohbhssoGllllllGopobbHHo....',
  '......ooooOGGGGGGGGGGohhhbhho...',
  '.......o...OOGGGGGGOO.oooohooo..',
  '............ntttnnnn..ooooooo...',
  '............nnnnnnnn.......o....',
  '............ss....pp............',
  '............ttt...BBB...........',
  '...........BBBB.................',
], [
  '......oohbbbOllllllOhoobho......',
  '......oohooOlCClllllOsobho......',
  '.....oohbpoOlCClllllosobhho.....',
  '.....oohopoOllllllllOssoHHo.....',
  '....oohbopoOGllllllGOssobHHo....',
  '......ooooOGGGGGGGGGGOhhhbhho...',
  '.......o...OOGGGGGGOO.oooohooo..',
  '............ntttnnnn..ooooooo...',
  '............nnnnnnnn.......o....',
  '............pp....ss............',
  '............BBB...ttt...........',
  '.................BBBB...........',
]];
export const BLUESKY_NPC_FRAMES: readonly [TileArtRecord, TileArtRecord] = [frame(0), frame(1)];
function frame(pose: number): TileArtRecord {
  return encodeTileArt({ size: 32, palette,
    pixels: Uint8Array.from([...head, ...steps[pose]!].join(''), (c) => symbols.indexOf(c)),
  });
}
