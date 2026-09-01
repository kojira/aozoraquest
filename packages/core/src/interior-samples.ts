/**
 * **同梱の内部マップ** (#424)。最初の街「ふたばの村」の中。
 *
 * 内部マップを 1 つも作っていない状態からだと、エディタで手で塗るところから始まって重い。
 * **入って歩ける村**を 1 つ同梱し、そこから直せるようにする。
 *
 * 広さは **32×32**。最初は 64×64 で作ったが、最初の街としては歩かされる距離が長く、
 * 宿屋となんでも屋を往復するだけで間延びした (実機で指摘)。半分にして、入口から
 * 数歩で看板が見える密度にしている。
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
import type { NpcDef } from './npc-data.js';
import type { WorldPart } from './world-map.js';

export const STARTER_TOWN_ID = 'futaba-village';
export const STARTER_TOWN_SIZE = 32;

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
export const STARTER_TOWN_INN = { x: 8, y: 10, price: 3, name: 'ふたばの宿' };
/** なんでも屋の扉。ここに入ると店が開く。 */
export const STARTER_TOWN_SHOP = { x: 23, y: 10 };
/** フィールドから入ったときの降り立つ場所 (村の南の通り)。端から数歩内側に置く —
 *  端に降ろすと入った瞬間に外へ出てしまう。 */
export const STARTER_TOWN_ENTRANCE = { x: 15, y: 28 };

/**
 * 32×32 の村を組み立てる。**手で塗ったタイルを埋め込むより、組み立てる**
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

  // 目抜き通り (縦)。入口から北へまっすぐ伸ばし、道なりに行けば店の前に出る。
  rect(15, 2, 2, S - 3, PATH);
  // 建物の前を通る東西の道 (宿屋 ⇄ なんでも屋)。扉の 1 段下を通す。
  rect(4, 11, S - 8, 1, PATH);
  // 広場へ抜ける横道。
  rect(4, 17, S - 8, 1, PATH);

  // 中央の広場と井戸。**目印になるもの**を置いて、歩いた実感が出るようにする。
  rect(12, 18, 8, 5, PATH);
  set(15, 20, WELL); set(16, 20, WELL);

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

  // 宿屋 (西) と なんでも屋 (東)。目抜き通りを挟んで向かい合わせに置き、
  // 入口から北へ歩くと**両方の看板が同時に視界に入る**ようにする。
  building(6, 6, 6, 5, 2, INN_SIGN); // 扉 (8, 10)
  building(20, 6, 6, 5, 3, SHOP_SIGN); // 扉 (23, 10)

  // ふつうの家。看板なし。
  building(2, 13, 5, 4, 2);
  building(25, 13, 5, 4, 2);
  building(3, 24, 5, 4, 2);
  building(10, 24, 5, 4, 2);
  building(18, 24, 5, 4, 2);
  building(25, 24, 5, 4, 2);

  // 目印: 花壇・柵・木を散らす (一面の草地だと動いた実感が無い)。
  rect(3, 19, 4, 3, FLOWER);
  rect(25, 19, 4, 3, FLOWER);
  rect(9, 21, 3, 1, FENCE);
  rect(20, 21, 3, 1, FENCE);
  for (const [x, y] of [[4, 4], [27, 4], [12, 14], [19, 14], [7, 30], [24, 30]]) {
    set(x!, y!, TREE);
  }

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

/**
 * **同梱の村人** (#656)。宿屋となんでも屋だけでは人がいない村になるので、
 * 話しかけられる村人を数人置く。`/admin/npcs` の「ふたばの村の村人を入れる」で差し込み、
 * id が同じものは置き換える (村を直したときに入れ直せる)。
 *
 * id は固定クエストの発注元 (`GameQuestDef.npcId`) として参照されるので**変えない**。
 *
 * 位置は `buildStarterTownTiles` の地形に合わせる: 歩けるマス / 施設 (宿屋・店・入口) の
 * 無いマス / 村の端 (歩けば外へ出る外周) でないマス / 幅 1 の道 (y=11, y=17) の上でない
 * マス (道の上に立つと通せんぼになる)。テストで固定する。
 *
 * セリフは既存 UI (チュートリアル・宿屋・なんでも屋) と用語を合わせる。宿代は
 * `STARTER_TOWN_INN.price` から作る (数値を二重に持たない)。
 */
export function starterTownNpcs(): NpcDef[] {
  const mapId = STARTER_TOWN_ID;
  return [
    {
      // 広場の井戸のそば。村の顔。
      id: 'futaba-elder', name: 'むらおさ', mapId, x: 14, y: 21,
      lines: [
        'ようこそ ふたばの村へ。わしが この村の むらおさじゃ。',
        '村の そとには スライムが 出る。むりは するなよ。',
      ],
    },
    {
      // 宿屋の扉の右下 (東西の道は塞がない)。
      id: 'futaba-innkeeper-wife', name: 'やどやの おかみ', mapId, x: 9, y: 12,
      lines: [
        `やどやは ひとばん パワー ${STARTER_TOWN_INN.price} で とまれるよ。HP も MP も ぜんかいさ。`,
        'つかれたら いつでも おいで。',
      ],
    },
    {
      // なんでも屋の扉の左下。
      id: 'futaba-shopfront', name: 'なんでも屋の むすめ', mapId, x: 22, y: 12,
      lines: [
        'なんでも屋は 素材と あおぞらパワーで そうびを つくってくれるよ。',
        'いらない素材は ひきとって パワーに かえてくれるんだ。',
      ],
    },
    {
      // 入口 (南の通り) のそば。降り立ってすぐ会う。
      id: 'futaba-kid', name: 'こども', mapId, x: 17, y: 29,
      lines: [
        '村の はしまで あるくと そとに 出られるよ。',
        // 敗北時は素材を少し失う (`rollDefeatLoss`)。「戻されるだけ」と言うと嘘になる。
        'まけると さいごに たちよった 街まで もどされるんだって。もちものも すこし おとすらしい。',
      ],
    },
    {
      // 西の家の前。
      id: 'futaba-oldman', name: 'おじいさん', mapId, x: 5, y: 18,
      lines: [
        '街に つくと「ちずのかけら」が 手に はいって、ちずが ひろがるそうじゃ。',
        '🗺 ちずボタンで いつでも たしかめられるぞい。',
      ],
    },
  ];
}

/**
 * **村人を入れられる村か** (#656)。入れられなければ理由 (エディタがそのまま出す)。
 *
 * 村人の位置は同梱の 32×32 の地形に合わせてあるので、旧版 (64×64) の村レコードが
 * 残っている環境に入れると、おかみが壁の中に立つ (保存は通ってしまう — 施設と
 * 範囲しか見ない)。大きさが違う村には入れさせず、先に村を入れ直させる。
 */
export function starterTownNpcsPlacementError(village: Pick<InteriorMap, 'size'> | undefined): string | null {
  if (!village) return '「ふたばの村」がまだ無い。先に内部マップで「はじまりの村を入れる」→ 保存';
  if (village.size !== STARTER_TOWN_SIZE) {
    return `「ふたばの村」が旧版 (${village.size}×${village.size})。先に内部マップで「はじまりの村を入れる」で入れ直して 保存してから`;
  }
  return null;
}
