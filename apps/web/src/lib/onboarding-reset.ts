/**
 * オンボード用リセット (docs/19)。あおぞらワールドを「はじめから」体験するための完全ワイプ。
 *
 * 権威 gameState (所持品・装備・位置・レベル) はサーバーが持つのでサーバー経由で消し、
 * client 所有の PDS レコード (制作/装備/世界/パワー/分析XP) は本人トークンで消す。
 * **投稿で貯めたパワー残高は消さず**、world の消費/獲得だけを 0 に再集計してから
 * 歓迎の +20 パワーを加算する。次のワールド入場で初期状態
 * (spawn + やくそう&そらのはね + Lv1 + 投稿由来パワー +20) から再開する。
 *
 * dev + 管理者のみが UI から呼べる。自分の repo と自分の gameState しか触らない。
 */
import type { Agent } from '@atproto/api';
import { getRecord, putRecord } from './atproto';
import { COL } from './collections';
import { bumpPower } from './points';
import { serverReset } from './world-server';

/** 歓迎付与するあおぞらパワー (演出とともに加算)。 */
export const WELCOME_POWER = 20;

/** あるコレクションの全レコードを削除 (最大 500 件)。未作成コレクションは何もしない。 */
async function deleteAllRecords(agent: Agent, did: string, collection: string): Promise<void> {
  let cursor: string | undefined;
  for (let page = 0; page < 5; page++) {
    let res;
    try {
      res = await agent.com.atproto.repo.listRecords({ repo: did, collection, limit: 100, ...(cursor ? { cursor } : {}) });
    } catch {
      return; // 未作成
    }
    for (const r of res.data.records) {
      const rkey = r.uri.split('/').pop();
      if (rkey) await agent.com.atproto.repo.deleteRecord({ repo: did, collection, rkey }).catch(() => {});
    }
    const next = res.data.cursor;
    if (!next || next === cursor || res.data.records.length === 0) break;
    cursor = next;
  }
}

/** rkey='self' の 1 レコードを削除 (無ければ無視)。 */
async function deleteSelf(agent: Agent, did: string, collection: string): Promise<void> {
  await agent.com.atproto.repo.deleteRecord({ repo: did, collection, rkey: 'self' }).catch(() => {});
}

/** 分析レコードの XP を 0 に (= Lv1)。archetype / cognitiveScores / rpgStats 等は保持。 */
async function zeroAnalysisXp(agent: Agent, did: string): Promise<void> {
  const a = await getRecord<Record<string, unknown>>(agent, did, COL.analysis, 'self').catch(() => null);
  if (!a) return;
  const next: Record<string, unknown> = { ...a };
  const pl = a.playerLevel;
  if (pl && typeof pl === 'object') next.playerLevel = { ...(pl as object), xp: 0, streakDays: 0 };
  const jl = a.jobLevel;
  if (jl && typeof jl === 'object') next.jobLevel = { ...(jl as object), xp: 0 };
  await putRecord(agent, COL.analysis, 'self', next);
}

/**
 * 完全ワイプ → 初期状態へ。順序が重要:
 * 1. 所有物 (COL.craft = 制作/合成/売却)・装備中 (COL.gear)・旧世界記録 (COL.world) を削除。
 * 2. 分析 XP を 0 に (Lv1)。
 * 3. パワーキャッシュ (COL.power) を削除 → 次の集計で world 消費/獲得が 0 に再計算される
 *    (投稿由来の残高は post/spiritChat 走査で保持される)。
 * 4. 歓迎の +20 パワーを加算 (キャッシュ無し → scanFullPoints でクリーン集計 → +20)。
 * 5. サーバー権威 gameState + 戦闘ガードを削除 → 次のワールド入場で初期状態を生成。
 */
export async function resetOnboarding(agent: Agent, did: string): Promise<void> {
  await deleteAllRecords(agent, did, COL.craft);
  await deleteSelf(agent, did, COL.gear);
  await deleteSelf(agent, did, COL.world);
  await zeroAnalysisXp(agent, did);
  await deleteSelf(agent, did, COL.power);
  await bumpPower(agent, did, { salePowerEarned: WELCOME_POWER });
  await serverReset(agent);
}
