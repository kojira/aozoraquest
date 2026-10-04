import type { BattleState } from '@aozoraquest/core';
import type { StickDir } from '@/components/virtual-stick';
import type { ServerBattleState } from '@/lib/world-server';

/**
 * あおぞらワールド (docs/19-overworld.md) の画面共通の定数と型。
 *
 * - 16×16 ビューポート、1 タップ 1 マス、トーラス wrap。
 */
export const VIEW = 16;
export const HALF = VIEW / 2;
export const TILE = 32;

export type Dir = StickDir; // 仮想スティックと同一の 4 方向
export const DIRS: Record<Dir, { dx: number; dy: number }> = {
  up: { dx: 0, dy: -1 },
  down: { dx: 0, dy: 1 },
  left: { dx: -1, dy: 0 },
  right: { dx: 1, dy: 0 },
};

// **ラベルは danger でなく tier から引く** (#536)。danger は 0..7 だが遭遇に使う tier は
// `MAX_POPULATED_TIER` までにクランプされるので、danger をそのまま言葉にすると
// 「とても危険」と「危険」で出る敵が 1 体残らず同じ、という嘘の見出しになる。逆に
// danger を 2 段階ずつ畳むと、唯一実在する難易度の壁 (tier2→tier3) がラベルの内側に
// 隠れてしまう (spawn から 3 歩の距離に、同じ語をまたぐ 16 倍の崖ができていた)。
// tier から引けば表示と実態が定義上ずれず、敵を足して帯が解放されれば語も自動で増える。
const DANGER_LABELS = ['おだやか', 'すこし危険', '危険', 'とても危険'] as const;
export const dangerLabel = (tier: number) =>
  DANGER_LABELS[Math.min(DANGER_LABELS.length - 1, Math.max(0, tier - 1))];

/** サーバーの ServerBattleState を描画用 BattleState として扱う (seed は実行時に存在しない = UI 未使用)。 */
export const asBattleState = (s: ServerBattleState): BattleState => s as unknown as BattleState;

export interface Vitals {
  /** 今いるマップ (#424)。省略 = フィールド。内部マップ (街の中・城) では id が入る。 */
  mapId?: string;
  x: number;
  y: number;
  /** null = 全快 (最大値はジョブ/レベルから導出) */
  hp: number | null;
  mp: number | null;
  lastTown: { x: number; y: number } | null;
  /** ちずのかけらで解禁済みのリージョン (世界地図の開示範囲) */
  regions: number[];
  /** 訪れたことのある街 (そらのはねの行き先候補) */
  visitedTowns: { x: number; y: number }[];
  /** 初回に そらのはねを 1 個もらったか */
  gotStarterFeather: boolean;
}

/** 「自分タップでコマンド」コーチマークを出したか。操作 UI が不可視 (スティックも
 *  コマンドもタップ起動) なので、オンボーディングを読み飛ばしても実際にマップへ
 *  立ったとき 1 回だけ操作を思い出させる。一度メニューを開くと消える。 */
export const MENU_HINT_DONE_KEY = 'aq-world-menu-hint-done';
