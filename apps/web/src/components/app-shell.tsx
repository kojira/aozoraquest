import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { BellIcon, BrusukonIcon, HomeIcon, PersonIcon, ScrollIcon, SearchIcon, SettingsIcon } from './icons';
import { useSession } from '@/lib/session';
import { getUnreadNotificationCount } from '@/lib/atproto';
import { useVisibleColumn } from '@/lib/visible-column';
import type { AppColumnKind } from '@/lib/app-columns';

/** footer-nav の各タブと workspace カラム kind の対応。
 *  workspace 表示中にタブを押したとき、該当 kind のカラムがあれば
 *  ページ遷移せずそこへ横スクロールする (TweetDeck 的挙動)。 */
const nav: Array<{
  to: string;
  label: string;
  icon: typeof HomeIcon;
  end?: boolean;
  key: string;
  columnKind?: AppColumnKind;
}> = [
  { to: '/', label: 'ホーム', icon: HomeIcon, end: true, key: 'home', columnKind: 'home' },
  { to: '/me', label: '自分', icon: PersonIcon, key: 'me' },
  { to: '/board', label: 'クエスト', icon: ScrollIcon, key: 'quests', columnKind: 'board' },
  { to: '/notifications', label: '通知', icon: BellIcon, key: 'notifications', columnKind: 'notifications' },
  { to: '/spirit', label: 'ブルスコン', icon: BrusukonIcon, key: 'spirit' },
  { to: '/search', label: '検索', icon: SearchIcon, key: 'search', columnKind: 'search' },
  { to: '/settings', label: '設定', icon: SettingsIcon, key: 'settings' },
];

/** 未ログイン時の footer-nav。ホーム/通知/検索などログイン必須の項目は出さず、
 *  閲覧できるクエスト掲示板とログイン導線だけにする。 */
const navLoggedOut: typeof nav = [
  { to: '/board', label: 'クエスト掲示板', icon: ScrollIcon, key: 'quests' },
  { to: '/onboarding', label: 'ログイン', icon: PersonIcon, key: 'login' },
];

export function AppShell() {
  const session = useSession();
  const location = useLocation();
  const [unread, setUnread] = useState(0);
  const visibleKind = useVisibleColumn();
  const headerRef = useRef<HTMLElement>(null);
  const footerRef = useRef<HTMLElement>(null);

  // header + footer-nav の実高 (margin 込み) を CSS 変数
  // --shell-chrome-height に書き出す。workspace のカラム高
  // calc(100dvh - var(--shell-chrome-height)) がマジックナンバーでなく
  // 実測に追従する (文字サイズ設定で chrome の高さが変わっても崩れない)。
  useEffect(() => {
    if (typeof ResizeObserver === 'undefined') return;
    const outerHeight = (el: HTMLElement | null): number => {
      if (!el) return 0;
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      // footer-nav は margin-bottom + sticky bottom offset を持つので
      // margin も含めて占有高を測る
      return r.height + parseFloat(cs.marginTop || '0') + parseFloat(cs.marginBottom || '0');
    };
    const update = () => {
      const total = outerHeight(headerRef.current) + outerHeight(footerRef.current);
      document.documentElement.style.setProperty('--shell-chrome-height', `${Math.ceil(total)}px`);
    };
    update();
    const ro = new ResizeObserver(update);
    if (headerRef.current) ro.observe(headerRef.current);
    if (footerRef.current) ro.observe(footerRef.current);
    return () => ro.disconnect();
  }, []);

  // 60 秒ごとに未読数をポーリング。サインイン状態が変わったら即時取得。
  // 通知タブを開いた瞬間に local で 0 にリセットし、サーバーも追随する。
  useEffect(() => {
    if (session.status !== 'signed-in' || !session.agent) {
      setUnread(0);
      return;
    }
    const agent = session.agent;
    let cancelled = false;
    const tick = () => {
      void getUnreadNotificationCount(agent).then((n) => {
        if (!cancelled) setUnread(n);
      });
    };
    tick();
    const id = setInterval(tick, 60_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [session.status, session.agent]);

  // 通知タブを開いた瞬間にバッジを消す
  useEffect(() => {
    if (location.pathname === '/notifications' && unread > 0) {
      setUnread(0);
    }
  }, [location.pathname, unread]);

  const onWorkspace = location.pathname === '/';
  // workspace 中の active 表示用 kind。IntersectionObserver 発火前
  // (visibleKind=null) は先頭 = home を仮の active にしてチラつきを防ぐ。
  const activeWorkspaceKind: AppColumnKind | null = onWorkspace ? (visibleKind ?? 'home') : null;

  /** workspace 表示中: 該当 kind のカラムが存在すればページ遷移せず
   *  そこへ横スクロールする。カラムが無ければ先頭カラムへ。 */
  function navClick(e: MouseEvent, columnKind?: AppColumnKind) {
    if (!onWorkspace || !columnKind) return;
    e.preventDefault();
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    const behavior: ScrollBehavior = reduce ? 'auto' : 'smooth';
    const el =
      document.querySelector(`[data-column-kind="${columnKind}"]`) ??
      // 該当カラムを削除済みでも「ホーム」等で迷子にならないよう先頭カラムへ
      document.querySelector('.workspace-column');
    el?.scrollIntoView({ behavior, inline: 'start', block: 'nearest' });
  }

  return (
    <div className="app-shell">
      <header className="header" ref={headerRef}>
        <strong>あおぞらくえすと</strong>
      </header>
      <main className="content">
        <Outlet />
      </main>
      <nav className="footer-nav" ref={footerRef}>
        {(session.status === 'signed-in' ? nav : navLoggedOut).map(({ to, label, icon: Icon, end, key, columnKind }) => (
          <NavLink
            key={to}
            to={to}
            end={end ?? false}
            aria-label={label}
            title={label}
            onClick={(e) => navClick(e, columnKind)}
            className={({ isActive }) => {
              // workspace 表示中は「いま見えているカラムの kind」を active に
              // 反映する (モバイル横スワイプで位置が分かる)。
              // columnKind を持たないタブ (自分/ブルスコン/設定) は従来通り
              // isActive で判定する。
              const active = activeWorkspaceKind !== null && columnKind !== undefined
                ? columnKind === activeWorkspaceKind
                : isActive;
              return `footer-nav-item${active ? ' active' : ''}`;
            }}
            style={{ position: 'relative' }}
          >
            <Icon size={26} />
            {key === 'notifications' && unread > 0 && (
              <span
                aria-label={`未読 ${unread} 件`}
                style={{
                  position: 'absolute',
                  top: 4,
                  right: 'calc(50% - 16px)',
                  width: 10,
                  height: 10,
                  borderRadius: 5,
                  background: '#e53935',
                  boxShadow: '0 0 0 2px var(--color-bg, #000)',
                }}
              />
            )}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
