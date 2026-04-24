import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { BellIcon, BrusukonIcon, HomeIcon, PersonIcon, SearchIcon, SettingsIcon } from './icons';
import { useSession } from '@/lib/session';
import { getUnreadNotificationCount } from '@/lib/atproto';

const nav = [
  { to: '/', label: 'ホーム', icon: HomeIcon, end: true, key: 'home' as const },
  { to: '/me', label: '自分', icon: PersonIcon, key: 'me' as const },
  { to: '/notifications', label: '通知', icon: BellIcon, key: 'notifications' as const },
  { to: '/spirit', label: 'ブルスコン', icon: BrusukonIcon, key: 'spirit' as const },
  { to: '/search', label: '検索', icon: SearchIcon, key: 'search' as const },
  { to: '/settings', label: '設定', icon: SettingsIcon, key: 'settings' as const },
];

export function AppShell() {
  const session = useSession();
  const location = useLocation();
  const [unread, setUnread] = useState(0);

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

  return (
    <div className="app-shell">
      <header className="header">
        <strong>あおぞらくえすと</strong>
      </header>
      <main className="content">
        <Outlet />
      </main>
      <nav className="footer-nav">
        {nav.map(({ to, label, icon: Icon, end, key }) => (
          <NavLink
            key={to}
            to={to}
            end={end ?? false}
            aria-label={label}
            title={label}
            className="footer-nav-item"
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
