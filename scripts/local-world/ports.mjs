// ローカル環境のポートと置き場所 (単一の出所)。D-LOCAL-PLAY-001 / #1018。
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(HERE, '..', '..');
/** 状態 (PDS の sqlite・blob・PLC の操作ログ・鍵・アカウント) の置き場所。gitignore 済。 */
export const STATE_DIR = path.join(HERE, '.state');

export const PLC_PORT = 2582;
/** dev-env の PLC 本体 (PLC_PORT の変換口の裏。network.mjs)。 */
export const PLC_INTERNAL_PORT = 2581;
export const PDS_PORT = 2583;
/** edge (wrangler dev)。web の .env.development が許可している CORS 相手は 127.0.0.1:9999。 */
export const EDGE_PORT = 8788;
/** web (vite dev)。OAuth の loopback redirect は 127.0.0.1 で受ける必要がある。 */
export const WEB_PORT = 9999;

export const PLC_URL = `http://localhost:${PLC_PORT}`;
export const PDS_URL = `http://localhost:${PDS_PORT}`;
export const EDGE_URL = `http://127.0.0.1:${EDGE_PORT}`;
export const WEB_URL = `http://127.0.0.1:${WEB_PORT}`;
/** edge の DID。service auth JWT の aud (did:web は localhost だけポートを許す atproto の規則)。 */
export const EDGE_DID = `did:web:localhost%3A${EDGE_PORT}`;

/** 主管理者 (= world.* の持ち主) とサーバーアカウント (= gameState の持ち主) とプレイヤー。 */
export const ACCOUNTS = {
  admin: { handle: 'aqadmin.test', email: 'admin@local.test' },
  server: { handle: 'aqserver.test', email: 'server@local.test' },
  player: { handle: 'player.test', email: 'player@local.test' },
  player2: { handle: 'player2.test', email: 'player2@local.test' },
};

/** dev の管理者 repo (world.* を**読むだけ**で写す元)。公開レコードなので無認証で読める。 */
export const DEV_ADMIN_DID = 'did:plc:47skrewud2vjha6o57wzzxjw';
export const NSID_ROOT = 'app.aozoraquest';
/** ローカルは dev と同じ名前空間 (app.aozoraquest.dev.*)。置き場所がローカル PDS なので物理的に別。 */
export const ADMIN_PREFIX = `${NSID_ROOT}.dev`;
