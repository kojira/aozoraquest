/**
 * 主管理者 DID の PDS から公開コンフィグを boot 時に取得する。
 *
 * NSID は VITE_NSID_ROOT 由来 (collections.ts ADMIN_COL):
 *   - {ROOT}.config.flags (rkey=self)
 *   - {ROOT}.config.maintenance (rkey=self)
 *   - {ROOT}.config.bans (rkey=self)
 *   - {ROOT}.config.prompts (rkey=spiritChat | draftPost | advancedDiagnosis)
 *   - {ROOT}.directory (rkey=self)
 *
 * 失敗時は DEFAULT_RUNTIME_CONFIG でフォールバック起動。
 */

import { AtpAgent } from '@atproto/api';
import { DEFAULT_RUNTIME_CONFIG, type RuntimeConfig } from '@aozoraquest/types';
import { ADMIN_COL } from './collections';

const PLC_DIRECTORY = 'https://plc.directory';

function getPrimaryAdminDid(): string | null {
  const raw = import.meta.env.VITE_ADMIN_DIDS ?? '';
  const first = raw.split(',').map((s) => s.trim()).find(Boolean);
  return first ?? null;
}

/** DID を PDS エンドポイントに解決する (公開 read の宛先決定に使う唯一の実装)。
 *  did:plc:* は plc.directory、did:web:* はドメイン直 .well-known/did.json。 */
export async function resolveDidToPds(did: string): Promise<string> {
  const pickPds = (doc: { service?: { id?: string; type?: string; serviceEndpoint?: string }[] }) => {
    const svc = (doc.service ?? []).find(
      (s) => s.id === '#atproto_pds' || s.type === 'AtprotoPersonalDataServer',
    );
    if (!svc?.serviceEndpoint) throw new Error(`no PDS in DID doc for ${did}`);
    return svc.serviceEndpoint;
  };
  if (did.startsWith('did:plc:')) {
    const res = await fetch(`${PLC_DIRECTORY}/${encodeURIComponent(did)}`);
    if (!res.ok) throw new Error(`plc.directory ${res.status}`);
    return pickPds(await res.json());
  }
  if (did.startsWith('did:web:')) {
    // host-only did:web のみ対応 (path 付きは未対応 = Bluesky では稀)
    const host = did.slice('did:web:'.length);
    const res = await fetch(`https://${host}/.well-known/did.json`);
    if (!res.ok) throw new Error(`did:web ${res.status}`);
    return pickPds(await res.json());
  }
  throw new Error(`unsupported DID method: ${did}`);
}

/**
 * 指定コレクションの全レコードを listRecords で取得し、rkey → value の Map にして返す。
 * レコードが無い場合は空 Map を返すだけで HTTP 4xx を発生させない
 * (getRecord は存在しない rkey に対し 400 を返すためブラウザコンソールが汚れる)。
 */
async function listAsMap<T>(
  agent: AtpAgent,
  repo: string,
  collection: string,
): Promise<Map<string, T>> {
  const out = new Map<string, T>();
  try {
    const res = await agent.com.atproto.repo.listRecords({ repo, collection, limit: 100 });
    for (const r of res.data.records) {
      const rkey = r.uri.split('/').pop();
      if (rkey) out.set(rkey, r.value as T);
    }
  } catch (e) {
    console.warn(`listRecords ${collection} failed`, e);
  }
  return out;
}

/** 起動中に同じ admin DID を 2 度呼ばれても同じ Promise を返す (StrictMode の 2 重発火対策)。 */
let inflight: Promise<RuntimeConfig> | null = null;

/**
 * 全コンフィグを並列取得。どれか失敗してもデフォルトでフォールバック。
 */
export function loadRuntimeConfig(): Promise<RuntimeConfig> {
  if (inflight) return inflight;
  inflight = loadRuntimeConfigInner().finally(() => {
    // 結果は ConfigProvider 側で保持するのでここは開放
    inflight = null;
  });
  return inflight;
}

interface FlagsRecord {
  flags: Record<string, { enabled: boolean; rollout: number; description: string }>;
  updatedAt: string;
}
interface MaintenanceRecord {
  enabled: boolean;
  message?: string;
  until?: string;
  allowedDids?: string[];
  updatedAt: string;
}
interface BansRecord { dids: string[]; updatedAt: string }
interface PromptRecord { id: string; body: string; updatedAt: string; maxNewTokens?: number }
interface DirectoryRecord { users: Array<{ did: string; addedAt: string; note?: string }>; updatedAt: string }

async function loadRuntimeConfigInner(): Promise<RuntimeConfig> {
  const adminDid = getPrimaryAdminDid();
  if (!adminDid) {
    console.info('VITE_ADMIN_DIDS 未設定。デフォルトコンフィグで起動');
    return { ...DEFAULT_RUNTIME_CONFIG };
  }

  let pdsUrl: string;
  try {
    pdsUrl = await resolveDidToPds(adminDid);
  } catch (e) {
    console.warn('admin DID 解決失敗。デフォルトコンフィグで起動', e);
    return { ...DEFAULT_RUNTIME_CONFIG };
  }
  const agent = new AtpAgent({ service: pdsUrl });

  const [flagsMap, maintMap, bansMap, promptsMap, dirMap] = await Promise.all([
    listAsMap<FlagsRecord>(agent, adminDid, ADMIN_COL.configFlags),
    listAsMap<MaintenanceRecord>(agent, adminDid, ADMIN_COL.configMaintenance),
    listAsMap<BansRecord>(agent, adminDid, ADMIN_COL.configBans),
    listAsMap<PromptRecord>(agent, adminDid, ADMIN_COL.configPrompts),
    listAsMap<DirectoryRecord>(agent, adminDid, ADMIN_COL.directory),
  ]);

  const flags = flagsMap.get('self');
  const maintenance = maintMap.get('self');
  const bans = bansMap.get('self');
  const spiritChat = promptsMap.get('spiritChat');
  const directory = dirMap.get('self');

  return {
    flags: flags?.flags ?? {},
    maintenance: maintenance ?? DEFAULT_RUNTIME_CONFIG.maintenance,
    bans: bans?.dids ?? [],
    prompts: spiritChat
      ? {
          spiritChat: {
            id: 'spiritChat' as const,
            body: spiritChat.body,
            ...(spiritChat.maxNewTokens !== undefined ? { maxNewTokens: spiritChat.maxNewTokens } : {}),
            updatedAt: spiritChat.updatedAt,
          },
        }
      : {},
    directory: directory?.users ?? [],
  };
}

/**
 * フラグ評価: DID 基準の一貫ハッシュで段階公開 (rollout %) を実現。
 */
export function isFlagEnabled(
  flagId: string,
  config: RuntimeConfig,
  userDid: string | undefined,
): boolean {
  const f = config.flags[flagId];
  if (!f || !f.enabled) return false;
  if (f.rollout >= 100) return true;
  if (!userDid) return false;
  return hashStr(`${flagId}:${userDid}`) % 100 < f.rollout;
}

function hashStr(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export function isUnderMaintenance(config: RuntimeConfig, userDid: string | undefined): boolean {
  if (!config.maintenance.enabled) return false;
  if (userDid && config.maintenance.allowedDids?.includes(userDid)) return false;
  return true;
}

export function isBanned(config: RuntimeConfig, did: string): boolean {
  return config.bans.includes(did);
}
