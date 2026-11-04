import { useCallback, useEffect, useMemo, useState } from 'react';
import { skillsForJob, type BattleState, type Command } from '@aozoraquest/core';

/** めいれい で送る 1 人ぶん (POST /api/battle/turn の allies[]。D-PARTY-004 §2)。 */
export interface AllyOrderInput { id: string; command: Command; skillIndex?: number; targetIndex?: number; itemId?: string }
type HeroCommand = { command: Command; skillIndex?: number | undefined; itemId?: string | undefined; targetIndex?: number | undefined };

/** めいれい の仲間 (封印の時点で manual・生きている) の allies の位置。 */
export function manualAllyIndexes(state: BattleState): number[] {
  const allies = state.allies ?? [];
  return allies.flatMap((a, i) => (i > 0 && a.hp > 0 && a.job && state.allyModes?.[i] === 'manual' && state.partyIds?.[i - 1] ? [i] : []));
}

/** コマンド窓に渡す、その仲間から見た state (とくぎ・MP はその仲間のもの。在庫は共有)。 */
export function allyView(state: BattleState, index: number): BattleState {
  const ally = state.allies![index]!;
  const skills = skillsForJob(ally.job!.archetype, ally.job!.level);
  return { ...state, player: ally, playerSkill: skills[0]!, playerSkills: skills };
}

/**
 * めいれい の入力の順番 (主人公 → めいれい の仲間を並び順に → 送信)。world-battle-controls はそのまま使い、
 * いま入力している人の state と見出し・もどる・おまかせ をここで出す。めいれい の仲間がいなければ今までどおり 1 手で送る。
 */
export function useAllyOrders(state: BattleState | null, inputKey: string, send: (hero: HeroCommand, allies: AllyOrderInput[]) => void) {
  const [step, setStep] = useState<{ key: string; hero?: HeroCommand; orders: AllyOrderInput[] }>({ key: inputKey, orders: [] });
  useEffect(() => { setStep({ key: inputKey, orders: [] }); }, [inputKey]);
  const cur = useMemo(() => (step.key === inputKey ? step : { key: inputKey, orders: [] as AllyOrderInput[] }), [step, inputKey]);
  const manual = state ? manualAllyIndexes(state) : [];
  const at = cur.hero ? cur.orders.length + 1 : 0; // 0 = 主人公、k = manual[k - 1]
  const index = at > 0 ? manual[at - 1] : undefined;
  const total = manual.length + 1;

  const onCommand = useCallback((command: Command, skillIndex?: number, itemId?: string, targetIndex?: number) => {
    if (!state) return;
    const pick = { command, ...(skillIndex !== undefined ? { skillIndex } : {}), ...(itemId !== undefined ? { itemId } : {}), ...(targetIndex !== undefined ? { targetIndex } : {}) };
    if (!cur.hero) {
      // にげる は主人公だけ。めいれい の仲間がいなければ そのまま送る。
      if (manual.length === 0 || command === 'flee') { send(pick, []); return; }
      setStep({ key: inputKey, hero: pick, orders: [] });
      return;
    }
    const orders = [...cur.orders, { id: state.partyIds![index! - 1]!, ...pick }];
    if (orders.length >= manual.length) send(cur.hero, orders);
    else setStep({ key: inputKey, hero: cur.hero, orders });
  }, [state, cur, manual.length, index, inputKey, send]);

  /** 前の人へ。 */
  const back = useCallback(() => {
    if (!cur.hero) return;
    setStep(cur.orders.length ? { key: inputKey, hero: cur.hero, orders: cur.orders.slice(0, -1) } : { key: inputKey, orders: [] });
  }, [cur, inputKey]);
  /** この人から後ろは おまかせ で送る。 */
  const auto = useCallback(() => { if (cur.hero) send(cur.hero, cur.orders); }, [cur, send]);

  return {
    /** コマンド窓に渡す state (仲間の番はその仲間から見た state)。 */
    view: state && index !== undefined ? allyView(state, index) : state,
    /** 「ミオ は どうする？（2/3）」。めいれい の仲間がいなければ出さない。 */
    heading: state && manual.length ? `${(index !== undefined ? state.allies![index]! : state.player).name} は どうする？（${at + 1}/${total}）` : undefined,
    allyTurn: index !== undefined,
    onCommand, back, auto,
  };
}
