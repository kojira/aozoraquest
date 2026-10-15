import { useCallback, useRef, useState, type MutableRefObject } from 'react';
import type { Agent } from '@atproto/api';
import { EQUIPMENT_BY_ID, equipHands, interiorShopAt, townAt, townShopStock, worldOverlay, type EquipmentDef } from '@aozoraquest/core';
import { serverShopCraft, serverShopDiscard, serverShopForge, serverShopSell, serverState, WorldServerError, type ServerOwnedPiece } from '@/lib/world-server';
import { CraftLogError, craftItem, discardItems, forgeItems, newCraftRkey, newDiscardRkey, newForgeRkey, newSaleRkey, sellMaterials, type CraftedPiece } from '@/lib/crafting';
import { enqueueCraftLog, flushCraftLogs } from '@/lib/craft-log-queue';
import { saveGearRefs, type GearRefs } from '@/lib/gear';
import type { LastShopAction } from '@/components/shop-modal';
import type { WorldInventory } from '@/lib/use-world-inventory';

/** お店のエラーを、サーバーが返した理由でそのまま伝える。「通信エラー」で片付けると
 *  「パワーが足りない」「街の外」といった直せる理由が消える (#551)。 */
export function shopErrorText(e: unknown, fallback: string): string {
  const msg = e instanceof WorldServerError ? e.message : '';
  return msg ? `${msg}。` : `${fallback} (通信エラー)。もういちどどうぞ。`;
}

/** サーバーの所持個体を表示用の CraftedPiece にする (所持の正はサーバー #551 段階 2)。 */
export const piecesFromServer = (pieces: ServerOwnedPiece[]): CraftedPiece[] =>
  pieces.map((p) => ({ rkey: p.rkey, itemId: p.itemId, level: p.level, at: '' }));

/**
 * いま利用できる店の街 (#424)。フィールドの街タイルか、内部マップの
 * なんでも屋のマスに立っているときだけ返す。**品揃えと値段は街の座標で決まる**
 * ので、村の中でもその街の店として扱う。
 */
export function shopTownAt(at: { x: number; y: number; mapId?: string } | null | undefined) {
  if (!at) return null;
  if (at.mapId) {
    const sp = interiorShopAt(at.mapId, at.x, at.y);
    return sp ? townAt(sp.town.x, sp.town.y) ?? null : null;
  }
  return townAt(at.x, at.y) ?? null;
}

/** 手数の競合 (#609) は**装備した側を通し、逆側を外す** (DQ 流の入れ替え)。
 *  外さず保存すると core が盾を落とすので「そうび中なのに効果なし」の矛盾表示になる。 */
export function equipWithHands(refs: GearRefs, slot: keyof GearRefs, rkey: string, pieces: readonly CraftedPiece[]): GearRefs {
  const next = { ...refs, [slot]: rkey };
  if (slot === 'weapon' || slot === 'shield') {
    const other = slot === 'weapon' ? 'shield' : 'weapon';
    const defOfRkey = (rk?: string) => (rk ? EQUIPMENT_BY_ID[pieces.find((p) => p.rkey === rk)?.itemId ?? ''] : undefined);
    const mine = defOfRkey(rkey);
    const theirs = defOfRkey(next[other]);
    if (mine && theirs && equipHands(mine) + equipHands(theirs) > 2) delete next[other];
  }
  return next;
}

/**
 * なんでも屋 (制作/合成/ひきとり) と そうび (着脱/すてる) の状態と操作 (docs/20)。
 * 費用・在庫・所持個体の正はサーバーで、ユーザー PDS の craft レコードは記帳 (履歴)。
 */
export function useWorldShop({ agent, did, inventory, lukRef, serverPowerRef, setServerPower, tokenRef, wsRef, setNotice }: {
  agent: Agent | null;
  did: string | null;
  inventory: WorldInventory;
  /** 制作の記帳に残す luk (装備込みの最新値。未診断は 0)。装備は この hook の state から
   *  導出されるので、値ではなく描画ごとに更新される ref で受ける。 */
  lukRef: MutableRefObject<number>;
  serverPowerRef: MutableRefObject<number | null>;
  setServerPower: (power: number) => void;
  tokenRef: MutableRefObject<string | undefined>;
  wsRef: MutableRefObject<{ x: number; y: number; mapId?: string } | null>;
  setNotice: (notice: string | null) => void;
}) {
  const { materialsRef, setMaterialsView, applyServerMaterials } = inventory;
  const [shopOpen, setShopOpen] = useState(false);
  const [craftedPieces, setCraftedPieces] = useState<CraftedPiece[]>([]);
  const [gearRefs, setGearRefs] = useState<GearRefs>({});
  const [gearOpen, setGearOpen] = useState(false);
  const [craftBusy, setCraftBusy] = useState(false);
  /** お店の失敗理由 (#551)。ページ本体の通知行はモーダルの背面に隠れるので、モーダル内に出す。 */
  const [shopError, setShopError] = useState<string | null>(null);
  /** 記帳だけ落ちたときの控えめな知らせ (#642)。品もパワーも動いていないので赤字にしない。 */
  const [shopNotice, setShopNotice] = useState<string | null>(null);
  const [lastShopAction, setLastShopAction] = useState<LastShopAction | null>(null);
  /** 再試行の冪等化: 失敗した制作/合成/ひきとりの rkey を保持し、同条件の再試行で
   *  使い回す (createRecord は同 rkey で衝突するため 2 重記帳が構造的に起きない) */
  const pendingCraftRef = useRef<{ defId: string; rkey: string } | null>(null);
  const pendingDiscardRef = useRef<Record<string, string>>({});
  const pendingForgeRef = useRef<{ key: string; rkey: string } | null>(null);
  const pendingSaleRef = useRef<{ key: string; rkey: string } | null>(null);

  /** 記帳 (ユーザー PDS の履歴) の失敗を保留に積む (#642)。所持の権威はサーバーなので
   *  品もパワーも動かないが、黙って捨てると履歴が永久に欠け、パワー会計もずれる。 */
  const keepCraftLog = useCallback((where: string, e: unknown) => {
    console.warn(`[world] ${where} log failed`, e);
    if (did && e instanceof CraftLogError) enqueueCraftLog(did, e, new Date().toISOString());
  }, [did]);

  /** 保留した記帳を書き直す。店を開いたときと世界に入ったときに 1 回ずつ試す。 */
  const flushCraftLog = useCallback(() => {
    if (!agent || !did) return;
    void flushCraftLogs(agent, did).catch((e) => console.warn('[world] craft log flush failed', e));
  }, [agent, did]);

  /** 店を開く前の状態合わせ。扉から入る経路とメニュー経路で**同じにする** (#638 レビュー ★★★)。
   *  抜くと表示在庫が読み込み時のまま = 戦闘で拾った素材が反映されず、全品が
   *  「素材が足りない」で disabled になる。前回の「○○ が できた!」やエラーが残ると
   *  あいさつも出ない。 */
  const resetShopView = useCallback(() => {
    setLastShopAction(null);
    setShopError(null);
    setShopNotice(null);
    setMaterialsView({ ...materialsRef.current });
    flushCraftLog(); // 前に書けなかった記帳をここで書き直す (#642)
  }, [flushCraftLog, materialsRef, setMaterialsView]);

  /** メニューの「なんでも屋」。入場時に serverState が落ちていると残高が null のまま復旧経路が
   *  無く、店が「パワー 0」で全品グレーアウトして死んで見える (#551 レビュー指摘)。開くたびに取り直す。 */
  const openShopFromMenu = () => {
    resetShopView();
    if (serverPowerRef.current === null && agent) {
      void serverState(agent)
        .then((s) => { setServerPower(s.state.power ?? 0); if (s.state.pieces) setCraftedPieces(piecesFromServer(s.state.pieces)); })
        .catch((e) => { console.warn('[world] shop reload failed', e); setShopError('パワー残高を読み込めなかった (通信を確認して開き直して)。'); });
    }
    setShopOpen(true);
  };

  const onCraft = useCallback(
    async (def: EquipmentDef) => {
      if (!agent || !did || craftBusy) return;
      // **村の中のなんでも屋にも対応する** (#424)。フィールドの街しか見ていなかったため、
      // 村の店で「つくってもらう」を押すと、ここで黙って return して**何も起きなかった**
      // (窓だけ閉じたように見える)。店のマスに立っているならその店の街を使う。
      const town = shopTownAt(wsRef.current);
      if (!town) return;
      const towns = worldOverlay().towns;
      const townIndex = Math.max(0, towns.findIndex((t) => t.x === town.x && t.y === town.y));
      const stock = townShopStock(town, townIndex);
      const have = materialsRef.current[stock.materialId] ?? 0;
      // 残高と素材の判定は**サーバーが正**。ここは押せるかの目安 (先読み) だけ。
      if ((serverPowerRef.current ?? 0) < def.price.power || have < def.price.materials) return;
      // 冪等化: 直前に同じ品で失敗していたら同じ rkey で再試行する
      // (createRecord は同 rkey で衝突するため 2 重制作が構造的に起きない。レビュー指摘)
      const rkey = pendingCraftRef.current?.defId === def.id ? pendingCraftRef.current.rkey : newCraftRkey();
      pendingCraftRef.current = { defId: def.id, rkey };
      setShopError(null);
      setShopNotice(null);
      setCraftBusy(true);
      try {
        // **費用の支払いと強化値の抽選はサーバー** (#551)。素材もパワーも権威側から引かれ、
        // 結果の在庫がそのまま返る (client の減算だけでは、リロードで素材が戻る = 複製できた)。
        const res = await serverShopCraft(agent, def.id, rkey, tokenRef.current);
        setServerPower(res.power);
        applyServerMaterials(res.materials);
        // 個体そのもの (強化値つきレコード) はまだユーザー PDS。サーバーが決めた level を記帳する。
        // 個体の権威化は #551 段階 2。
        // 記帳 (ユーザー PDS の履歴)。所持の根拠はサーバーなので、ここが落ちても品は手元にある。
        // ただし黙って終わると「パワーだけ減って何も起きなかった」に見えるので必ず伝える。
        const piece = await craftItem(
          agent,
          {
            itemId: def.id,
            materialId: stock.materialId,
            materialCount: def.price.materials,
            power: def.price.power,
            luk: lukRef.current,
            level: res.level ?? 0,
          },
          rkey,
        ).catch((e) => {
          keepCraftLog('craft', e);
          // 品もパワーも既にサーバー側で確定しているので、失敗として赤字で出さない (#642)。
          // 欠けたのは履歴だけで、それは保留してあとで書き直す。
          setShopNotice('記録はあとで残す (品は もちものに入っている)。');
          return { rkey, itemId: def.id, level: res.level ?? 0, at: new Date().toISOString() };
        });
        pendingCraftRef.current = null;
        if (res.pieces) setCraftedPieces(piecesFromServer(res.pieces));
        setLastShopAction({ piece, kind: 'craft' });
      } catch (e) {
        // 失敗しても店は開いたまま (再試行させる。同 rkey なので 2 重にならない)
        console.warn('[world] craft failed', e);
        setLastShopAction(null);
        setShopError(shopErrorText(e, 'つくってもらえなかった'));
      } finally {
        setCraftBusy(false);
      }
    },
    [agent, did, craftBusy, keepCraftLog, applyServerMaterials, lukRef, materialsRef, serverPowerRef, setServerPower, tokenRef, wsRef],
  );

  // 合成 (きたえる): 同アイテム・同強化値 2 個体 → +1。素材もパワーも不要
  // (燃やす 2 個体そのものが対価 — docs/20 のシンク設計)
  const onForge = useCallback(
    async (def: EquipmentDef, resultLevel: number, rkeys: [string, string]) => {
      if (!agent || !did || craftBusy) return;
      const forgeKey = `${def.id}:${rkeys[0]}:${rkeys[1]}`;
      const frkey = pendingForgeRef.current?.key === forgeKey ? pendingForgeRef.current.rkey : newForgeRkey();
      pendingForgeRef.current = { key: forgeKey, rkey: frkey };
      setShopError(null);
      setShopNotice(null);
      setCraftBusy(true);
      try {
        // **合成もサーバー** (#551 段階 2)。消費する個体は権威側の所持から探すので、
        // 持っていない rkey や強化値の食い違いは通らない。
        const res = await serverShopForge(agent, rkeys, frkey, tokenRef.current);
        pendingForgeRef.current = null;
        if (res.pieces) setCraftedPieces(piecesFromServer(res.pieces));
        const piece: CraftedPiece = { rkey: frkey, itemId: def.id, level: res.level ?? resultLevel, at: new Date().toISOString() };
        // 記帳 (履歴)。所持の根拠ではないので、失敗しても進める。
        void forgeItems(agent, { itemId: def.id, resultLevel: piece.level, consumed: rkeys }, frkey)
          .catch((e) => keepCraftLog('forge', e));
        setLastShopAction({ piece, kind: 'forge' });
      } catch (e) {
        console.warn('[world] forge failed', e);
        setLastShopAction(null);
        setShopError(shopErrorText(e, 'きたえてもらえなかった'));
      } finally {
        setCraftBusy(false);
      }
    },
    [agent, did, craftBusy, keepCraftLog, tokenRef],
  );

  // 素材のひきとり (素材 → パワー。docs/20 の低レート変換)
  const onSell = useCallback(
    async (materialId: string, count: number) => {
      if (!agent || !did || craftBusy || count <= 0) return;
      if ((materialsRef.current[materialId] ?? 0) < count) return;
      const saleKey = `${materialId}:${count}`;
      const srkey = pendingSaleRef.current?.key === saleKey ? pendingSaleRef.current.rkey : newSaleRkey();
      pendingSaleRef.current = { key: saleKey, rkey: srkey };
      setShopError(null);
      setShopNotice(null);
      setCraftBusy(true);
      try {
        // **在庫と残高の増減はサーバー** (#551)。client 台帳だけだと「パワーが 5 ふえた!」と
        // 出ても権威側は動かず、戦闘の報酬にも効かなかった。
        const res = await serverShopSell(agent, materialId, count, srkey, tokenRef.current);
        pendingSaleRef.current = null;
        setServerPower(res.power);
        applyServerMaterials(res.materials);
        // 記帳 (履歴)。数量とパワーはサーバーが確定した値で書く。
        await sellMaterials(agent, { materialId, materialCount: count }, srkey).catch((e) => keepCraftLog('sale', e));
        // 結果はモーダル内のセリフ窓で出す (#607)。世界の通知行はモーダルの背面で見えない。
        setLastShopAction({ kind: 'sell', materialId, count, powerGained: res.powerGained ?? 0 });
      } catch (e) {
        console.warn('[world] sell failed', e);
        setShopError(shopErrorText(e, 'ひきとってもらえなかった'));
      } finally {
        setCraftBusy(false);
      }
    },
    [agent, did, craftBusy, keepCraftLog, applyServerMaterials, materialsRef, setServerPower, tokenRef],
  );

  // 装備の着脱 (gear/self は rkey 参照 — 強化値は直書きしない。docs/20 W6c 契約)
  const gearSavingRef = useRef(false);
  const onEquipChange = useCallback(
    async (next: GearRefs) => {
      if (!agent || gearSavingRef.current) return; // 並行保存で後勝ち巻き戻しを防ぐ
      gearSavingRef.current = true;
      const prev = gearRefs;
      setGearRefs(next); // 楽観更新 (HP/MP バーが即応する)
      try {
        await saveGearRefs(agent, next);
      } catch (e) {
        console.warn('[world] gear save failed', e);
        // 失敗時のみ、まだ next のままなら巻き戻す (関数型で他更新を潰さない)
        setGearRefs((cur) => (cur === next ? prev : cur));
        setNotice('そうびを保存できなかった (通信エラー)。');
      } finally {
        gearSavingRef.current = false;
      }
    },
    [agent, gearRefs, setNotice],
  );

  const onDiscard = (rkey: string) => {
    // **すてるは街の外でもできる** (#575)。所持上限に達すると制作も購入も
    // 断られるので、街に着くまで整理できないと詰む。パワーは返らない。
    if (!agent) return;
    setShopError(null);
    setCraftBusy(true);
    // **冪等キーは個体ごとに固定する。** 呼び出しの中で採番すると、応答だけ
    // 落ちた後の押し直しが毎回別 op になり、サーバーの二重実行防止が一度も
    // 効かない (2 回目は必ず not_owned になる)。craft と同じ作法。
    const dkey = pendingDiscardRef.current[rkey] ?? newDiscardRkey();
    pendingDiscardRef.current[rkey] = dkey;
    void (async () => {
      try {
        const res = await serverShopDiscard(agent, [rkey], dkey);
        delete pendingDiscardRef.current[rkey];
        if (res.pieces) setCraftedPieces(piecesFromServer(res.pieces));
        // PDS 側にも墓標を残す (/me の集計が捨てた装備を数えたままにならないように)。
        // 権威は既にサーバーで減っているので、失敗しても進める。
        void discardItems(agent, [rkey], dkey).catch((e) => keepCraftLog('discard', e));
      } catch (e) {
        console.warn('[world] discard failed', e);
        setShopError(shopErrorText(e, 'すてられなかった'));
      } finally {
        setCraftBusy(false);
      }
    })();
  };
  const onEquip = (slot: keyof GearRefs, rkey: string) => void onEquipChange(equipWithHands(gearRefs, slot, rkey, craftedPieces));
  const onUnequip = (slot: keyof GearRefs) => {
    const next = { ...gearRefs };
    delete next[slot];
    void onEquipChange(next);
  };

  return {
    shopOpen, setShopOpen, gearOpen, setGearOpen, craftedPieces, setCraftedPieces, gearRefs, setGearRefs,
    craftBusy, shopError, shopNotice, lastShopAction, flushCraftLog, resetShopView, openShopFromMenu,
    onCraft, onForge, onSell, onDiscard, onEquip, onUnequip,
  };
}
