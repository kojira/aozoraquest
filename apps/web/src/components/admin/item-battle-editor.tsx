import { STATUS_REGISTRY, type ItemDefData, type SkillEffect, type StatusId } from '@aozoraquest/core';

/**
 * /admin/items の「どうぐ」1 行に付ける、戦闘で使う どうぐ と 店の欄 (D-ITEM-001 §6)。
 * 「戦闘でつかう」を入れると効果の行が開く。説明・値段・shopTier はどの消耗品にも出す (ItemShopEditor)。
 * 検証は保存のとき core の validateItems (setItemOverrides) が行う (ここでは値の形を整えるだけ)。
 */
type ItemEffect = Extract<SkillEffect, { kind: 'status' | 'heal' | 'cleanse' | 'restoreMp' }>;
const EFFECT_KINDS: ReadonlyArray<[ItemEffect['kind'], string]> = [['status', '状態'], ['heal', 'HP回復'], ['cleanse', '状態回復'], ['restoreMp', 'MP回復']];
const STATUS_TARGETS = [['enemy', '敵1体'], ['allEnemies', '敵全体'], ['self', '自分'], ['allAllies', '味方全体']] as const;
const STATUS_IDS = Object.keys(STATUS_REGISTRY) as StatusId[];

function defaultEffect(kind: ItemEffect['kind']): ItemEffect {
  if (kind === 'status') return { kind, status: 'sleep', target: 'enemy', chance: 1, turns: 3 };
  if (kind === 'cleanse') return { kind, target: 'self' };
  return { kind, ratio: 0.3 };
}

const num = (v: string): number | undefined => (v === '' ? undefined : Number(v));

export function ItemBattleEditor({ item, onChange }: { item: ItemDefData; onChange: (next: ItemDefData) => void }) {
  const effects = (item.battle?.effects ?? []) as ItemEffect[];
  const setEffects = (next: ItemEffect[]) => onChange({ ...item, battle: { effects: next } });
  const setEffect = (i: number, patch: Record<string, unknown>) => {
    setEffects(effects.map((e, j) => {
      if (j !== i) return e;
      const merged = { ...e, ...patch } as Record<string, unknown>;
      for (const [k, v] of Object.entries(patch)) if (v === undefined) delete merged[k];
      return merged as ItemEffect;
    }));
  };
  const small = { fontSize: '0.8em' } as const;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2em', margin: '0.1em 0 0.4em 1em', ...small }}>
      {effects.map((e, i) => (
        <div key={i} style={{ display: 'flex', gap: '0.3em', alignItems: 'center', flexWrap: 'wrap' }}>
          <select aria-label="効果の種類" value={e.kind} onChange={(ev) => setEffects(effects.map((x, j) => (j === i ? defaultEffect(ev.target.value as ItemEffect['kind']) : x)))}>
            {EFFECT_KINDS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
          </select>
          {e.kind === 'status' && (
            <>
              <select aria-label="状態" value={e.status} onChange={(ev) => setEffect(i, { status: ev.target.value as StatusId })}>
                {STATUS_IDS.map((id) => <option key={id} value={id}>{STATUS_REGISTRY[id].name}</option>)}
              </select>
              <select aria-label="対象" value={e.target} onChange={(ev) => setEffect(i, { target: ev.target.value as typeof e.target })}>
                {STATUS_TARGETS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
              </select>
              <label>確率 <input aria-label="確率" type="number" step="0.05" min="0" max="1" value={e.chance ?? ''} onChange={(ev) => setEffect(i, { chance: num(ev.target.value) })} style={{ width: '4em' }} /></label>
              <label>ターン <input aria-label="ターン" type="number" min="1" max="5" value={e.turns ?? ''} onChange={(ev) => setEffect(i, { turns: num(ev.target.value) })} style={{ width: '3em' }} /></label>
              <label>強さ <input aria-label="強さ" type="number" step="0.1" value={e.magnitude ?? ''} placeholder="既定" onChange={(ev) => setEffect(i, { magnitude: num(ev.target.value) })} style={{ width: '4em' }} /></label>
            </>
          )}
          {e.kind === 'cleanse' && (
            <select aria-label="対象" value={e.target} onChange={(ev) => setEffect(i, { target: ev.target.value as 'self' | 'allAllies' })}>
              <option value="self">自分</option>
              <option value="allAllies">味方全体</option>
            </select>
          )}
          {(e.kind === 'heal' || e.kind === 'restoreMp') && (
            <label>割合 <input aria-label="割合" type="number" step="0.05" min="0" max="1" value={e.ratio} onChange={(ev) => setEffect(i, { ratio: Number(ev.target.value) })} style={{ width: '4em' }} /></label>
          )}
          <button type="button" aria-label="効果を消す" onClick={() => setEffects(effects.filter((_, j) => j !== i))} style={small}>×</button>
        </div>
      ))}
      <button type="button" onClick={() => setEffects([...effects, defaultEffect('status')])} style={{ ...small, alignSelf: 'flex-start' }}>＋効果</button>
    </div>
  );
}

/** 消耗品の 説明・値段・shopTier (戦闘で使うかどうかによらない。やくそう・しずく・はねの値段もここで付ける)。 */
export function ItemShopEditor({ item, onChange }: { item: ItemDefData; onChange: (next: ItemDefData) => void }) {
  const setField = <K extends 'desc' | 'price' | 'shopTier'>(k: K, v: ItemDefData[K] | undefined) => {
    const next = { ...item } as Record<string, unknown>;
    if (v === undefined) delete next[k];
    else next[k] = v;
    onChange(next as unknown as ItemDefData);
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2em', margin: '0.1em 0 0.4em 1em', fontSize: '0.8em' }}>
      <label style={{ display: 'flex', gap: '0.3em', alignItems: 'center' }}>
        説明
        <input aria-label={`${item.id} の説明`} value={item.desc ?? ''} maxLength={60} onChange={(ev) => setField('desc', ev.target.value || undefined)} style={{ flex: 1 }} />
      </label>
      <ItemShopFields item={item} setField={setField} />
    </div>
  );
}

/** 店で売るときの値段 (パワー + その店の値札の素材) と、並び始める街の tier。値段を空にすると売らない。 */
function ItemShopFields({ item, setField }: {
  item: ItemDefData;
  setField: <K extends 'price' | 'shopTier'>(k: K, v: ItemDefData[K] | undefined) => void;
}) {
  return (
    <span style={{ display: 'flex', gap: '0.3em', alignItems: 'center', flexWrap: 'wrap' }}>
      値段 パワー
      <input
        aria-label={`${item.id} の値段 パワー`} type="number" min="0" value={item.price?.power ?? ''}
        onChange={(ev) => setField('price', ev.target.value === '' ? undefined : { power: Number(ev.target.value), materials: item.price?.materials ?? 0 })}
        style={{ width: '4em' }}
      />
      + 素材
      <input
        aria-label={`${item.id} の値段 素材`} type="number" min="0" value={item.price?.materials ?? ''} disabled={!item.price}
        onChange={(ev) => setField('price', { power: item.price?.power ?? 0, materials: Number(ev.target.value || 0) })}
        style={{ width: '3em' }}
      />
      こ / 店
      <select aria-label={`${item.id} の店の tier`} value={item.shopTier ?? ''} onChange={(ev) => setField('shopTier', ev.target.value === '' ? undefined : (Number(ev.target.value) as 1 | 2 | 3))}>
        <option value="">並べない</option>
        <option value="1">tier1〜</option>
        <option value="2">tier2〜</option>
        <option value="3">tier3〜</option>
      </select>
    </span>
  );
}
