import { NavLink, Outlet } from 'react-router-dom';

export function AppShell() {
  return (
    <div className="app-shell">
      <header className="header">
        <strong>Aozora Quest</strong> <span style={{ color: 'var(--color-muted)' }}>(WIP)</span>
      </header>
      <main className="content">
        <Outlet />
      </main>
      <nav className="footer-nav">
        <NavLink to="/" end>ホーム</NavLink>
        <NavLink to="/me">自分</NavLink>
        <NavLink to="/spirit">精霊</NavLink>
        <NavLink to="/search">検索</NavLink>
        <NavLink to="/settings">設定</NavLink>
      </nav>
    </div>
  );
}
