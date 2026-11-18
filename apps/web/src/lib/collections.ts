/**
 * このアプリが PDS に書き込む / 読み出す NSID の一元管理。
 *
 * 環境変数:
 *   - VITE_NSID_ROOT (必須): プロジェクト固有の NSID prefix。
 *       例: 本家 = "app.aozoraquest", fork = "com.example.myapp"
 *   - VITE_NSID_ENV (任意): 同一プロジェクト内で env を分離する印 (D-ENV-002。表は docs/22)。
 *       未指定 = 本番 "{ROOT}.{name}"。dev と local = "{ROOT}.dev.{name}" (local は dev エッジを叩くので
 *       dev と同じデータ)。自動テスト用の test / e2etest は user 記録を "{ROOT}.test.*" /
 *       "{ROOT}.e2etest.*" の隔離 sandbox に書く (dev にも本番にも触れない)。
 *       管理データ (world.* / config.* / directory) は未指定以外すべて "{ROOT}.dev.*"。
 *       **dev と本番で共有するデータは無い** (オーナー方針 2026-11-18)。他人の記録を読むときも
 *       自分の env の collection だけを読む (dev から本番の記録を読まない)。
 *
 * Cloudflare Workers Builds の build env vars に必ず設定する。
 * 未指定だと build を失敗させる (silent に誤デプロイするのを防ぐ)。
 *
 * 区分:
 *   - user 系 (各ユーザーの PDS) → COL
 *   - admin 系 (主管理者の PDS) → ADMIN_COL。world.* / config.* / directory も env で分ける。
 *
 * 注意:
 * - 実 Bluesky 投稿 (`app.bsky.feed.post`) は性質上分離不可、
 *   dev からの投稿も実投稿になる。
 */
import { ADMIN_WORLD_RECORDS, adminNsidPrefix, adminWorldCollection, directoryCollection, type AdminWorldRecordName } from '@aozoraquest/core';

const ROOT = (import.meta.env.VITE_NSID_ROOT as string | undefined)?.trim();
if (!ROOT) {
  throw new Error(
    'VITE_NSID_ROOT is required (e.g. "app.aozoraquest"). ' +
      'Set it in the Cloudflare Workers Builds env vars per project.',
  );
}
const ENV = (import.meta.env.VITE_NSID_ENV as string | undefined)?.trim();
/** 管理データの prefix。規則は core の adminNsidPrefix (edge の ADMIN_NSID_ENV と共通。#716)。 */
const ADMIN_PREFIX = adminNsidPrefix(ROOT, ENV);
/** user 記録の prefix (D-ENV-002)。local は dev エッジを叩くので dev と同じ (エッジは env で
 *  `.dev.analysis` などを読む)。test / e2etest は隔離 sandbox。 */
const USER_PREFIX = ENV === 'local' ? ADMIN_PREFIX : ENV ? `${ROOT}.${ENV}` : ROOT;

export const COL = {
  analysis: `${USER_PREFIX}.analysis`,
  profile: `${USER_PREFIX}.profile`,
  spiritChat: `${USER_PREFIX}.spiritChat`,
  questLog: `${USER_PREFIX}.questLog`,
  cardDraw: `${USER_PREFIX}.cardDraw`,
  /** あおぞらパワーの累積カウンタ (rkey='self')。アクションごとに増分する。
   *  初回読み取り時に旧データから一度だけスキャン → 書き込みでマイグレーション。 */
  power: `${USER_PREFIX}.power`,
  /** 戦闘記録 (1 戦 1 レコード)。旧ブルスコンの試練が書いていた履歴。試練撤去後は
   *  新規書き込み経路は無いが、読み取りは生きている: world の在庫フォールバック
   *  (loadBattleStats の materials) と パワー再スキャン (countBattles)。
   *  wins/連勝/称号系フィールドは現状どの UI からも未使用 (整理は #383)。 */
  battle: `${USER_PREFIX}.battle`,
  /** なんでも屋の制作 (docs/20)。1 制作 = 1 レコード。品質は rkey + luk から導出 */
  craft: `${USER_PREFIX}.craft`,
  /** 装備中 (docs/20 W6c)。rkey='self'。craft/forge の rkey 参照 (強化値は直書きしない) */
  gear: `${USER_PREFIX}.gear`,
  /** あおぞらワールドの状態 (docs/19-overworld.md)。rkey='self'。位置・乗り物・
   *  解禁リージョン。PR-W3 以降は Worker (DO) が正で、これは表示キャッシュ + 監査線。 */
  world: `${USER_PREFIX}.world`,
  /** 依頼クエスト (docs/15-user-quest.md)。tid key。発注者の PDS に書く。 */
  userQuest: `${USER_PREFIX}.userQuest`,
  /** 応募 (docs/15-user-quest.md)。tid key。応募者の PDS に書く。 */
  questApplication: `${USER_PREFIX}.questApplication`,
  /** 完了報告 / 承認 / やり直し依頼 (docs/15-user-quest.md)。tid key。 */
  questCompletion: `${USER_PREFIX}.questCompletion`,
} as const;

export const ADMIN_COL = {
  configFlags: `${ADMIN_PREFIX}.config.flags`,
  configMaintenance: `${ADMIN_PREFIX}.config.maintenance`,
  configBans: `${ADMIN_PREFIX}.config.bans`,
  configPrompts: `${ADMIN_PREFIX}.config.prompts`,
  /** 発見ディレクトリ。毎時の自動更新 (scripts/refresh-directory.ts) も env ごとに書く。 */
  directory: directoryCollection(ROOT, ENV),
  /** world.* (地形 #421・絵 #421・モンスター #419・アイテム #420・店 #422・NPC #425・
   *  クエスト #423・ジョブ #544・内部マップ #424・シナリオ #545)。名前は core の ADMIN_WORLD_RECORDS。 */
  worldMap: adminWorldCollection(ADMIN_PREFIX, 'map'),
  tileArt: adminWorldCollection(ADMIN_PREFIX, 'tileArt'),
  monsters: adminWorldCollection(ADMIN_PREFIX, 'monsters'),
  items: adminWorldCollection(ADMIN_PREFIX, 'items'),
  shops: adminWorldCollection(ADMIN_PREFIX, 'shops'),
  npcs: adminWorldCollection(ADMIN_PREFIX, 'npcs'),
  quests: adminWorldCollection(ADMIN_PREFIX, 'quests'),
  jobs: adminWorldCollection(ADMIN_PREFIX, 'jobs'),
  interiors: adminWorldCollection(ADMIN_PREFIX, 'interiors'),
  scenario: adminWorldCollection(ADMIN_PREFIX, 'scenario'),
  /** 依頼クエスト集約 (docs/15-user-quest.md §集約インフラ)。
   *  Worker が主管理者 PDS に書く。env 別に rkey を分ける (dev→'dev', prod→'self')。 */
  questIndex: `${ROOT}.questIndex`,
} as const;

/** world.* のレコード名 → collection (共通ローダー loadAdminWorld 用)。 */
export const ADMIN_WORLD_COL = Object.fromEntries(
  ADMIN_WORLD_RECORDS.map((name) => [name, adminWorldCollection(ADMIN_PREFIX, name)]),
) as Record<AdminWorldRecordName, string>;

/** ADMIN_COL.questIndex の rkey: env 別に分離する */
export const QUEST_INDEX_RKEY = ENV ? ENV : 'self';
