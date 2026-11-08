/**
 * なまえのふだ (D-CASINO-001 r2)。`POST /api/party/rename {id, name, rkey}`。パーティの仲間 1 人の名前を変える。
 * - 名前の決まりは core の allyNameIssue (前後の空白を落として 1〜10 字・制御文字なし・`{c:` なし・今と同じは不可)
 * - ふだ (materials['name-tag']) は名前を変えられたときだけ 1 枚へる。同じ rkey の 2 回目は何もしない (shopOps)
 * - 名前は party.names[id]。partyDefsOf が戦闘と画面の名前に使う。はずすと消える (party-route の keep)
 */
import { allyNameIssue, partyDefsOf, recruitById } from '@aozoraquest/core';
import { readModifyWrite, type PartyState } from './game-state';
import { ResolverError, migrateInitState, type ResolverEnv } from './battle-resolver';
import { MAX_SHOP_OPS } from './shop';

export const NAME_TAG_ITEM = 'name-tag';

export interface PartyRenameResult { party: PartyState; materials: Record<string, number>; duplicate?: boolean }

export async function handlePartyRename(env: ResolverEnv, did: string, id: unknown, name: unknown, rkey: unknown, now: number, ns: string): Promise<PartyRenameResult> {
  if (typeof id !== 'string' || typeof rkey !== 'string' || !rkey || rkey.length > 128) throw new ResolverError('入力が不正', 400, 'bad_request');
  const op = `rename:${rkey}`;
  let duplicate = false;
  const after = await readModifyWrite(env, did, (cur) => {
    if ((cur.shopOps ?? []).includes(op)) { duplicate = true; return cur; }
    duplicate = false;
    const party = cur.party;
    const ally = partyDefsOf(party, recruitById, 1).find((a) => a.id === id);
    if (!party || !ally) throw new ResolverError('その仲間は パーティに いない', 400, 'bad_request');
    const issue = allyNameIssue(name, ally.name);
    if (issue) throw new ResolverError(issue, 400, 'bad_name');
    const tags = cur.materials[NAME_TAG_ITEM] ?? 0;
    if (tags < 1) throw new ResolverError('なまえのふだを もっていない', 400, 'no_name_tag');
    const materials = { ...cur.materials };
    if (tags > 1) materials[NAME_TAG_ITEM] = tags - 1; else delete materials[NAME_TAG_ITEM];
    const names = { ...party.names, [id]: (name as string).trim() };
    return { ...cur, materials, party: { ...party, names }, shopOps: [...(cur.shopOps ?? []), op].slice(-MAX_SHOP_OPS) };
  }, { now, init: (d, iso) => migrateInitState(d, iso, ns) });
  return { party: after.party ?? { ids: [] }, materials: after.materials, ...(duplicate ? { duplicate } : {}) };
}
