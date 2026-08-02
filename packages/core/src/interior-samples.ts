/**
 * **同梱の内部マップ** (#424)。最初の街「ふたばの村」の中。
 *
 * 内部マップを 1 つも作っていない状態からだと、エディタで 64×64 を手で塗るところから
 * 始まって重い。**入って歩ける村**を 1 つ同梱し、そこから直せるようにする。
 *
 * ## タイルは**フィールドのパーツ番号に合わせる**
 *
 * 絵は `part:<index>` → 地形名 の順で引かれる (`partArtFor`)。番号を
 * `BASE_PALETTE` と同じ並びにしておけば、フィールドで使っている絵がそのまま出る
 * (草地・木・池・岩・家・橋)。独自の番号を振ると絵の無いタイルになる。
 *
 * 通行だけは村用に上書きする — フィールドの「街」タイルは歩けるが、村の中では
 * **家は入れない壁**にしたい (中に入る導線はゲートで別途作る)。
 */
import type { Gate, InteriorMap } from './interior.js';
import type { WorldPart } from './world-map.js';

export const STARTER_TOWN_ID = 'futaba-village';
export const STARTER_TOWN_SIZE = 64;

/** タイル番号 (BASE_PALETTE と同じ並び)。 */
const GROUND = 0; // 草地 = 歩ける地面
const GROVE = 1; // 低い草。地面の変化づけ
const TREE = 2; // 木 (通れない)
const POND = 3; // 池 (通れない)
const ROCK = 5; // 岩・石垣 (通れない)
const HOUSE = 6; // 家 (通れない。絵はフィールドの街タイル)
const PATH = 7; // 道 (橋の絵を石畳として使う)

/**
 * 村のパーツ表。**通行だけ**をフィールドと変えている (家と木は入れない)。
 * terrain はフィールドと同じにしておく — 絵の探索が地形名に落ちるため。
 */
const PARTS: WorldPart[] = [
  { terrain: 'plains', name: 'じめん', walkable: true },
  { terrain: 'grove', name: 'くさむら', walkable: true },
  { terrain: 'forest', name: 'き', walkable: false },
  { terrain: 'pond', name: 'いけ', walkable: false },
  { terrain: 'water', name: 'みず', walkable: false },
  { terrain: 'mountain', name: 'いしがき', walkable: false },
  { terrain: 'town', name: 'いえ', walkable: false },
  { terrain: 'bridge', name: 'みち', walkable: true },
];

/** フィールドから入ったときの降り立つ場所 (村の南の通り)。 */
export const STARTER_TOWN_ENTRANCE = { x: 32, y: 59 };
/** フィールドへ戻るマス (南の石垣の内側)。**壁は開けない** — 出るのはここだけ。 */
export const STARTER_TOWN_EXIT = { x: 32, y: 61 };

/**
 * 64×64 の村を組み立てる。**手で塗った 4096 タイルを埋め込むより、組み立てる**
 * ほうが読めて直せる (家を 1 軒足すのが 1 行)。
 */
export function buildStarterTownTiles(): Uint8Array {
  const S = STARTER_TOWN_SIZE;
  const t = new Uint8Array(S * S).fill(GROUND);
  const set = (x: number, y: number, v: number) => {
    if (x < 0 || y < 0 || x >= S || y >= S) return;
    t[y * S + x] = v;
  };
  const rect = (x0: number, y0: number, w: number, h: number, v: number) => {
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) set(x, y, v);
  };

  // 外周は石垣で囲う。**外へ歩いて出られないようにする** (出るのはゲートだけ)。
  rect(0, 0, S, 2, ROCK);
  rect(0, S - 2, S, 2, ROCK);
  rect(0, 0, 2, S, ROCK);
  rect(S - 2, 0, 2, S, ROCK);

  // 村を囲む林 (石垣の内側)。奥行きを出しつつ、端に寄りすぎないようにする。
  for (let x = 3; x < S - 3; x++) {
    if (x % 3 !== 0) continue;
    set(x, 3, TREE);
    set(x, S - 4, TREE);
  }
  for (let y = 4; y < S - 4; y++) {
    if (y % 3 !== 0) continue;
    set(3, y, TREE);
    set(S - 4, y, TREE);
  }

  // 目抜き通り (縦) と 広場へ抜ける横道。石畳で導線を示す。
  rect(30, 6, 4, S - 8, PATH); // 南の石垣ぎわ (y=61) まで通す = 戻り口へ繋ぐ
  rect(8, 30, S - 16, 3, PATH);

  // 中央の広場と井戸がわりの池。
  rect(26, 26, 12, 11, PATH);
  rect(30, 29, 4, 4, POND);

  /** 家を 1 軒置く (左上から w×h)。前に石畳の踏み段を敷いて入口を示す。 */
  const house = (x: number, y: number, w = 5, h = 4) => {
    rect(x, y, w, h, HOUSE);
    rect(x + Math.floor(w / 2) - 1, y + h, 2, 1, PATH); // 玄関前
  };

  // 通りの西側 4 軒 / 東側 4 軒。広場を挟んで上下に分ける。
  house(18, 10); house(18, 18);
  house(18, 40); house(18, 48);
  house(40, 10); house(40, 18);
  house(40, 40); house(40, 48);
  // 村長の家 (少し大きい)。広場の北。
  house(28, 12, 8, 6);

  // 畑まわりのくさむら (歩ける。見た目の変化づけ)。
  rect(8, 8, 6, 8, GROVE);
  rect(50, 44, 6, 8, GROVE);

  // **石垣は開けない。** 開けると村の外 (マップの外) に立てるマスができる。
  // 出入りはゲートだけなので、戻り口のまわりを石畳にして「ここから出る」と分かるようにする。
  rect(STARTER_TOWN_EXIT.x - 1, STARTER_TOWN_EXIT.y - 1, 2, 2, PATH);

  return t;
}

/** 同梱の村 (エディタから差し込む)。 */
export function starterTownInterior(): InteriorMap {
  return {
    id: STARTER_TOWN_ID,
    name: 'ふたばの村',
    size: STARTER_TOWN_SIZE,
    tiles: buildStarterTownTiles(),
    parts: PARTS.map((p) => ({ ...p })),
    // 街の中なので敵は出さない (encounterTier を設定しない)。
  };
}

/**
 * フィールドの街タイル ⇄ 村の入口 を繋ぐ**往復 2 本**。
 *
 * 入る側はフィールドの街タイルそのもの、戻る側は村の入口の 1 マス下 (石垣の切れ目)。
 * 戻り先をフィールドの街タイルにすると**踏んだ瞬間にまた入る**ので、街の 1 マス下に出す。
 */
export function starterTownGates(town: { x: number; y: number }): Gate[] {
  return [
    { from: { mapId: 'world', x: town.x, y: town.y }, to: { mapId: STARTER_TOWN_ID, ...STARTER_TOWN_ENTRANCE } },
    { from: { mapId: STARTER_TOWN_ID, ...STARTER_TOWN_EXIT }, to: { mapId: 'world', x: town.x, y: town.y + 1 } },
  ];
}
