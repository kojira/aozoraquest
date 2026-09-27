#!/usr/bin/env node
// 管理データ CLI (#695)。docs/issue-695-admin-data-api.md が正本。Node 標準のみ。
import { readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const WARNING = '警告: 本番と共通の管理データを書き換える (app.aozoraquest.world.* は env で分かれていない)。';
const DEFAULT_EDGE = 'https://aozoraquest-edge-dev.kojiran.workers.dev';
const KEY_PATH = join(homedir(), '.config', 'aozoraquest', 'dev-admin-data-key');
const NAMES = ['npcs', 'shops', 'quests', 'scenario', 'interiors'];
/** name ごとの配列のキーと、要素の id の取り方。 */
const LIST_KEY = { npcs: 'npcs', shops: 'shops', quests: 'quests', scenario: 'events', interiors: 'interiors' };
const idOf = (name, v) => (name === 'shops' ? `(${v?.x}, ${v?.y})` : String(v?.id));

const HELP = `${WARNING}

使い方:
  node scripts/admin-data.mjs get <name>                          JSON を標準出力へ
  node scripts/admin-data.mjs put <name> <file> [--dry-run]        差分要約を出してから書く
  node scripts/admin-data.mjs npc-move <id> <mapId> <x> <y> [--dry-run]

  name: ${NAMES.join(' | ')}
  <file> は GET の value と同じ形 (例: { "npcs": [...] })。
  接続先: 既定 ${DEFAULT_EDGE} (AQ_ADMIN_DATA_EDGE で上書き)
  鍵: ${KEY_PATH} (パーミッション 600 以外は実行しない)
`;

function fail(message) {
  console.error(message);
  process.exit(1);
}

/** 鍵を読む。値は出力しない。 */
function readKey() {
  let st;
  try { st = statSync(KEY_PATH); } catch { fail(`鍵ファイルが無い: ${KEY_PATH}`); }
  if ((st.mode & 0o777) !== 0o600) fail(`鍵ファイルのパーミッションが 600 でない (${(st.mode & 0o777).toString(8)}): ${KEY_PATH}`);
  const key = readFileSync(KEY_PATH, 'utf8').trim();
  if (!key) fail(`鍵ファイルが空: ${KEY_PATH}`);
  return key;
}

async function request(method, name, body) {
  const edge = (process.env.AQ_ADMIN_DATA_EDGE || DEFAULT_EDGE).replace(/\/$/, '');
  const res = await fetch(`${edge}/api/admin/data/${name}`, {
    method,
    headers: { authorization: `Bearer ${readKey()}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (res.status === 404) fail('404: API が無効・鍵違い・対象外の name のいずれか (区別は返らない)');
  if (!res.ok) fail(`${res.status}: ${data.message ?? data.error ?? text}`);
  return data;
}

/** 追加・削除・変更の件数と id。NPC は位置の変化も出す。 */
function summarize(name, before, after) {
  const key = LIST_KEY[name];
  const oldList = Array.isArray(before?.[key]) ? before[key] : [];
  const newList = Array.isArray(after?.[key]) ? after[key] : [];
  const oldById = new Map(oldList.map((v) => [idOf(name, v), v]));
  const newById = new Map(newList.map((v) => [idOf(name, v), v]));
  const added = [...newById.keys()].filter((id) => !oldById.has(id));
  const removed = [...oldById.keys()].filter((id) => !newById.has(id));
  const changed = [...newById.keys()].filter((id) => oldById.has(id) && JSON.stringify(oldById.get(id)) !== JSON.stringify(newById.get(id)));
  const lines = [`${name}: 追加 ${added.length} / 削除 ${removed.length} / 変更 ${changed.length}`];
  if (added.length) lines.push(`  追加: ${added.join(', ')}`);
  if (removed.length) lines.push(`  削除: ${removed.join(', ')}`);
  for (const id of changed) {
    const o = oldById.get(id), n = newById.get(id);
    const pos = (v) => `${v.mapId ?? 'world'} (${v.x}, ${v.y})`;
    const moved = name === 'npcs' && pos(o) !== pos(n) ? ` 位置 ${pos(o)} → ${pos(n)}` : '';
    lines.push(`  変更: ${id}${moved}`);
  }
  const otherKeys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  for (const k of otherKeys) {
    if (k === key || k === 'updatedAt' || k === '$type') continue;
    if (JSON.stringify(before?.[k]) !== JSON.stringify(after?.[k])) lines.push(`  ${k}: 変更あり`);
  }
  return lines.join('\n');
}

/** 直前の cid を swapCid にして書く。差分要約を先に出す。 */
async function write(name, current, value, dryRun) {
  console.error(WARNING);
  console.error(summarize(name, current.value, value));
  const res = await request('PUT', name, { value, swapCid: current.cid, ...(dryRun ? { dryRun: true } : {}) });
  console.error(res.dryRun ? 'dry-run: 検証を通った (書いていない)' : `書いた (cid ${res.cid})。サーバーは最大 5 分で拾う`);
}

const checkName = (name) => { if (!NAMES.includes(name)) fail(`name は ${NAMES.join(' | ')} のどれか\n\n${HELP}`); return name; };

async function main(argv) {
  const dryRun = argv.includes('--dry-run');
  const args = argv.filter((a) => a !== '--dry-run');
  const [cmd, ...rest] = args;
  if (!cmd || cmd === '--help' || cmd === '-h' || cmd === 'help') { console.log(HELP); return; }
  if (cmd === 'get' && rest.length === 1) {
    console.log(JSON.stringify(await request('GET', checkName(rest[0])), null, 2));
    return;
  }
  if (cmd === 'put' && rest.length === 2) {
    const name = checkName(rest[0]);
    let value;
    try { value = JSON.parse(readFileSync(rest[1], 'utf8')); } catch (e) { fail(`${rest[1]} を JSON として読めない: ${e.message}`); }
    await write(name, await request('GET', name), value, dryRun);
    return;
  }
  if (cmd === 'npc-move' && rest.length === 4) {
    const [id, mapId, xs, ys] = rest;
    const x = Number(xs), y = Number(ys);
    if (!Number.isInteger(x) || !Number.isInteger(y)) fail('x / y は整数');
    const current = await request('GET', 'npcs');
    const npcs = current.value?.npcs ?? [];
    if (!npcs.some((n) => n.id === id)) fail(`NPC が見つからない: ${id}`);
    const moved = npcs.map((n) => {
      if (n.id !== id) return n;
      const { mapId: _old, ...restNpc } = n;
      return { ...restNpc, ...(mapId === 'world' ? {} : { mapId }), x, y };
    });
    await write('npcs', current, { ...current.value, npcs: moved }, dryRun);
    return;
  }
  fail(HELP);
}

main(process.argv.slice(2)).catch((e) => fail(String(e?.message ?? e)));
