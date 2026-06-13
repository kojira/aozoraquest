/**
 * 他人の repo の公開レコードを「その人の PDS から直接」読むためのヘルパー。
 *
 * Bluesky はユーザーごとに PDS が分散している (puffball / enoki / 自前 PDS …)。
 * 他人の repo を**自分のログイン中 agent (= 自分の PDS)** で
 * com.atproto.repo.listRecords / getRecord すると、相手が別ホストにいる場合
 * 「Could not find repo」や空が返り、クエスト掲示板やポートフォリオが
 * 表示できない (= 本番バグ)。
 *
 * userQuest / questApplication / questCompletion / directory は public record
 * なので、**対象 DID の PDS を解決して無認証で読む**のが正しい。
 *
 * PDS エンドポイントは DID document (did:plc は plc.directory、did:web は
 * .well-known/did.json) から解決し、DID 単位・PDS 単位でキャッシュする。
 */
import { AtpAgent } from '@atproto/api';
import { resolveDidToPds } from './runtime-config';

const pdsByDid = new Map<string, Promise<string>>();
const agentByPds = new Map<string, AtpAgent>();

/** DID → PDS を DID/PDS 単位でキャッシュしつつ解決する
 *  (解決ロジックは runtime-config の resolveDidToPds に一本化)。 */
async function resolvePds(did: string): Promise<string> {
  let p = pdsByDid.get(did);
  if (!p) {
    p = resolveDidToPds(did);
    // 失敗した promise はキャッシュに残さない (一過性失敗で永久に詰まらないよう)
    p.catch(() => pdsByDid.delete(did));
    pdsByDid.set(did, p);
  }
  return p;
}

async function agentForDid(did: string): Promise<AtpAgent> {
  const pds = await resolvePds(did);
  let a = agentByPds.get(pds);
  if (!a) {
    a = new AtpAgent({ service: pds });
    agentByPds.set(pds, a);
  }
  return a;
}

/** 対象 DID の PDS から listRecords する (公開レコード、無認証)。 */
export async function listRecordsForDid(
  did: string,
  collection: string,
  limit = 100,
): Promise<{ records: { uri: string; value: unknown }[] }> {
  const agent = await agentForDid(did);
  const res = await agent.com.atproto.repo.listRecords({ repo: did, collection, limit });
  return { records: res.data.records.map((r) => ({ uri: r.uri, value: r.value })) };
}

/** 対象 DID の PDS から getRecord する。RecordNotFound 系は null。 */
export async function getRecordForDid<T = unknown>(
  did: string,
  collection: string,
  rkey: string,
): Promise<T | null> {
  const agent = await agentForDid(did);
  try {
    const res = await agent.com.atproto.repo.getRecord({ repo: did, collection, rkey });
    return res.data.value as T;
  } catch (e) {
    const err = e as { name?: string; message?: string };
    if (err?.name === 'RecordNotFoundError') return null;
    if (/RecordNotFound|not found|could not locate|InvalidRequest/i.test(err?.message ?? '')) return null;
    throw e;
  }
}

/** テスト用 */
export function clearRepoReadCache(): void {
  pdsByDid.clear();
  agentByPds.clear();
}
