import { useCallback, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  activeEquipment,
  activeItems,
  maxShopGradeForTier,
  shopKeeperFor,
  shopOverrides,
  MAX_KEEPER_LINE,
  ShopDataError,
  tierForRegion,
  townShopStock,
  worldOverlay,
  type ShopOverride,
  type Town,
} from '@aozoraquest/core';
import { useSession } from '@/lib/session';
import { isAdminDid } from '@/lib/runtime-config';
import { saveShops } from '@/lib/world-authoring';
import { useAuthoredWorld } from '@/lib/use-authored-world';
import { AuthoredWorldGate } from '@/components/admin/authored-world-gate';

/**
 * **お店のラインナップエディタ** (#422)。
 *
 * 品揃えは街の座標から決定的に生成されていて、狙って変えられなかった
 * (街を動かすと品揃えが全部変わる、という副作用しかなかった)。
 * **上書きした店だけ**明示のラインナップになり、他の店は従来どおり生成。
 */
export function AdminShops() {
  const session = useSession();
  const admin = isAdminDid(session.did ?? null);
  const [overrides, setOverrides] = useState<ShopOverride[]>(() => shopOverrides());
  const [sel, setSel] = useState<Town | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  // 保存済みレコードを読み込むまで保存させない (直接開いて保存すると上書き中の店が全部消える。#603)。
  const loaded = useAuthoredWorld(session.agent ?? null, () => setOverrides(shopOverrides()));
  // 街の一覧も地図の読み込みで変わる (直接開くと読み込み前は空)。
  const towns = useMemo(() => worldOverlay().towns, [loaded]);

  const equipment = activeEquipment();
  const items = activeItems();

  const overrideOf = useCallback(
    (t: Town) => overrides.find((o) => o.x === t.x && o.y === t.y),
    [overrides],
  );

  /** いまの実効ラインナップ (上書き + 生成の合成)。プレイヤーが見るものと同じ。 */
  const effective = useCallback((t: Town) => {
    const i = towns.indexOf(t);
    return townShopStock(t, i < 0 ? 0 : i);
  }, [towns]);

  // exactOptionalPropertyTypes のため、undefined は「キーごと消す」に読み替える
  const setField = useCallback((t: Town, patch: { [K in keyof ShopOverride]?: ShopOverride[K] | undefined }) => {
    setOverrides((xs) => {
      const rest = xs.filter((o) => o.x !== t.x || o.y !== t.y);
      const cur = xs.find((o) => o.x === t.x && o.y === t.y) ?? { x: t.x, y: t.y };
      const merged = { ...cur } as Record<string, unknown>;
      for (const [k, v] of Object.entries(patch)) {
        if (v === undefined) delete merged[k];
        else merged[k] = v;
      }
      const m = merged as unknown as ShopOverride;
      // **店主も「中身」に数える。** 数えていなかったため、店主だけ入力すると
      // 「空の上書き」と判定されて一覧から捨てられ、**打った文字が即座に消えていた**
      // (実機で「テキスト入力欄が入力できない」と指摘)。
      const hasKeeper = !!m.keeper && Object.values(m.keeper).some((v) => v !== undefined && v !== '');
      const empty = !m.equipment && !m.consumables && !m.materialId && !hasKeeper;
      return empty ? rest : [...rest, m];
    });
    setDirty(true);
  }, []);

  const save = useCallback(async () => {
    if (!session.agent) return;
    try {
      await saveShops(session.agent, overrides);
      setDirty(false);
      setNote(`保存した (${overrides.length} 店を上書き)。サーバーは最大 5 分で拾う`);
    } catch (e) {
      setNote(e instanceof ShopDataError ? `保存できない: ${e.message}` : `保存できなかった: ${String(e)}`);
    }
  }, [session.agent, overrides]);

  if (!admin) {
    return (
      <div style={{ padding: '1em' }}>
        <p>この画面は管理者だけが使えます。</p>
        <Link to="/admin">管理ダッシュボードへ</Link>
      </div>
    );
  }

  const cur = sel ? overrideOf(sel) : undefined;
  const eff = sel ? effective(sel) : null;
  const tier = sel ? tierForRegion(sel.region) : 1;
  const maxGrade = maxShopGradeForTier(tier);

  return (
    <div className="admin-page" style={{ padding: '0.8em' }}>
      <AuthoredWorldGate loaded={loaded}>
      <div className="admin-head">
        <Link to="/admin" style={{ fontSize: '0.8em' }}>← 管理</Link>
        <strong>お店のラインナップ</strong>
        <span style={{ fontSize: '0.75em', color: 'var(--color-muted)' }}>{overrides.length} 店を上書き中</span>
        <button type="button" onClick={() => void save()} disabled={!session.agent || !dirty || !loaded} style={{ marginLeft: 'auto', fontSize: '0.85em' }}>
          保存
        </button>
      </div>

      {note && <p style={{ fontSize: '0.8em', color: 'var(--color-accent)', margin: '0 0 0.4em' }}>{note}</p>}

      <div className="admin-cols">
        {/* 街の一覧 (tier ごと) */}
        <div style={{ maxHeight: '75vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }}>
          {[1, 2, 3, 4, 5, 6].map((t) => {
            const inTier = towns.filter((x) => tierForRegion(x.region) === t);
            if (inTier.length === 0) return null;
            return (
              <div key={t}>
                <div style={{ fontSize: '0.7em', color: 'var(--color-muted)', margin: '0.4em 0 0.2em' }}>tier{t}</div>
                {inTier.map((town) => (
                  <button
                    key={`${town.x},${town.y}`}
                    type="button"
                    onClick={() => setSel(town)}
                    style={{
                      display: 'flex', gap: '0.4em', width: '100%', padding: '0.2em 0.4em',
                      fontSize: '0.85em', textAlign: 'left',
                      border: sel === town ? '2px solid var(--color-accent)' : '1px solid var(--color-border)',
                      background: 'transparent',
                    }}
                  >
                    <span style={{ flex: 1 }}>{town.name}</span>
                    {overrideOf(town) && <span style={{ fontSize: '0.75em', color: 'var(--color-accent)' }}>上書き</span>}
                  </button>
                ))}
              </div>
            );
          })}
        </div>

        {/* 編集 */}
        {sel && eff ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5em' }}>
            <div style={{ display: 'flex', gap: '0.5em', alignItems: 'center' }}>
              <strong>{sel.name}</strong>
              <span style={{ fontSize: '0.75em', color: 'var(--color-muted)' }}>tier{tier} ({sel.x}, {sel.y})</span>
              {cur && (
                <button
                  type="button"
                  className="secondary"
                  onClick={() => { setOverrides((xs) => xs.filter((o) => o.x !== sel.x || o.y !== sel.y)); setDirty(true); }}
                  style={{ marginLeft: 'auto', fontSize: '0.8em' }}
                >
                  生成に戻す
                </button>
              )}
            </div>

            {/* 装備: チェックで選ぶ。未チェック状態 = 生成のまま */}
            <div style={{ fontSize: '0.8em' }}>
              <div style={{ color: 'var(--color-muted)', marginBottom: '0.2em' }}>
                そうび {cur?.equipment ? '(この店だけの品揃え)' : '(生成のまま — 変えると上書きになる)'}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '0.1em', maxHeight: '38vh', overflowY: 'auto', border: '1px solid var(--color-border)', padding: '0.3em' }}>
                {equipment.map((e) => {
                  const listed = (cur?.equipment ?? eff.equipment).includes(e.id);
                  const overGrade = e.grade > maxGrade;
                  return (
                    <label key={e.id} style={{ display: 'flex', gap: '0.3em', alignItems: 'center' }}>
                      <input
                        type="checkbox"
                        checked={listed}
                        onChange={(ev) => {
                          const base = cur?.equipment ?? [...eff.equipment];
                          const next = ev.target.checked ? [...base, e.id] : base.filter((id) => id !== e.id);
                          setField(sel, { equipment: next });
                        }}
                      />
                      <span style={{ opacity: overGrade ? 0.75 : 1 }}>
                        {e.name}
                        <span style={{ fontSize: '0.85em', color: 'var(--color-muted)' }}> g{e.grade}{e.jobOnly ? ` ${e.jobOnly}` : ''}</span>
                        {/* **帯より上の品を並べるのは意図的な例外としてはできる**が、#565 の
                            地域段階化を破ることを明示する (静かに破らせない)。 */}
                        {overGrade && listed && <span style={{ color: 'var(--color-danger)', fontSize: '0.85em' }}> ⚠ tier{tier} の帯超え</span>}
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>

            {/* 値札の素材 */}
            <label style={{ display: 'flex', gap: '0.4em', alignItems: 'center', fontSize: '0.8em' }}>
              <span style={{ color: 'var(--color-muted)' }}>値札の素材</span>
              <select
                value={cur?.materialId ?? ''}
                onChange={(e) => setField(sel, { materialId: e.target.value || undefined })}
              >
                <option value="">生成のまま ({items.find((i) => i.id === eff.materialId)?.name ?? eff.materialId})</option>
                {items.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
              </select>
            </label>

            {/* 店主 (#385)。空欄 = 街ごとの既定 (placeholder に表示)。 */}
            <div style={{ fontSize: '0.8em', display: 'flex', flexDirection: 'column', gap: '0.25em' }}>
              <div style={{ color: 'var(--color-muted)' }}>店主</div>
              {([
                ['name', '名前 (空欄 = 出さない)'],
                ['greeting', '入店のあいさつ'],
                ['craft', '作ったとき'],
                ['sell', 'ひきとったとき'],
                ['forge', 'きたえたとき'],
              ] as const).map(([k, label]) => {
                const defaults = shopKeeperFor(sel.x, sel.y);
                return (
                  <label key={k} style={{ display: 'flex', gap: '0.4em', alignItems: 'center' }}>
                    <span style={{ width: '10em', color: 'var(--color-muted)' }}>{label}</span>
                    <input
                      maxLength={MAX_KEEPER_LINE}
                      value={cur?.keeper?.[k] ?? ''}
                      placeholder={k === 'name' ? '' : defaults[k]}
                      onChange={(e) => {
                        const keeper = { ...cur?.keeper };
                        if (e.target.value === '') delete keeper[k];
                        else keeper[k] = e.target.value;
                        setField(sel, { keeper: Object.keys(keeper).length ? keeper : undefined });
                      }}
                      style={{ flex: 1 }}
                    />
                  </label>
                );
              })}
            </div>

            {/* プレビュー: プレイヤーが見る最終形 */}
            <div style={{ fontSize: '0.75em', color: 'var(--color-muted)', lineHeight: 1.7 }}>
              いまの品揃え: {(cur?.equipment ?? eff.equipment).map((id) => equipment.find((e) => e.id === id)?.name ?? `? ${id}`).join(' / ')}
            </div>
          </div>
        ) : (
          <div style={{ fontSize: '0.85em', color: 'var(--color-muted)' }}>
            左の一覧から店を選ぶ。上書きした店だけ明示のラインナップになり、他は従来どおり生成される。
          </div>
        )}
      </div>
      </AuthoredWorldGate>
    </div>
  );
}
