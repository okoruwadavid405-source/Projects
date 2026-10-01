import { NavLink, Outlet, Link } from 'react-router-dom';
import { BarChart3, BookOpen, CalendarDays, LogOut, Plus, Settings, Sun } from 'lucide-react';
import { useDashboard } from '../api/hooks';
import { useAuth, useUser } from '../auth/AuthContext';
import { initials } from '../lib/format';
import { useReminders } from '../lib/reminders';
import { BrandMark } from './Brand';

const NAV = [
  { to: '/', label: 'Today', icon: Sun, end: true },
  { to: '/courses', label: 'Courses', icon: BookOpen },
  { to: '/upcoming', label: 'Upcoming', icon: CalendarDays },
  { to: '/progress', label: 'Progress', icon: BarChart3 },
  { to: '/settings', label: 'Settings', icon: Settings },
];

export function Layout() {
  const user = useUser();
  const { logout } = useAuth();
  const dashboard = useDashboard();
  const dueCount = dashboard.data ? dashboard.data.dueTodayCount + dashboard.data.overdueCount : 0;
  useReminders(user);

  return (
    <div className="shell">
      <a href="#main" className="skip-link">
        Skip to content
      </a>

      <aside className="sidebar" aria-label="Main">
        <Link to="/" className="brand">
          <BrandMark /> Recall
        </Link>
        <Link to="/topics/new" className="btn btn-primary btn-block">
          <Plus size={18} aria-hidden /> Add topic
        </Link>
        <nav className="side-nav" aria-label="Primary">
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <NavLink key={to} to={to} end={end}>
              <Icon size={19} aria-hidden />
              {label}
              {to === '/' && dueCount > 0 && (
                <span className="count" aria-label={`${dueCount} due`}>
                  {dueCount}
                </span>
              )}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-footer">
          <div className="user-chip">
            <span className="avatar" aria-hidden>
              {initials(user.name)}
            </span>
            <span className="who">
              <strong>{user.name}</strong>
              <span>{user.email}</span>
            </span>
          </div>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => void logout()}>
            <LogOut size={16} aria-hidden /> Log out
          </button>
        </div>
      </aside>

      <header className="topbar">
        <Link to="/" className="brand">
          <BrandMark /> Recall
        </Link>
        <Link to="/topics/new" className="btn btn-primary btn-sm">
          <Plus size={16} aria-hidden /> Add topic
        </Link>
      </header>

      <main id="main" className="main" tabIndex={-1}>
        <Outlet />
      </main>

      <nav className="bottom-nav" aria-label="Primary">
        {NAV.map(({ to, label, icon: Icon, end }) => (
          <NavLink key={to} to={to} end={end}>
            <Icon size={21} aria-hidden />
            {label}
            {to === '/' && dueCount > 0 && <span className="dot" aria-label={`${dueCount} due`}>{dueCount}</span>}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
