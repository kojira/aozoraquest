/**
 * **同梱の内部マップ** (#424)。最初の街「ふたばの村」の中。
 *
 * 内部マップを 1 つも作っていない状態からだと、エディタで 64×64 を手で塗るところから
 * 始まって重い。**入って歩ける村**を 1 つ同梱し、そこから直せるようにする。
 *
 * ## 専用パーツで組む
 *
 * 最初はフィールドのパーツを流用したが、**道が橋・家が街・壁が山**に見えて破綻した
 * (実機で指摘)。内部専用の絵 (`interior-art-data`) を専用の地形名で引く。
 * `part:<index>` はフィールドと番号空間を共有するので、内部で番号を振ると
 * フィールドの絵が出てしまう — 名前で引くのが要点。
 *
 * 建物は 1 マス 16×16 なので 1 枚絵にできない。**屋根・壁・扉を積んで組み**、
 * 宿屋となんでも屋は扉の上に看板を置いて見分けられるようにする。
 *
 * ## 「動いているか分からない」対策
 *
 * 一面の草地だと歩いても画面が変わらず、動いているか不安になる (実機で指摘)。
 * 井戸・柵・花壇・木を散らして、どこにいるか分かる目印を作る。
 */
import type { Gate, InteriorMap } from './interior.js';
import type { WorldPart } from './world-map.js';

export const STARTER_TOWN_ID = 'futaba-village';
export const STARTER_TOWN_SIZE = 64;

/** パーツ番号 (この村のパーツ表の並び)。絵は terrain 名で引く。 */
const GRASS = 0;
const PATH = 1;
const WALL = 2;
const ROOF = 3;
const HWALL = 4;
const DOOR = 5;
const INN_SIGN = 6;
const SHOP_SIGN = 7;
const WELL = 8;
const FENCE = 9;
const FLOWER = 10;
const TREE = 11;

/** 村のパーツ表。**専用の地形名**で絵を引く (フィールドの番号空間と混ざらない)。 */
const PARTS: WorldPart[] = [
  { terrain: 'plains', name: 'くさち', walkable: true },
  { terrain: 'floor-stone', name: 'いしだたみ', walkable: true },
  { terrain: 'wall-brick', name: 'いしのかべ', walkable: false },
  { terrain: 'roof', name: 'やね', walkable: false },
  { terrain: 'house-wall', name: 'いえのかべ', walkable: false },
  { terrain: 'door', name: 'とびら', walkable: true },
  { terrain: 'sign-inn', name: 'やどやのかんばん', walkable: false },
  { terrain: 'sign-shop', name: 'なんでも屋のかんばん', walkable: false },
  { terrain: 'well', name: 'いど', walkable: false },
  { terrain: 'fence', name: 'さく', walkable: false },
  { terrain: 'flowers', name: 'かだん', walkable: true },
  { terrain: 'forest', name: 'き', walkable: false },
];

/** 宿屋の扉。ここに入ると あおぞらパワーを払って全回復する。 */
export const STARTER_TOWN_INN = { x: 21, y: 22, price: 3, name: 'ふたばの宿' };
/** なんでも屋の扉。ここに入ると店が開く。 */
export const STARTER_TOWN_SHOP = { x: 43, y: 22 };
/** フィールドから入ったときの降り立つ場所 (村の南の通り)。 */
export const STARTER_TOWN_ENTRANCE = { x: 32, y: 56 };
/**
 * @deprecated 端から出られるようにしたので使わない (#626)。
 * 保存済みのゲートとの互換のために残す。
 */
export const STARTER_TOWN_EXIT = { x: 32, y: 61 };

/**
 * 64×64 の村を組み立てる。**手で塗った 4096 タイルを埋め込むより、組み立てる**
 * ほうが読めて直せる (家を 1 軒足すのが 1 行)。
 */
export function buildStarterTownTiles(): Uint8Array {
  const S = STARTER_TOWN_SIZE;
  const t = new Uint8Array(S * S).fill(GRASS);
  const set = (x: number, y: number, v: number) => {
    if (x < 0 || y < 0 || x >= S || y >= S) return;
    t[y * S + x] = v;
  };
  const rect = (x0: number, y0: number, w: number, h: number, v: number) => {
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) set(x, y, v);
  };

  // **囲わない** (#626)。端まで歩けばフィールドへ出る (exitTo)。壁で囲って出口を
  // 1 マス探させるのはストレスが大きい。村の外縁は木立で「ここから先は外」と示す。
  for (let i = 2; i < S - 2; i += 4) {
    set(i, 1, TREE); set(i + 2, S - 2, TREE);
    set(1, i, TREE); set(S - 2, i + 2, TREE);
  }

  // 目抜き通り (縦) と広場へ抜ける横道。
  rect(30, 4, 4, S - 6, PATH);
  rect(6, 30, S - 12, 3, PATH);
  // 建物の前を通る東西の道 (宿屋・なんでも屋へ繋ぐ)。
  rect(6, 24, S - 12, 2, PATH);

  // 中央の広場と井戸。**目印になるもの**を置いて、歩いた実感が出るようにする。
  rect(26, 34, 12, 8, PATH);
  set(31, 37, WELL); set(32, 37, WELL);

  /**
   * 建物を 1 軒。**屋根 → 壁 → 扉**の順に積む。看板を渡すと扉の上に出る
   * (宿屋・なんでも屋の見分け)。扉は歩けるマスで、そこが入口になる。
   */
  const building = (x: number, y: number, w: number, h: number, doorDx: number, sign?: number) => {
    rect(x, y, w, 2, ROOF); // 屋根 2 段
    rect(x, y + 2, w, h - 2, HWALL); // 壁
    const dx = x + doorDx;
    set(dx, y + h - 1, DOOR); // 扉は最下段
    if (sign !== undefined) set(dx, y + h - 2, sign); // 看板は扉の真上
    rect(dx, y + h, 1, 1, PATH); // 玄関前の石畳
  };

  // 宿屋 (西) と なんでも屋 (東)。通りに面して看板を出す。
  building(18, 18, 8, 5, 3, INN_SIGN); // 扉 (21, 22)
  building(40, 18, 8, 5, 3, SHOP_SIGN); // 扉 (43, 22)

  // ふつうの家。看板なし。
  building(8, 8, 7, 5, 3);
  building(24, 8, 7, 5, 3);
  building(44, 8, 7, 5, 3);
  building(8, 44, 7, 5, 3);
  building(22, 44, 7, 5, 3);
  building(40, 44, 7, 5, 3);
  building(50, 34, 7, 5, 3);

  // 目印: 花壇・柵・木を散らす (一面の草地だと動いた実感が無い)。
  rect(6, 36, 5, 4, FLOWER);
  rect(52, 50, 6, 4, FLOWER);
  rect(14, 52, 8, 1, FENCE);
  rect(44, 30, 6, 1, FENCE);
  for (const [x, y] of [[5, 20], [5, 50], [58, 12], [58, 44], [12, 28], [50, 28], [26, 52], [38, 52]]) {
    set(x!, y!, TREE);
  }

  // 南の通りを端まで通す (どこからでも出られるが、道なりに行けば外に出ると分かる)。
  rect(30, S - 6, 4, 6, PATH);

  return t;
}

/** 同梱の村 (エディタから差し込む)。 */
export function starterTownInterior(town: { x: number; y: number }): InteriorMap {
  return {
    id: STARTER_TOWN_ID,
    name: 'ふたばの村',
    size: STARTER_TOWN_SIZE,
    tiles: buildStarterTownTiles(),
    parts: PARTS.map((p) => ({ ...p })),
    // 宿屋 (#624)。街に入るだけでは回復しなくなったので、回復はここで有料。
    inn: { ...STARTER_TOWN_INN },
    // なんでも屋 (#424)。品揃えはフィールドのふたばの村の店と同じ (座標で決まる)。
    // 座標だけを持つ (spawn は region/name も持つが、レコードに余計な値を残さない)。
    shop: { ...STARTER_TOWN_SHOP, town: { x: town.x, y: town.y }, name: 'ふたばの なんでも屋' },
    // **端まで歩いたらフィールドへ戻る** (#626)。街の 1 マス下に出す —
    // 街タイルに戻すと踏んだ瞬間にまた入ってしまう。
    exitTo: { mapId: 'world', x: town.x, y: town.y + 1 },
    // 街の中なので敵は出さない (encounterTier を設定しない)。
  };
}

/**
 * フィールドの街タイル ⇄ 村の入口 を繋ぐ**往復 2 本**。
 *
 * 戻り先をフィールドの街タイルにすると**踏んだ瞬間にまた入る**ので、街の 1 マス下に出す。
 */
export function starterTownGates(town: { x: number; y: number }): Gate[] {
  // 戻りは exitTo (端まで歩けば出る) が担うので、ゲートは**入る 1 本だけ**。
  return [
    { from: { mapId: 'world', x: town.x, y: town.y }, to: { mapId: STARTER_TOWN_ID, ...STARTER_TOWN_ENTRANCE } },
  ];
}
