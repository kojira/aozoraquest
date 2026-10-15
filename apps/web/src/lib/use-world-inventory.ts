import { useCallback, useRef, useState } from 'react';

/**
 * ワールド画面の素材在庫 (表示用の写し)。在庫の正はサーバー gameState で、ここは
 * 応答を反映するだけ。materialsRef は deps の狭い callback から最新を読むため、
 * materialsView は再レンダー用の複製、herb/tonic/feather は どうぐ 窓の個数。
 */
export function useWorldInventory() {
  /** やくそう/そらのしずくの手持ち。戦闘内の使用と獲得は battle レコードに残る。
   *  フィールドでの使用はセッション内のみ (TODO(W3): 在庫の正を Worker/DO に移す)。 */
  const [herbStock, setHerbStock] = useState(0);
  const [tonicStock, setTonicStock] = useState(0);
  const [featherStock, setFeatherStock] = useState(0);
  /** 素材の全在庫 (敗北ロス抽選の母集団)。ロード時に battle stats から初期化し、
   *  ドロップ/使用 (戦闘内・フィールドとも)/敗北ロスをセッション内で追随する */
  const materialsRef = useRef<Record<string, number>>({});
  /** ShopModal 用の素材スナップショット (materialsRef は ref なので再レンダ用に複製) */
  const [materialsView, setMaterialsView] = useState<Record<string, number>>({});
  /** サーバーが返した在庫をそのまま正として反映する (#551)。client 側で引き算しない —
   *  引き算だけだとリロードで権威側の在庫が戻り、素材が複製できてしまう。 */
  const applyServerMaterials = useCallback((m: Record<string, number>) => {
    materialsRef.current = { ...m };
    setMaterialsView({ ...m });
    setHerbStock(m['herb'] ?? 0);
    setTonicStock(m['sky-dew'] ?? 0);
    setFeatherStock(m['sky-feather'] ?? 0);
  }, []);
  const subtractMaterial = useCallback((id: string, n: number) => {
    if (!n) return;
    const m = materialsRef.current;
    const left = Math.max(0, (m[id] ?? 0) - n);
    if (left > 0) m[id] = left;
    else delete m[id];
  }, []);
  return {
    herbStock, setHerbStock, tonicStock, setTonicStock, featherStock, setFeatherStock,
    materialsRef, materialsView, setMaterialsView, applyServerMaterials, subtractMaterial,
  };
}

export type WorldInventory = ReturnType<typeof useWorldInventory>;
