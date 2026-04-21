import { NavLink, Outlet } from 'react-router-dom';
import { BrusukonIcon, HomeIcon, PersonIcon, SearchIcon, SettingsIcon } from './icons';

const nav = [
  { to: '/', label: 'ホーム', icon: HomeIcon, end: true },
  { to: '/me', label: '自分', icon: PersonIcon },
  { to: '/spirit', label: 'ブルスコン', icon: BrusukonIcon },
  { to: '/search', label: '検索', icon: SearchIcon },
  { to: '/settings', label: '設定', icon: SettingsIcon },
];

export function AppShell() {
  return (
    <div className="app-shell">
      <header className="header">
        <strong>あおぞらくえすと</strong>
      </header>
      <main className="content">
        <Outlet />
      </main>
      <nav className="footer-nav">
        {nav.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end ?? false}
            aria-label={label}
            title={label}
            className="footer-nav-item"
          >
            <Icon size={26} />
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
