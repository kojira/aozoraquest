/**
 * 16 archetype × 2 バリエーションの背景イラスト生成 prompt。
 * Gemini 3.1 Flash Image Preview に投げる前に STYLE_PREFIX と結合する。
 *
 * 狙い: セピア線画 + 羊皮紙質感 + 中世写本ムードで全 16 を統一する (スタイル
 * プレフィクスは固定)。モチーフは各 archetype の dominant / auxiliary function
 * と JOB_TAGLINES をベースに選定。
 */

/** packages/core/src/types.ts の ARCHETYPES と一致させる。 */
export const ARCHETYPES = [
  'sage', 'mage', 'shogun', 'bard',
  'seer', 'poet', 'paladin', 'explorer',
  'warrior', 'guardian', 'fighter', 'artist',
  'captain', 'miko', 'ninja', 'performer',
] as const;
export type Archetype = (typeof ARCHETYPES)[number];

/** packages/core/src/jobs.ts の JOB_TAGLINES と同期。 */
export const JOB_TAGLINES: Record<Archetype, string> = {
  sage:      '遠くを見通す戦略家',
  mage:      '仕組みを解く研究者',
  shogun:    '結果で示す指揮官',
  bard:      '言葉で場を動かす即興家',
  seer:      '静かに先を読む語り部',
  poet:      '自分の美で形を彫る',
  paladin:   '義を貫く守護者',
  explorer:  '未踏を楽しむ旅人',
  warrior:   '反復で鍛える堅実型',
  guardian:  '身近な人を守り続ける',
  fighter:   '体で覚え理で磨く',
  artist:    '感性を形に残す',
  captain:   '組織を回す実務家',
  miko:      '場を整え寄り添う',
  ninja:     '一瞬の見切りで決める',
  performer: '運と勘で生きる',
};

export const JOB_NAMES: Record<Archetype, string> = {
  sage: '賢者', mage: '魔法使い', shogun: '将軍', bard: '吟遊詩人',
  seer: '予言者', poet: '詩人', paladin: '聖騎士', explorer: '冒険者',
  warrior: '戦士', guardian: '守護者', fighter: '武闘家', artist: '芸術家',
  captain: '隊長', miko: '巫女', ninja: '忍者', performer: '遊び人',
};

export const STYLE_PREFIX = [
  'A trading card artwork, portrait orientation.',
  'Sepia ink line drawing on aged parchment, medieval illuminated manuscript style.',
  'Limited palette: varied sepia browns plus one muted accent color, no bright saturation.',
  'Aged paper with fiber texture, subtly burnt corners, gentle vignetting.',
  'Confident linework with weight variation, sparse cross-hatching for shadows.',
  'No photorealism, no modern elements, no visible borders or frames, no lettering or text, no captions.',
  'Single central composition with breathing negative space so text can sit around it later.',
  'Subject:',
].join('\n');

/** archetype ごとの 2 バリエーション (同じジョブで印象を変えた 2 題材)。 */
export const MOTIFS: Record<Archetype, [string, string]> = {
  sage: [
    'A solitary sage in a tower study, gazing at a large celestial globe by candlelight, surrounded by parchment scrolls.',
    'A strategist overlooking a vast topographic map on a stone table, a single raven perched nearby.',
  ],
  mage: [
    'A scholar examining a faceted crystal that casts geometric light patterns across inked diagrams.',
    "An alchemist's study with floating annotated scrolls, a bubbling still, geometric constellations in the air.",
  ],
  shogun: [
    'A commander on a mountaintop fortress holding a tattered banner against the wind, armies distant below.',
    'A leader at the head of a disciplined formation, gesturing forward across a broad plain at dawn.',
  ],
  bard: [
    'A traveling bard at a crossroad playing an ornate stringed instrument, sketches of listeners in the margins.',
    'A storyteller before a rapt crowd, symbolic shapes curling from the mouth like drifting smoke.',
  ],
  seer: [
    'A veiled pilgrim pointing at a constellation above a quiet shrine, a prayer rope in hand.',
    'A hooded oracle reading patterns in the flickering shadows cast by a low brazier.',
  ],
  poet: [
    'A lone poet by a riverbank writing with a quill, a single wildflower resting beside the ink pot.',
    'A figure carving verses into stone beneath a gnarled cherry tree, petals scattered on the page.',
  ],
  paladin: [
    'A kneeling knight shielding a small campfire of villagers from an unseen storm, stave planted in earth.',
    'A guardian with a long staff standing at the gate of a hillside temple at twilight, banners fluttering.',
  ],
  explorer: [
    'A traveler at a fork of forest paths with darting fireflies, a walking stick and rolled map in hand.',
    'A wanderer on a high cliff edge facing unknown lands, a pack tied with curious trinkets.',
  ],
  warrior: [
    'A veteran blacksmith at a worn anvil, hammer mid-strike, sword blanks leaned against the stone wall.',
    'A seasoned soldier meticulously sharpening a blade in a quiet stone courtyard at first light.',
  ],
  guardian: [
    'A keeper tending a large hearth in an old inn, a kettle warming, worn book open on a table.',
    'A caring figure at the doorway of a cottage welcoming small children home, lantern lit.',
  ],
  fighter: [
    'A martial artist practicing forms at dawn in a wooden dojo, training tools arranged with precision.',
    "A lone swordsman analyzing a blade's curvature, scrolls of stance diagrams pinned to a timber wall.",
  ],
  artist: [
    'A painter lost in work among half-finished canvases stacked in a sunlit studio, pigments on the floor.',
    'A stone carver in a sunlit garden shaping marble, chisels laid out on mossy flagstones.',
  ],
  captain: [
    "A weathered captain at a ship's wheel with open charts, compass and spyglass on a nearby barrel.",
    'A seasoned foreman surveying terraced fields with instruments, laborers in the distance.',
  ],
  miko: [
    'A shrine maiden arranging seasonal flowers for a small ritual, a bell cord hanging nearby.',
    'A caretaker preparing a welcoming table with paper lanterns, woven cushions around.',
  ],
  ninja: [
    'A masked figure mid-leap between rooftops under a crescent moon, cloth trailing like ink strokes.',
    'A lone hunter drawing a bow, frozen in the final moment before the release, reeds bowed by breath.',
  ],
  performer: [
    'A dancer mid-twirl in a festival square, scattered flower petals and confetti swirling outward.',
    "A performer on a simple stage under paper lanterns, a juggler's props in motion above.",
  ],
};

export function promptFor(archetype: Archetype, variant: 1 | 2): string {
  const motif = MOTIFS[archetype][variant - 1];
  return `${STYLE_PREFIX}\n${motif}`;
}
