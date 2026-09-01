/**
 * **ワールド定義どうしの逆参照** (#603)。「この id を消したら誰が困るか」を 1 か所で答える。
 *
 * 各定義の検証 (setGameQuests / setShopOverrides / setInteriors / setNpcs / setScenario) は
 * **参照切れが 1 件でもあると全体を落とす**。そのため参照されている定義をエディタで
 * 消して保存すると、次の読み込みで参照元のセットが web / edge からまるごと消える
 * (モンスターを 1 体消したら全クエストが消える、など)。
 *
 * エディタは保存前にここで逆参照を引き、参照が残っていれば保存を拒否する。
 * どの定義がどの id を参照するかの知識は**このファイルだけ**が持つ — 各エディタに
 * 同じ列挙を書くと、参照の種類が増えたときに片方だけ抜ける。
 */
import { allGates } from './interior.js';
import { allNpcs } from './npc-data.js';
import { gameQuests } from './quest-data.js';
import { scenarioEvents } from './scenario.js';
import { shopOverrides } from './shop-data.js';

/** 参照される側の種類。 */
export type WorldRefKind = 'npc' | 'monster' | 'item' | 'equipment' | 'quest';

/** 参照 1 本。`from` はエディタにそのまま出せる参照元の説明。 */
export interface WorldRef {
  kind: WorldRefKind;
  id: string;
  from: string;
}

const KIND_LABELS: Record<WorldRefKind, string> = {
  npc: 'NPC',
  monster: 'モンスター',
  item: 'アイテム',
  equipment: '装備',
  quest: 'クエスト',
};

/** 読み込み済みの定義から、その種類への参照をすべて列挙する。 */
export function worldRefs(kind: WorldRefKind): WorldRef[] {
  const out: WorldRef[] = [];
  const push = (id: string | undefined, from: string) => {
    if (id !== undefined) out.push({ kind, id, from });
  };
  for (const q of gameQuests()) {
    const from = `クエスト「${q.title}」`;
    if (kind === 'npc') push(q.npcId, from);
    if (kind === 'monster' && q.objective.kind === 'defeat') push(q.objective.monsterId, from);
    if (kind === 'item') {
      if (q.objective.kind === 'collect') push(q.objective.itemId, from);
      push(q.reward?.itemId, from);
      for (const r of q.requireItems ?? []) push(r.itemId, from);
    }
  }
  for (const s of shopOverrides()) {
    const from = `店 (${s.x}, ${s.y})`;
    if (kind === 'equipment') for (const id of s.equipment ?? []) push(id, from);
    if (kind === 'item') {
      for (const id of s.consumables ?? []) push(id, from);
      push(s.materialId, from);
    }
  }
  if (kind === 'item') {
    for (const g of allGates()) {
      for (const r of g.requireItems ?? []) push(r.itemId, `ゲート (${g.from.mapId} ${g.from.x},${g.from.y})`);
    }
    for (const n of allNpcs()) {
      for (const a of n.altLines ?? []) for (const r of a.items ?? []) push(r.itemId, `NPC「${n.name}」のセリフ`);
    }
  }
  for (const e of scenarioEvents()) {
    const from = `シナリオ「${e.title}」`;
    for (const c of e.when) {
      if (kind === 'item' && c.kind === 'itemCount') push(c.itemId, from);
      if (kind === 'quest' && c.kind === 'questDone') push(c.questId, from);
    }
  }
  return out;
}

/**
 * `keep` に無い id への参照 = **保存すると切れる参照**。エディタは削除後の一覧を渡し、
 * 1 件でも返ったら保存を拒否する。
 */
export function danglingRefs(kind: WorldRefKind, keep: Iterable<string>): WorldRef[] {
  const ids = new Set(keep);
  return worldRefs(kind).filter((r) => !ids.has(r.id));
}

/** エディタの拒否メッセージ (どこが・何を参照しているか)。 */
export function describeDanglingRef(r: WorldRef): string {
  return `保存できない: ${r.from}が${KIND_LABELS[r.kind]}「${r.id}」を参照している。先にそちらを直す`;
}
