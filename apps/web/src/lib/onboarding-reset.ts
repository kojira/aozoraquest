/**
 * オンボード用リセット (docs/19)。あおぞらワールドを「はじめから」体験するための完全ワイプ。
 *
 * 権威 gameState (所持品・装備・位置・レベル) はサーバーが持つのでサーバー経由で消し、
 * client 所有の PDS レコード (制作/戦闘/装備/世界/パワー/分析XP) は本人トークンで消す。
 * **投稿で貯めたパワー残高は保持**し、world 由来の消費/獲得 (battles/craft/sale/search) を
 * 0 に戻したうえで歓迎の +20 パワーを載せる。次のワールド入場で初期状態
 * (spawn + やくそう&そらのはね + Lv1 + 投稿由来パワー +20) から再開する。
 *
 * **順序の要点**: gameState 削除 (serverReset) を**最後**に行う。migrateInitState は次入場で
 * analysis(XP)/world(位置)/power(残高) を読んで初期状態を作るので、それらを先に掃除してから
 * gameState を消す。こうすると途中失敗しても「gameState は残る=旧状態のまま」で止まり、
 * 半端に古い Lv/位置で復帰しない。各ステップは冪等 (削除は no-op 安全、power は絶対値書き込み)
 * なので、失敗時は同じ操作を再実行すれば収束する (doReset がエラーを拾ってリトライ導線にする)。
 *
 * dev + 管理者のみが UI から呼べる。自分の repo と自分の gameState しか触らない。
 */
import type { Agent } from '@atproto/api';
import { getRecord, putRecord } from './atproto';
import { COL } from './collections';
import { resetWorldPower } from './points';
import { serverReset } from './world-server';

/** 歓迎付与するあおぞらパワー (演出とともに加算)。 */
export const WELCOME_POWER = 20;

/** 通常オンボードのイントロ (ONBOARDING_LINES overlay) を「見終えた」フラグの localStorage キー。
 *  これが '1' だとイントロは再生されない。リセット時に消すと新規と同じ導入から始まる。 */
export const ONBOARDING_DONE_KEY = 'aq-world-onboarding-done';
/** リセットで +20 を付与した直後だけ、再入場後のブルスコン手渡しの最後に祝福演出を出すためのマーク
 *  (sessionStorage はリロードをまたいで残り、タブを閉じれば消える。使い捨て)。 */
export const WELCOME_BLESSING_PENDING_KEY = 'aq-welcome-blessing-pending';

/**
 * リセット完了後、**通常の新規オンボードルートを丸ごと再生**させる準備。
 * - イントロ overlay を再表示するため onboarding-done を消す (これが無いと「いきなり地図」になる)。
 * - 祝福 (+20) 演出を再入場後に出すためのマークを立てる (実際に +20 を付与したときだけ呼ぶ)。
 * 呼び出し後に /world へフルロード遷移すると、新規ユーザーと同じ「イントロ→手渡し→祝福」を辿る。
 */
export function armOnboardingReplay(): void {
  try { localStorage.removeItem(ONBOARDING_DONE_KEY); } catch { /* private mode 等は諦める */ }
  try { sessionStorage.setItem(WELCOME_BLESSING_PENDING_KEY, '1'); } catch { /* private mode 等は諦める */ }
}

/** あるコレクションの全レコードを削除。**並列バッチの deleteRecord** で消す —
 *  1 件ずつ逐次 await するとレコードが多いアカウントで数十〜数百往復かかり実質ハングする
 *  (リセットが固まる不具合)。records を集めてから 25 件ずつ並列に削除する。
 *  applyWrites の一括削除はバッチ全体が落ちる/入力検証で同期 throw する事故があり、
 *  独立した deleteRecord を並列に投げる方が堅牢 (存在しない rkey は個別に無視)。
 *  未作成コレクションは何もしない。安全上限 10000 件 (暴走防止)。
 *  @internal export はテスト用 (並列削除の回帰防止)。 */
export async function deleteAllRecords(agent: Agent, did: string, collection: string): Promise<void> {
  const rkeys: string[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 100; page++) {
    let res;
    try {
      res = await agent.com.atproto.repo.listRecords({ repo: did, collection, limit: 100, ...(cursor ? { cursor } : {}) });
    } catch {
      return; // 未作成
    }
    for (const r of res.data.records) {
      const rkey = r.uri.split('/').pop();
      if (rkey) rkeys.push(rkey);
    }
    const next = res.data.cursor;
    if (!next || next === cursor || res.data.records.length === 0) break;
    cursor = next;
  }
  const BATCH = 25;
  for (let i = 0; i < rkeys.length; i += BATCH) {
    await Promise.all(
      rkeys.slice(i, i + BATCH).map((rkey) =>
        agent.com.atproto.repo.deleteRecord({ repo: did, collection, rkey }).catch(() => {}),
      ),
    );
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
 * 完全ワイプ → 初期状態へ。
 * 1. 所有物 (COL.craft = 制作/合成/売却)・戦闘履歴 (COL.battle) を全削除。
 *    battle も消すのは、power の battles 消費を 0 に戻す (resetWorldPower) のと整合させ、
 *    将来 power キャッシュが再集計されても battles が復活しないようにするため。
 * 2. 装備中 (COL.gear)・旧世界記録 (COL.world) を削除。
 * 3. 分析 XP を 0 に (Lv1)。
 * 4. power を絶対値で書き直す: world 消費/獲得を 0、歓迎 +20 を salePowerEarned に (冪等)。
 * 5. サーバー権威 gameState + 戦闘ガードを削除 → 次のワールド入場で初期状態を生成 (最後に実行)。
 */
export async function resetOnboarding(agent: Agent, did: string): Promise<void> {
  // 各ステップを label 付きで実行 — どのステップで失敗したかをエラーに載せて UI で分かるようにする
  // (「リセットに失敗」だけだと原因が特定できない不具合対応)。
  const step = async (label: string, fn: () => Promise<unknown>): Promise<void> => {
    try {
      await fn();
    } catch (e) {
      throw new Error(`${label}: ${e instanceof Error ? e.message : String(e)}`);
    }
  };
  await step('craft', () => deleteAllRecords(agent, did, COL.craft));
  await step('battle', () => deleteAllRecords(agent, did, COL.battle));
  await step('gear', () => deleteSelf(agent, did, COL.gear));
  await step('world', () => deleteSelf(agent, did, COL.world));
  await step('analysisXp', () => zeroAnalysisXp(agent, did));
  await step('power', () => resetWorldPower(agent, did, WELCOME_POWER));
  await step('serverReset', () => serverReset(agent));
}
