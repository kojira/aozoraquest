import { useCallback, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import type { Agent } from '@atproto/api';
import { BATTLE_TUNING, ITEMS, SEARCH_TUNING, WORLD_MAP_ID, placedItemAt, placedItemAvailable, regionOf, regionsAround, townAt, worldOverlay } from '@aozoraquest/core';
import { serverItem, serverSearch, serverTeleport, type ScenarioMessage } from '@/lib/world-server';
import type { WipePhase } from '@/components/encounter-wipe';
import type { WorldInventory } from '@/lib/use-world-inventory';
import type { Vitals } from '@/lib/world-view';

/**
 * フィールドで使う どうぐ (やくそう/そらのしずく/そらのはね) と しらべる、
 * そらのはね帰還のワイプ進行。消費と在庫はサーバーが確定し、応答で表示を同期する。
 */
export function useWorldFieldItems({ agent, did, combat, inventory, wsRef, setWs, setNotice, scheduleSave, moveBusyRef, tokenRef, flagsRef, pendingNoticesRef, serverPowerRef, setServerPower, setSearchMsg, setFeatherOpen, setWipe, fieldItemBlocked }: {
  agent: Agent | null;
  did: string | null;
  combat: { maxHp: number; maxMp: number } | null;
  inventory: WorldInventory;
  wsRef: MutableRefObject<Vitals | null>;
  setWs: Dispatch<SetStateAction<Vitals | null>>;
  setNotice: Dispatch<SetStateAction<string | null>>;
  scheduleSave: () => void;
  moveBusyRef: MutableRefObject<boolean>;
  tokenRef: MutableRefObject<string | undefined>;
  /** 進行フラグの写し。置きアイテムを取ったら応答で更新する (D-STORY-009)。 */
  flagsRef: MutableRefObject<string[]>;
  /** しらべるの窓を閉じた後に出すシナリオのお知らせ。 */
  pendingNoticesRef: MutableRefObject<ScenarioMessage[]>;
  serverPowerRef: MutableRefObject<number | null>;
  setServerPower: Dispatch<SetStateAction<number | null>>;
  setSearchMsg: Dispatch<SetStateAction<string | null>>;
  setFeatherOpen: Dispatch<SetStateAction<boolean>>;
  setWipe: Dispatch<SetStateAction<WipePhase | null>>;
  /** そらのはねの行き先えらびを開けない状態か (導入中・戦闘・演出・他モーダル)。 */
  fieldItemBlocked: () => boolean;
}) {
  const { herbStock, setHerbStock, tonicStock, setTonicStock, featherStock, setFeatherStock, materialsRef, setMaterialsView, applyServerMaterials, subtractMaterial } = inventory;
  /** そらのはね帰還のワイプ待ち (cover 完了時に onCoverDone がテレポートを実行する) */
  const featherDestRef = useRef<{ x: number; y: number } | null>(null);
  /** しらべるの冪等キー (成功するまで同じ鍵で再送する)。 */
  const pendingSearchRef = useRef<string | null>(null);

  // ワイプ演出の進行。覆い切った時点で支払いがまだ終わっていなければ hold でつなぐ
  // (通信の遅さが「固まった」に見えず、演出の一部になる)。
  const onCoverDone = useCallback(() => {
    // そらのはね帰還: 覆い切ったところでテレポートして開く (旅の演出をワイプで共用)
    const dest = featherDestRef.current;
    if (dest) {
      featherDestRef.current = null;
      const name = townAt(dest.x, dest.y)?.name ?? worldOverlay().spawn.name;
      wsRef.current = {
        x: dest.x,
        y: dest.y,
        hp: null,
        mp: null,
        lastTown: { x: dest.x, y: dest.y },
        regions: [...new Set([...(wsRef.current?.regions ?? []), ...regionsAround(regionOf(dest.x, dest.y))])].sort((a, b) => a - b),
        // 着地先も行き先候補に (通常は既訪だが、念のため union)
        visitedTowns: (wsRef.current?.visitedTowns ?? []).some((v) => v.x === dest.x && v.y === dest.y)
          ? (wsRef.current?.visitedTowns ?? [])
          : [...(wsRef.current?.visitedTowns ?? []), { x: dest.x, y: dest.y }],
        gotStarterFeather: wsRef.current?.gotStarterFeather ?? true,
      };
      setWs(wsRef.current);
      scheduleSave();
      setNotice(`そらのはねで「${name}」へ舞いもどった!`);
      setWipe('reveal');
      // サーバー権威の位置 + トークンも更新 (しないと 1 歩でサーバーの旧位置に戻される)。
      // 同期完了まで移動をブロックし、古いトークンで move されないようにする。
      if (agent) {
        moveBusyRef.current = true;
        void serverTeleport(agent, dest.x, dest.y)
          .then((res) => {
            tokenRef.current = res.token;
            wsRef.current = wsRef.current ? { ...wsRef.current, x: res.x, y: res.y } : wsRef.current;
            setWs(wsRef.current);
            // そらのはね消費はサーバー確定 → 在庫を応答で同期。
            setFeatherStock(res.materials['sky-feather'] ?? 0);
            materialsRef.current = res.materials;
            setMaterialsView({ ...res.materials });
          })
          .catch((e) => { console.warn('[world] teleport sync failed', e); setNotice('ワープをサーバーに反映できなかった (通信エラー)。'); })
          .finally(() => { moveBusyRef.current = false; });
      }
      return;
    }
    // エンカウントは serverMove が既に封印済み (battle は準備完了) なので覆い切ったら開くだけ。
    setWipe('reveal');
  }, [scheduleSave, agent, materialsRef, moveBusyRef, setFeatherStock, setMaterialsView, setNotice, setWipe, setWs, tokenRef, wsRef]);
  const onRevealDone = useCallback(() => setWipe(null), [setWipe]);
  // hold タイムアウト (通常は到達しない。serverMove は遭遇 state を同期で返すので hold に入らない)。
  // 保険としてマップに開き直す。
  const onHoldTimeout = useCallback(() => {
    setNotice('通信が不安定でモンスターを見失った…');
    setWipe('reveal');
  }, [setNotice, setWipe]);

  // フィールドでやくそうを使う (移動せずに回復。消費の保存は TODO(W3) で DO に)
  const useHerbOnField = useCallback((): string | void => {
    if (!combat || herbStock <= 0) return;
    const cur = wsRef.current;
    if (!cur) return;
    const hpNow = Math.min(cur.hp ?? combat.maxHp, combat.maxHp);
    if (hpNow >= combat.maxHp) {
      setNotice('HP は満タンだ。');
      return 'HP は満タンだ。';
    }
    const heal = Math.round(combat.maxHp * BATTLE_TUNING.herbHealRatio);
    const healed = Math.min(combat.maxHp, hpNow + heal);
    // 楽観更新 (即応) → サーバー権威で確定 (在庫消費 + HP 回復を gameState に)。失敗ならロールバック。
    setHerbStock((n) => n - 1);
    subtractMaterial('herb', 1);
    setWs({ ...cur, hp: healed >= combat.maxHp ? null : healed });
    if (agent) void serverItem(agent, 'herb').then((res) => {
      setHerbStock(res.materials['herb'] ?? 0);
      materialsRef.current = res.materials;
      setMaterialsView({ ...res.materials });
      setWs((s) => (s ? { ...s, hp: res.carryHp ?? null } : s));
    }).catch((e) => { console.warn('[world] herb use failed', e); setHerbStock((n) => n + 1); setNotice('やくそうを つかえなかった (通信エラー)。'); });
    const m = `やくそうを使った! HP が ${healed - hpNow} 回復。`;
    setNotice(m);
    scheduleSave();
    return m;
  }, [combat, herbStock, agent, scheduleSave, subtractMaterial, materialsRef, setHerbStock, setMaterialsView, setNotice, setWs, wsRef]);

  // フィールドでそらのしずくを使う (MP 回復)
  const useTonicOnField = useCallback((): string | void => {
    if (!combat || tonicStock <= 0) return;
    const cur = wsRef.current;
    if (!cur) return;
    const mpNow = Math.min(cur.mp ?? combat.maxMp, combat.maxMp);
    if (mpNow >= combat.maxMp) {
      setNotice('MP は満タンだ。');
      return 'MP は満タンだ。';
    }
    const gain = Math.max(1, Math.round(combat.maxMp * BATTLE_TUNING.tonicMpRatio));
    const restored = Math.min(combat.maxMp, mpNow + gain);
    setTonicStock((n) => n - 1);
    subtractMaterial('sky-dew', 1);
    setWs({ ...cur, mp: restored >= combat.maxMp ? null : restored });
    if (agent) void serverItem(agent, 'tonic').then((res) => {
      setTonicStock(res.materials['sky-dew'] ?? 0);
      materialsRef.current = res.materials;
      setMaterialsView({ ...res.materials });
      setWs((s) => (s ? { ...s, mp: res.carryMp ?? null } : s));
    }).catch((e) => { console.warn('[world] tonic use failed', e); setTonicStock((n) => n + 1); setNotice('そらのしずくを つかえなかった (通信エラー)。'); });
    const m = `そらのしずくを使った! MP が ${restored - mpNow} 回復。`;
    setNotice(m);
    scheduleSave();
    return m;
  }, [combat, tonicStock, agent, scheduleSave, subtractMaterial, materialsRef, setMaterialsView, setNotice, setTonicStock, setWs, wsRef]);

  // そらのはねを使う: 訪問済みの街から行き先を選ぶ。
  // フィールド専用 (戦闘中はにげるを使う)。消費の保存は TODO(W3) で DO に
  const useFeatherOnField = useCallback(() => {
    if (featherStock <= 0) return;
    // mapOpen / shopOpen も塞ぐ (モーダルの裏へ Tab で抜けて発動でき、店を開いた
    // まま別の街へテレポートすると品揃えが無言で差し替わる — レビュー指摘)
    if (!wsRef.current || fieldItemBlocked()) return;
    setFeatherOpen(true); // 行き先えらびを開く (選ぶと flyToTown が飛ばす)
  }, [featherStock, fieldItemBlocked, setFeatherOpen, wsRef]);

  // 選んだ街へ飛ぶ (そらのはね消費 + ワイプ演出でテレポート)。FeatherModal は選択時に
  // 先に onClose するので二度押しは構造的に不可 (featherStock の stale closure 無害)
  const flyToTown = useCallback((dest: { x: number; y: number }) => {
    const s = wsRef.current;
    if (!s || featherStock <= 0) return;
    // 今いる街は FeatherModal 側で候補除外済み。ここは防御の二重ガード (レビュー ★)
    if (s.x === dest.x && s.y === dest.y) {
      setNotice('もうその街にいる。');
      return;
    }
    // そらのはねの消費はサーバー (handleTeleport) が行う → onCoverDone の serverTeleport 応答で在庫更新。
    // ここでは楽観的に featherStock だけ即減らす (材料 map はサーバー応答で確定)。
    setFeatherStock((n) => Math.max(0, n - 1));
    featherDestRef.current = dest;
    // cover が画面を覆うまでの間に「自分の操作の結果」と分かる一言を出す
    // (エンカウント演出と同一のワイプなので、無言だと戦闘が始まると誤解する)
    setNotice('そらのはねをつかった!');
    setWipe('cover'); // 覆い切ったら onCoverDone がテレポートする
  }, [featherStock, setFeatherStock, setNotice, setWipe, wsRef]);

  // しらべる: **サーバーがアイテムを判定して gameState 在庫に付与** (client のみの幻を解消)。
  // luk 連動でアイテムが手に入ることがある (見つからないこともある)。
  // 結果 (found/materials) はサーバー応答で確定し表示を同期する。
  const searchHere = useCallback(async (): Promise<void> => {
    const s = wsRef.current;
    if (!s || !agent || !did) { setSearchMsg('いま しらべられない (つうしんを かくにんして)。'); return; }
    // **残高の判定も消費もサーバー** (#551)。client 台帳で引いていた頃は権威 power が
    // 動かず、いくらでも しらべられた。ここでは先読みの案内だけ出す。
    // 未取得の置きアイテム (D-STORY-009) があるマスはパワーを使わないので止めない (付与は edge が決める)。
    const placed = placedItemAt(s.mapId ?? WORLD_MAP_ID, s.x, s.y);
    const placedHere = !!placed && placedItemAvailable(placed, flagsRef.current);
    if (!placedHere && serverPowerRef.current !== null && serverPowerRef.current < SEARCH_TUNING.powerCost) {
      setSearchMsg(`パワーが たりない (しらべるには ${SEARCH_TUNING.powerCost} いる)。とうこうすると ふえるよ。`);
      return;
    }
    setSearchMsg('あたりを しらべている…');
    try {
      // 冪等キー: 応答だけ落ちて押し直したときに二重に引かれないよう、成功するまで同じ鍵を使う。
      const sKey = pendingSearchRef.current ?? (pendingSearchRef.current = `s-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`);
      const res = await serverSearch(agent, tokenRef.current, sKey);
      pendingSearchRef.current = null;
      applyServerMaterials(res.materials);
      setServerPower(res.power); // 残高もサーバーが正
      if (res.placed) {
        // 反映しないと、取った後のゲート・セリフの分岐が再読み込みまで変わらない。
        if (res.flags) flagsRef.current = res.flags;
        if (res.scenarioMessages?.length) pendingNoticesRef.current = [...pendingNoticesRef.current, ...res.scenarioMessages];
        const count = res.placed.count > 1 ? ` を ${res.placed.count} こ` : ' を';
        setSearchMsg(`${ITEMS[res.placed.itemId]?.name ?? res.placed.itemId}${count} てにいれた!`);
        return;
      }
      if (!res.found) { setSearchMsg(`あたりを しらべたが、なにも なかった… (のこりパワー ${res.power})`); return; }
      const isConsumable = res.found === 'herb' || res.found === 'sky-dew';
      setSearchMsg(`しらべると、${ITEMS[res.found]?.name ?? res.found} を 1 つ 見つけた! (${isConsumable ? 'どうぐ' : 'もちもの'}で かくにん / のこりパワー ${res.power})`);
    } catch (e) {
      console.warn('[world] search failed', e);
      setSearchMsg('しらべられなかった (通信エラー)。もういちどどうぞ。');
    }
  }, [agent, did, applyServerMaterials, flagsRef, pendingNoticesRef, serverPowerRef, setSearchMsg, setServerPower, tokenRef, wsRef]);

  return { onCoverDone, onRevealDone, onHoldTimeout, useHerbOnField, useTonicOnField, useFeatherOnField, flyToTown, searchHere };
}
