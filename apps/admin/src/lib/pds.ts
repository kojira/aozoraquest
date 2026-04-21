/**
 * admin 自身の PDS への read / write ラッパー。
 * 14-admin.md §コンフィグ配信: 主管理者 PDS に collection 別 rkey で保存。
 */

import type { Agent } from '@atproto/api';

export async function putConfigRecord(
  agent: Agent,
  collection: string,
  rkey: string,
  record: object,
) {
  const did = agent.assertDid;
  return agent.com.atproto.repo.putRecord({
    repo: did,
    collection,
    rkey,
    record: { ...record, $type: collection },
  });
}

export async function getConfigRecord<T = unknown>(
  agent: Agent,
  collection: string,
  rkey: string,
): Promise<T | null> {
  try {
    const did = agent.assertDid;
    const res = await agent.com.atproto.repo.getRecord({ repo: did, collection, rkey });
    return res.data.value as T;
  } catch (e) {
    const err = e as { name?: string; message?: string };
    if (err?.name === 'RecordNotFoundError') return null;
    const msg = err?.message ?? '';
    if (/RecordNotFound|not found|could not locate|InvalidRequest/i.test(msg)) return null;
    throw e;
  }
}
