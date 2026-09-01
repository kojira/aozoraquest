/**
 * **同梱パーツプリセット** (#424 段階 1)。城とダンジョン入口。
 *
 * マップエディタの ＋パーツ から絵つきで追加できる。素の ＋パーツ は白紙から
 * ドット絵を描く必要があるが、城・ダンジョン入口は #424 (内部マップ) の入口として
 * 全ワールドで使う定番なので、描き起こし済みの絵を同梱する。追加後にエディタで
 * 描き直せば同梱の絵は上書きされる (tileArt レコードが勝つ)。
 *
 * どちらも **walkable: false** — ゲート遷移 (#424 段階 3) が入るまでは「まだ入れない」
 * 壁として振る舞う。ゲートは NPC バンプと同様に通行判定より先に効かせる設計なので、
 * 遷移が入っても walkable は false のままでよい。
 *
 * **palette[0] は透明 ('') に予約する** (terrain-art-data と同じエディタ規約)。
 */
import { decodeTileArt, type TileArt, type TileArtRecord } from './tile-art.js';

export interface PartPreset {
  /** WorldPart.name に入る表示名。 */
  name: string;
  /** 遭遇率・危険度の元になる地形 (BASE_PALETTE のもの)。 */
  terrain: string;
  walkable: boolean;
  /** 同梱のドット絵 (16×16)。 */
  art: TileArtRecord;
}

const CASTLE_ART: TileArtRecord = {
  size: 16,
  palette: ['', '#3f9d3f', '#358535', '#2b2b38', '#9aa0ad', '#c6cbd4', '#6a7080', '#20242e', '#7a4a26', '#4e2f16', '#d23c3c', '#3a3a46'],
  pixels:
    'AQEBAQEBAQsKCgoBAQEBAQEBAQEBAQELCgoBAQEBAQEBAQEBAwMDCwMDAwMBAQEBAQEBAQMFBAQEBAYDAQEBAQEBAQEDBAQHBwQGAwEBAQEDAwMDAwUEBAQEBgMDAwMDAwUEAwMEBAQEBAYDAwUEAwMEBwMDBAQEBAQGAwMEBwMDBAQDAwQEBAQEBgMDBAQDAwQEAwMEBwMDBwYDAwQEAwMEBAMDBAMICAMGAwMEBAMDBAQDAwQDCAkDBgMDBAQDAwYEAwMEAwgJAwYDAwYEAwMDAwMDAwMICQMDAwMDAwMCAQECAQEDAwMDAQECAQECAQECAQEBAQEBAQECAQEBAQ==',
};

const DUNGEON_ART: TileArtRecord = {
  size: 16,
  palette: ['', '#3f9d3f', '#358535', '#3a3026', '#8a7a64', '#b0a088', '#5c5044', '#14100c', '#241c14'],
  pixels:
    'AQEBAQEBAQEBAQEBAQECAQECAQEBAwMDAwMBAQEBAQEBAQEBAwUEBAQGAwEBAgEBAQEBAwUFBAQEBAYDAQEBAQEBAwUFBAQEBAQEBgMBAQEBAwUFBAQEBAQEBAYGAwEBAQMFBAQEAwMDAwQEBgMBAQMFBAQEAwgHBwgDBAYGAwEDBQQEAwgHBwcHCAMEBgMBAwQEBAMHBwcHBwcDBAYDAQMEBAMHBwcHBwcHBwMGAwEDBAQDBwcHBwcHBwcDBgMBAwYEAwcHBwcHBwcHAwYDAQMDAwMHBwcHBwcHBwMDAwMCAQECAwMDAwMDAwMBAQIBAQEBAQEBAQIBAQEBAQEBAQ==',
};

const VBRIDGE_ART: TileArtRecord = {
  size: 16,
  palette: ['', '#1e5fa8', '#2b74c4', '#7db8e8', '#4e2f16', '#7a4a26', '#a06a32', '#c08a4a'],
  pixels:
    'AQIBBAUGBgcGBgUEAQICAQIDAgQFBgYGBgYFBAIDAwIBAgEEBQcGBgYHBQQBAgIBAQEBBAUGBgYGBgUEAQEBAQEBAQQFBQUFBQUFBAEBAQEBAQEEBQYGBwYGBQQBAQEBAQICBAUGBgYGBgUEAQEBAQIDAwQFBwYGBgcFBAECAgEBAgIEBQYGBgYGBQQCAwMCAQEBBAUFBQUFBQUEAQICAQEBAQQFBgYHBgYFBAEBAQEBAQEEBQYGBgYGBQQBAQEBAQIBBAUHBgYGBwUEAQEBAQIDAgQFBgYGBgYFBAECAgEBAgEEBQUFBQUFBQQCAwMCAQEBBAUGBgcGBgUEAQICAQ==',
};

/** ＋パーツ のプリセット一覧。順序は UI の並び。 */
export const PART_PRESETS: readonly PartPreset[] = [
  { name: '城', terrain: 'mountain', walkable: false, art: CASTLE_ART },
  { name: 'ダンジョン入口', terrain: 'mountain', walkable: false, art: DUNGEON_ART },
  // 橋は縦横で絵が要るので縦専用を用意する。通れる。
  { name: 'たての橋', terrain: 'bridge', walkable: true, art: VBRIDGE_ART },
];

/**
 * 名前でプリセットを引く (#615)。**「同梱の絵に戻す」の戻し先**に使う —
 * たての橋のように「地形 (bridge) の既定の絵」とパーツの絵が別のものは、
 * 地形の既定に戻すと**横の橋になってしまう** (実際に起きた)。
 */
export function partPresetByName(name: string): PartPreset | undefined {
  return PART_PRESETS.find((p) => p.name === name);
}

/** プリセットの絵をメモリ形式に (エディタが setTileArt に渡す)。 */
export function presetArt(p: PartPreset): TileArt {
  return decodeTileArt(p.art);
}
