import { useCallback, useState, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import type { Agent } from '@atproto/api';
import { townAt, type BattleState, type Command } from '@aozoraquest/core';
import { serverTurn, WorldServerError, type ServerAward } from '@/lib/world-server';
import { bumpJobXp } from '@/lib/use-job-xp';
import { questAfterBattle, type QuestState } from '@/lib/game-quest';
import type { BattlePhase } from '@/components/world-battle-controls';
import { useLatestRef } from '@/lib/use-latest-ref';
import type { WorldInventory } from '@/lib/use-world-inventory';
import { asBattleState, type Vitals } from '@/lib/world-view';
import { battleResultLines } from '@/lib/world-battle-result';

export interface WorldBattle {
  /** サーバー権威の戦闘 state (seed は含まれない = 先読み不可)。描画のみに使う。 */
  state: BattleState;
  busy: boolean;
  /** DQ 風の交互表示。message=メッセージ窓 / input=コマンド入力 / result=決着後の報酬メッセージ
   *  (別パネルを出さず同じ固定サイズのメッセージ窓に畳む = 枠が伸縮せず敵の位置も動かない) */
  phase: BattlePhase;
  /** サーバーが採番した戦闘 ID (ターン送信に必須)。 */
  battleId: string;
  /** 決着ターンでサーバーが確定した報酬 (result フェーズの表示に使う)。 */
  awarded?: ServerAward;
  /** result フェーズで出す報酬行 (経験値・素材など) */
  resultLines?: readonly string[];
  /** コマンド送信失敗 (503/409/通信断) をバトル画面内に表示する一行。notice は戦闘中は
   *  描画されない (戦闘オーバーレイの外) ので、fail-closed のエラーはここに出す。 */
  errorText?: string;
  /** 決着後の権威位置 (敗北は最後の街へ帰還)。決着タップでここへ移動する。 */
  resultPos?: { x: number; y: number };
  /** 決着後の位置に対応する新トークン。 */
  resultToken?: string;
  /** 決着後の権威在庫/HP (materials 一本化)。決着タップで表示を同期する。 */
  resultMaterials?: Record<string, number>;
  resultCarryHp?: number;
  resultCarryMp?: number;
}

export function useWorldBattle({ agent, setQuest, flagsRef, pendingNoticesRef, flushScenarioNotices, tokenRef, setWs, setNotice, scheduleSave, inventory, setServerPower, archetypeRef, didRef }: {
  agent: Agent | null;
  setQuest: (next: (s: QuestState) => QuestState) => void;
  flagsRef: MutableRefObject<string[]>;
  pendingNoticesRef: MutableRefObject<string[]>;
  flushScenarioNotices: () => void;
  tokenRef: MutableRefObject<string | undefined>;
  setWs: Dispatch<SetStateAction<Vitals | null>>;
  setNotice: (notice: string | null) => void;
  scheduleSave: () => void;
  inventory: WorldInventory;
  setServerPower: Dispatch<SetStateAction<number | null>>;
  archetypeRef: MutableRefObject<string | null>;
  didRef: MutableRefObject<string | null>;
}) {
  const { setHerbStock, setTonicStock, setFeatherStock, materialsRef, setMaterialsView } = inventory;
  const [battle, setBattle] = useState<WorldBattle | null>(null);
  const battleRef = useLatestRef(battle);

  // 戦闘コマンドも**毎回サーバーが解決する** (docs/21 §5)。クライアントは battleId + turn + command を送るだけ。
  // 決着ターンの報酬 (XP/ドロップ/素材ロス) はサーバーが権威 state に確定し、awarded として返す。
  // タップ送り (onMessageAdvance) で「〜のダメージ！」を読んでから結果へ進む (DQ 風)。
  const onBattleCommand = useCallback(
    (command: Command, skillIndex?: number) => {
      const b = battleRef.current;
      if (!b || b.busy || b.phase !== 'input') return;
      if (!agent) { setBattle({ ...b, errorText: 'サーバーに接続できず 戦えない。' }); return; }
      const { errorText: _clear, ...bClean } = b; // 再送時は前回エラーを消す (exactOptional のため省略で落とす)
      const busy = { ...bClean, busy: true };
      battleRef.current = busy;
      setBattle(busy);
      void (async () => {
        try {
          const res = await serverTurn(agent, b.battleId, b.state.turn, command, skillIndex);
          const acting = { ...bClean, state: asBattleState(res.state), phase: 'message' as BattlePhase, busy: false,
            ...(res.awarded ? { awarded: res.awarded } : {}),
            ...(res.position ? { resultPos: res.position } : {}),
            ...(res.token ? { resultToken: res.token } : {}),
            ...(res.materials ? { resultMaterials: res.materials, resultCarryHp: res.carryHp, resultCarryMp: res.carryMp } : {}) };
          // シナリオ (#545) は決着でも進む (ジョブ Lv 条件はここでしか動かない)。
          // **拾わないと永久に失われる** — 発火済みのお知らせは二度と返らない。
          if (res.flags) flagsRef.current = res.flags;
          if (res.scenarioNotices?.length) pendingNoticesRef.current = [...pendingNoticesRef.current, ...res.scenarioNotices];
          // 討伐数 (#659) も決着の応答で同期する (メニューの進捗が戦闘前のまま残らない)。
          setQuest((s) => questAfterBattle(s, res.activeQuests, res.questsDone));
          battleRef.current = acting;
          setBattle(acting);
        } catch (e) {
          // 失敗しても**クライアント側で報酬を付けない** (fail-closed。busy を戻して再送させる)。
          // エラーは戦闘オーバーレイ内に出す (notice は戦闘中は描画されない = 無言失敗になる)。
          const cur = battleRef.current;
          if (!cur) return;
          let errorText = 'こうげきを 送れなかった (通信エラー)。もう一度どうぞ。';
          if (e instanceof WorldServerError && e.status === 503) errorText = 'サーバーに記録できなかった (報酬なし)。でんぱのよい ばしょで もう一度どうぞ。';
          else if (e instanceof WorldServerError && e.status === 409) errorText = 'ターンが ずれた。もう一度どうぞ。';
          else if (e instanceof WorldServerError && (e.code === 'timeout' || e.code === 'network')) errorText = 'サーバーが応答しない。でんぱのよい ばしょで もう一度どうぞ。';
          else console.warn('[world] serverTurn failed', e);
          const revert = { ...cur, busy: false, errorText };
          battleRef.current = revert;
          setBattle(revert);
        }
      })();
    },
    [agent, setQuest, battleRef, flagsRef, pendingNoticesRef],
  );

  // メッセージ窓のタップ送り。開幕/継戦は入力へ、決着は確定処理してリザルトへ。
  const onMessageAdvance = useCallback(
    async () => {
      const b = battleRef.current;
      if (!b || b.busy) return;
      // result フェーズ (決着後の報酬メッセージ) はタップでマップへ戻る
      if (b.phase === 'result') {
        battleRef.current = null;
        setBattle(null);
        flushScenarioNotices();
        return;
      }
      // agent/did は決着の確定処理 (レコード/XP) だけに要るので、ここでは要求しない。
      // 継戦のタップ送りまで塞ぐと、稀にセッションが切れた時にメッセージが送れず詰む。
      if (b.phase !== 'message') return;
      const next = b.state;
      // 開幕メッセージ (turn 0 = 開幕専用。resolveTurn は turn を必ず +1 するので決着は
      // 常に turn>=1) と継戦は入力フェーズへ戻すだけ
      if (next.turn === 0 || next.outcome === 'ongoing') {
        const back = { ...b, phase: 'input' as BattlePhase };
        battleRef.current = back;
        setBattle(back);
        return;
      }
      // 決着: 報酬は**サーバーが権威 state に確定済み** (onBattleCommand の serverTurn が返した
      // awarded)。ここではクライアント表示を更新するだけ = 一切 XP/パワー/素材を書かない (改造不可)。
      const awarded = b.awarded ?? {};
      const drops = awarded.drops ?? [];
      const lost = awarded.materialsLost ?? [];
      // 決着後の権威位置 (敗北は最後の街へ帰還) に移動し、対応トークンで同期する。
      const resultPos = b.resultPos;
      if (b.resultToken) tokenRef.current = b.resultToken;
      // HP/MP + 在庫はサーバー権威 (turn 結果)。carry は undefined=満タン → null。敗北は最後の街へ帰還。
      if (next.outcome === 'lose') {
        setWs((s) => (s ? { ...s, hp: b.resultCarryHp ?? null, mp: b.resultCarryMp ?? null, ...(resultPos ? { x: resultPos.x, y: resultPos.y, lastTown: resultPos } : {}) } : s));
        if (resultPos) { const t = townAt(resultPos.x, resultPos.y); setNotice(t ? `気がつくと「${t.name}」に はこばれていた…` : '気がつくと 街に はこばれていた…'); }
      } else {
        setWs((s) => (s ? { ...s, hp: b.resultCarryHp ?? null, mp: b.resultCarryMp ?? null, ...(resultPos ? { x: resultPos.x, y: resultPos.y } : {}) } : s));
      }
      scheduleSave();
      // 在庫表示をサーバー権威 (turn 結果の materials) で同期。取得できなければ従来のミラーで best-effort。
      if (b.resultMaterials) {
        const m = b.resultMaterials;
        setHerbStock(m['herb'] ?? 0);
        setTonicStock(m['sky-dew'] ?? 0);
        setFeatherStock(m['sky-feather'] ?? 0);
        materialsRef.current = { ...m };
      } else {
        const countOf = (arr: readonly string[], id: string) => arr.filter((x) => x === id).length;
        setHerbStock((n) => Math.max(0, n - countOf(lost, 'herb')) + countOf(drops, 'herb'));
        setTonicStock((n) => Math.max(0, n - countOf(lost, 'sky-dew')) + countOf(drops, 'sky-dew'));
        setFeatherStock((n) => Math.max(0, n - countOf(lost, 'sky-feather')) + countOf(drops, 'sky-feather'));
        const m = { ...materialsRef.current };
        for (const d of drops) m[d] = (m[d] ?? 0) + 1;
        for (const id of lost) { const left = Math.max(0, (m[id] ?? 0) - 1); if (left > 0) m[id] = left; else delete m[id]; }
        materialsRef.current = m;
      }
      // 表示用も一緒に更新する (#638 レビュー ★★★)。ref だけ進めると、店を
      // 「開くとき」に取り直す経路を通らない導線 (扉を踏んで自動で開く) で
      // 戦闘のドロップが在庫に出ず、作れるはずの物が作れなく見える。
      setMaterialsView({ ...materialsRef.current });
      if (awarded.powerSpent) setServerPower((p) => (p === null ? p : Math.max(0, p - awarded.powerSpent!)));
      if (awarded.unrewarded) setServerPower(0);
      if (awarded.xp && awarded.xp > 0) {
        // 権威 state の jobXp に加算されたぶんを共有キャッシュにも反映 (再取得の往復を省く)。
        // **archetype / did は ref から読む。** この callback は deps が狭く、直接参照すると
        // 診断ロード前に固まったクロージャが null を掴んで加算が黙って消える
        // (同じ形のバグを #529 で踏んでいる)。
        const arch = archetypeRef.current;
        if (arch && didRef.current) bumpJobXp(didRef.current, arch, awarded.xp);
      }
      const loseTown = next.outcome === 'lose' && b.resultPos ? townAt(b.resultPos.x, b.resultPos.y) : null;
      const resultLines = battleResultLines(awarded, next.outcome, loseTown?.name ?? null);
      if (resultLines.length === 0) {
        battleRef.current = null;
        setBattle(null);
        flushScenarioNotices();
      } else {
        const done = { ...b, state: next, busy: false, phase: 'result' as BattlePhase, resultLines };
        battleRef.current = done;
        setBattle(done);
      }
    },
    [scheduleSave, archetypeRef, battleRef, didRef, flushScenarioNotices, materialsRef, setFeatherStock, setHerbStock, setMaterialsView, setNotice, setServerPower, setTonicStock, setWs, tokenRef],
  );

  return { battle, setBattle, battleRef, onBattleCommand, onMessageAdvance };
}
