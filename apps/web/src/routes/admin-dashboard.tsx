import { Link } from 'react-router-dom';
import { useSession } from '@/lib/session';
import { isAdminDid } from '@/lib/runtime-config';
import { serverOAuthConfigured } from '@/lib/server-oauth';
import { ServerOAuthAdmin } from '@/components/admin/server-oauth-admin';
import { WorldResetAdmin } from '@/components/admin/world-reset-admin';
import { PowerGrantAdmin } from '@/components/admin/power-grant-admin';
import { JobChangeAdmin } from '@/components/admin/job-change-admin';
import { PdsUsageAdmin } from '@/components/admin/pds-usage-admin';
import { DirectoryAdmin, PromptsAdmin, MaintenanceAdmin, BansAdmin, FlagsAdmin } from '@/components/admin/config-admin';
import { DebugBattleSim } from '@/components/debug-battle-sim';

/**
 * あおぞらワールド 管理ダッシュボードの土台 (issue #417 / エピック #416)。
 *
 * 設定ページから遷移してくる管理者専用のハブ。各コンテンツ CRUD (モンスター/アイテム/
 * マップ/店/クエスト…) の入口を並べる骨組み。中身の CRUD は #418 (データ化) の後に各サブ
 * issue で実装するので、ここではセクションの枠 + 状態 (準備中/既存ツールへのリンク) だけ。
 *
 * **重要**: `isAdminDid` は**表示ゲートであって認可 (セキュリティ境界) ではない**。
 * クライアント公開 env との文字列一致なので詐称できる。**書き込みは必ず edge 側で
 * ADMIN_DIDS を検証する** (この UI ゲートを認可と誤認しない)。
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
  // 並びは着手の優先順。#418 (データ化) が全部の前提。
  { key: 'monsters', title: 'モンスター', desc: 'パラメータ・能力・ドロップ・模擬戦', to: '/admin/monsters', issue: 419 },
  { key: 'map', title: 'マップ', desc: '地形をパーツで編集 (エリア・出現配置は #421 で続き)', to: '/admin/map', issue: 421 },
  { key: 'jobs', title: 'ジョブ', desc: '各種パラメータ設定 + 模擬戦', issue: 544 },
  { key: 'npc', title: 'NPC', desc: '位置・名前・セリフ・絵 (フラグ制御は #425 で続き)', to: '/admin/npcs', issue: 425 },
  { key: 'quest', title: 'クエスト', desc: 'NPC 発注・達成条件 (討伐/収集)・報酬', to: '/admin/quests', issue: 423 },
  { key: 'places', title: '街 / ダンジョン / 城', desc: '内部マップの編集', issue: 424 },
  { key: 'quests', title: 'クエスト', desc: 'ゲーム内クエストの作成・編集', issue: 423 },
  { key: 'scenario', title: 'シナリオ', desc: '進行の筋書き', issue: 545 },
  { key: 'items', title: 'アイテム', desc: 'そうび・どうぐ・素材の編集', to: '/admin/items', issue: 420 },
  { key: 'shops', title: 'お店', desc: '店ごとのラインナップ・値札の素材 (セリフは #422 で続き)', to: '/admin/shops', issue: 422 },
  { key: 'flags', title: 'フラグ', desc: '進行フラグでゲート', issue: 426 },
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
    return <p style={{ fontSize: '0.85em', color: 'var(--color-muted)' }}>読み込み中…</p>;
  }
  // **管理者なら本番でも中身まで開ける**。以前は dev 限定の層を
  // 設けていたが、書き込みを伴うものは全部 edge 側で ADMIN_DIDS を検証するようになったので、
  // 表示ゲートに認可を負わせる必要がなくなった (詳細は下の JSX のコメント)。
  const isAdmin = isAdminDid(session.did);

  if (!isAdmin) {
    return (
      <div>
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
    // 幅と余白は app-shell が持っている。ここで独自の maxWidth/padding を足すと
    // 他のルート (/settings 等) と字下げがずれるので置かない。
    <div>
      <h2>あおぞらワールド 管理</h2>
      <p style={{ fontSize: '0.82em', color: 'var(--color-muted)', margin: '0.2em 0 0' }}>
        ゲーム内容の編集ハブ (エピック #416)。CRUD の中身は データ化 (#418) 後に各セクションへ実装。
      </p>

      <section style={{ marginTop: '2em' }}>
        <h3 style={{ fontSize: '0.95em' }}>コンテンツ (準備中)</h3>
        <div style={grid}>
          {CONTENT_SECTIONS.map((s) => (<Card key={s.key} s={s} />))}
        </div>
      </section>

      {/* 管理ツールはここに**集約 (埋め込み)** する。別画面へ飛ばさない (ハブの意味がなくなる)。
          並びは軽いもの順、重い模擬戦フォームを末尾に。

          **本番でも管理者に出す**。以前は dev 限定にしていたが、
          書き込みを伴うものは**すべて edge 側で ADMIN_DIDS を検証する**ようになったので、
          この UI ゲートに認可を負わせる必要がなくなった:
            - パワー付与 / ジョブ変更 / PDS 残量 → edge が ADMIN_DIDS で検証
            - ワールドリセット → **本人の state しか消せない** (他人は消せない)
            - 模擬戦 → client 内の計算だけ (何も書かない)
          `isAdminDid` は今も**表示ゲートであって認可ではない** (公開 env との文字列一致で詐称可能)。 */}
      {agent && did ? (
        <>
          {serverOAuthConfigured && <ServerOAuthAdmin agent={agent} />}
          <PdsUsageAdmin agent={agent} />
          {/* 主管理者 PDS の設定 (旧 apps/admin。デプロイ設定が無く pnpm dev でしか
              開けなかったので、ここに取り込んだ)。 */}
          <DirectoryAdmin agent={agent} />
          <MaintenanceAdmin />
          <BansAdmin />
          <FlagsAdmin />
          <PromptsAdmin />
          <PowerGrantAdmin agent={agent} did={did} />
          <JobChangeAdmin agent={agent} did={did} />
          <WorldResetAdmin agent={agent} did={did} />
          <DebugBattleSim />
        </>
      ) : (
        <p style={{ fontSize: '0.85em', color: 'var(--color-muted)' }}>セッションを準備中…</p>
      )}
    </div>
  );
}
