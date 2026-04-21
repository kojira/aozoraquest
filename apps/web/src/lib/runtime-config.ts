/**
 * 主管理者 DID の PDS から公開コンフィグを boot 時に取得する。
 *
 * 14-admin.md の設計通り:
 *   - app.aozoraquest.config.flags (rkey=self)
 *   - app.aozoraquest.config.maintenance (rkey=self)
 *   - app.aozoraquest.config.bans (rkey=self)
 *   - app.aozoraquest.config.prompts (rkey=spiritChat | draftPost | advancedDiagnosis)
 *   - app.aozoraquest.directory (rkey=self)
 *
 * 失敗時は DEFAULT_RUNTIME_CONFIG でフォールバック起動。
 */

import { AtpAgent } from '@atproto/api';
import { DEFAULT_RUNTIME_CONFIG, type RuntimeConfig } from '@aozoraquest/types';

const PLC_DIRECTORY = 'https://plc.directory';

function getPrimaryAdminDid(): string | null {
  const raw = import.meta.env.VITE_ADMIN_DIDS ?? '';
  const first = raw.split(',').map((s) => s.trim()).find(Boolean);
  return first ?? null;
}

async function resolveDidToPds(did: string): Promise<string> {
  // did:plc:* は plc.directory を経由、did:web:* はドメイン直 .well-known/did.json
  if (did.startsWith('did:plc:')) {
    const res = await fetch(`${PLC_DIRECTORY}/${did}`);
    if (!res.ok) throw new Error(`plc.directory ${res.status}`);
    const doc = await res.json();
    const service = (doc.service ?? []).find(
      (s: { type: string }) => s.type === 'AtprotoPersonalDataServer',
    );
    if (!service) throw new Error(`no PDS in DID doc for ${did}`);
    return service.serviceEndpoint as string;
  }
  if (did.startsWith('did:web:')) {
    const host = did.slice('did:web:'.length);
    const res = await fetch(`https://${host}/.well-known/did.json`);
    if (!res.ok) throw new Error(`did:web ${res.status}`);
    const doc = await res.json();
    const service = (doc.service ?? []).find(
      (s: { type: string }) => s.type === 'AtprotoPersonalDataServer',
    );
    if (!service) throw new Error(`no PDS in did:web doc for ${did}`);
    return service.serviceEndpoint as string;
  }
  throw new Error(`unsupported DID method: ${did}`);
}

function isNotFoundError(e: unknown): boolean {
  const err = e as { name?: string; message?: string };
  if (err?.name === 'RecordNotFoundError') return true;
  const msg = err?.message ?? '';
  return /RecordNotFound|not found|could not locate|InvalidRequest/i.test(msg);
}

async function tryGetRecord<T>(
  agent: AtpAgent,
  repo: string,
  collection: string,
  rkey: string,
): Promise<T | null> {
  try {
    const res = await agent.com.atproto.repo.getRecord({ repo, collection, rkey });
    return res.data.value as T;
  } catch (e) {
    if (isNotFoundError(e)) return null;
    console.warn(`getRecord ${collection}/${rkey} failed`, e);
    return null;
  }
}

/**
 * 全コンフィグを並列取得。どれか失敗してもデフォルトでフォールバック。
 */
export async function loadRuntimeConfig(): Promise<RuntimeConfig> {
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

  const [flags, maintenance, bans, spiritChat, directory] = await Promise.all([
    tryGetRecord<{ flags: Record<string, { enabled: boolean; rollout: number; description: string }>; updatedAt: string }>(
      agent, adminDid, 'app.aozoraquest.config.flags', 'self',
    ),
    tryGetRecord<{ enabled: boolean; message?: string; until?: string; allowedDids?: string[]; updatedAt: string }>(
      agent, adminDid, 'app.aozoraquest.config.maintenance', 'self',
    ),
    tryGetRecord<{ dids: string[]; updatedAt: string }>(
      agent, adminDid, 'app.aozoraquest.config.bans', 'self',
    ),
    tryGetRecord<{ id: 'spiritChat'; body: string; updatedAt: string }>(
      agent, adminDid, 'app.aozoraquest.config.prompts', 'spiritChat',
    ),
    tryGetRecord<{ users: Array<{ did: string; addedAt: string; note?: string }>; updatedAt: string }>(
      agent, adminDid, 'app.aozoraquest.directory', 'self',
    ),
  ]);

  return {
    flags: flags?.flags ?? {},
    maintenance: maintenance ?? DEFAULT_RUNTIME_CONFIG.maintenance,
    bans: bans?.dids ?? [],
    prompts: spiritChat ? { spiritChat } : {},
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
