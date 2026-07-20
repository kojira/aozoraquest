import { Link } from 'react-router-dom';
import { useSession } from '@/lib/session';
import { isAdminDid } from '@/lib/runtime-config';
import { WORLD_PREVIEW_ENABLED } from '@/lib/world-preview';
import { serverOAuthConfigured } from '@/lib/server-oauth';
import { ServerOAuthAdmin } from '@/components/admin/server-oauth-admin';
import { WorldResetAdmin } from '@/components/admin/world-reset-admin';
import { PowerGrantAdmin } from '@/components/admin/power-grant-admin';
import { DebugBattleSim } from '@/components/debug-battle-sim';

/**
 * あおぞらワールド 管理ダッシュボードの土台 (issue #417 / エピック #416)。
 *
 * 設定ページから遷移してくる管理者専用のハブ。各コンテンツ CRUD (モンスター/アイテム/
 * マップ/店/クエスト…) の入口を並べる骨組み。中身の CRUD は #418 (データ化) の後に各サブ
 * issue で実装するので、ここではセクションの枠 + 状態 (準備中/既存ツールへのリンク) だけ。
 *
 * **重要**: `WORLD_PREVIEW_ENABLED && isAdminDid` は**表示ゲートであって認可 (セキュリティ境界)
 * ではない**。isAdminDid はクライアント公開 env との文字列一致で詐称可能。実データ CRUD を
 * 実装する #418 以降では、**書き込みは必ず edge/サーバー側で権限検証**すること (この UI ゲートを
 * 認可と誤認しない)。露出は dev + 管理者のみ。
 */

interface Section {
  key: string;
  title: string;
  desc: string;
  /** 既存機能への遷移先 (無ければ準備中)。 */
  to?: string;
  /** 準備中セクションの追跡 issue 番号。 */
  issue?: number;
}

const CONTENT_SECTIONS: Section[] = [
  { key: 'monsters', title: 'モンスター', desc: 'ステータス・ドロップ・画像を CRUD', issue: 419 },
  { key: 'items', title: 'アイテム', desc: '装備 / 消費 / 素材を CRUD', issue: 420 },
  { key: 'map', title: 'マップ / タイル', desc: '地形・エリア・出現配置・パーツ編集', issue: 421 },
  { key: 'shops', title: 'お店', desc: 'ラインナップ・合成素材・店主セリフ', issue: 422 },
  { key: 'quests', title: 'クエスト', desc: 'ゲーム内クエストの作成・編集', issue: 423 },
  { key: 'npc', title: 'NPC (将来)', desc: 'NPC の CRUD と配置', issue: 425 },
  { key: 'flags', title: 'フラグ (将来)', desc: '進行フラグでゲート', issue: 426 },
];

function Card({ s }: { s: Section }) {
  const pending = !s.to;
  const body = (
    // 準備中カードは opacity/cursor で非活性を明示 (押しても無反応と分かるように)。
    // marginBottom:0 で dq-window 既定の 0.9em を打ち消し、grid の gap と二重に効かせない。
    <div
      className="dq-window"
      style={{ padding: '0.7em 0.9em', height: '100%', marginBottom: 0, opacity: pending ? 0.6 : 1, cursor: pending ? 'default' : 'pointer' }}
    >
      <div style={{ fontWeight: 700 }}>{s.title}</div>
      <div style={{ fontSize: '0.8em', color: 'var(--color-muted)', marginTop: '0.2em' }}>{s.desc}</div>
      <div style={{ fontSize: '0.75em', marginTop: '0.4em', color: pending ? 'var(--color-muted)' : 'var(--color-accent)' }}>
        {pending ? `準備中${s.issue ? ` (#${s.issue})` : ''}` : '開く →'}
      </div>
    </div>
  );
  return s.to ? (
    <Link to={s.to} style={{ textDecoration: 'none', color: 'inherit' }}>{body}</Link>
  ) : (
    body
  );
}

export function AdminDashboard() {
  const session = useSession();
  // セッション復元中は認可判定より前に「読み込み中」を出す (world/spirit と同様。復元中は
  // did が undefined で isAdmin=false になり、一瞬「管理者専用」がちらつくのを防ぐ)。
  if (session.status === 'loading') {
    return <p style={{ padding: '1em' }}>読み込み中…</p>;
  }
  const isAdmin = WORLD_PREVIEW_ENABLED && isAdminDid(session.did);

  if (!isAdmin) {
    return (
      <div style={{ maxWidth: 560, margin: '0 auto', padding: '1em' }}>
        <h2>管理ダッシュボード</h2>
        <p style={{ fontSize: '0.9em', color: 'var(--color-muted)' }}>この画面は管理者専用です。</p>
        <Link to="/settings"><button>設定へ戻る</button></Link>
      </div>
    );
  }

  const agent = session.agent ?? null;
  const did = session.did ?? null;
  const grid: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '0.6em', marginTop: '0.5em' };

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '1em' }}>
      <h2>あおぞらワールド 管理</h2>
      <p style={{ fontSize: '0.82em', color: 'var(--color-muted)', margin: '0.2em 0 0' }}>
        ゲーム内容の編集ハブ (エピック #416)。CRUD の中身は データ化 (#418) 後に各セクションへ実装。
      </p>

      <h3 style={{ fontSize: '0.95em', marginTop: '1.2em' }}>コンテンツ</h3>
      <div style={grid}>
        {CONTENT_SECTIONS.map((s) => (<Card key={s.key} s={s} />))}
      </div>

      {/* 管理ツールはここに**集約 (埋め込み)** する。別画面へ飛ばさない (ハブの意味がなくなる —
          オーナー指摘 2026-07-20)。CRUD が実装されたら上のカードもここに埋め込みで生えていく。 */}
      <h3 style={{ fontSize: '0.95em', marginTop: '1.4em' }}>ツール</h3>
      {agent && did ? (
        <>
          <PowerGrantAdmin agent={agent} did={did} />
          <WorldResetAdmin agent={agent} did={did} />
          <DebugBattleSim />
          {serverOAuthConfigured && <ServerOAuthAdmin agent={agent} />}
        </>
      ) : (
        <p style={{ fontSize: '0.85em', color: 'var(--color-muted)' }}>ログインが必要です。</p>
      )}
    </div>
  );
}
