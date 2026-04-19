import { Link, NavLink } from 'react-router-dom';
import { cn } from '@/lib/utils';

export function TopBar() {
  return (
    <header className="sticky top-0 z-40 border-b border-emerald-100/70 bg-white/70 backdrop-blur-xl">
      <div className="container flex h-16 max-w-6xl items-center justify-between">
        <Link to="/matches" className="group flex items-baseline gap-2 font-semibold tracking-tight">
          <span className="font-display text-xl text-emerald-950 transition-colors group-hover:text-emerald-700">
            OverScore
          </span>
          <span className="text-[10px] uppercase tracking-[0.18em] text-emerald-700/70">
            AI · Over / Under
          </span>
        </Link>

        <nav className="flex items-center gap-1 text-sm">
          <NavLink
            to="/matches"
            className={({ isActive }) =>
              cn(
                'rounded-full px-4 py-1.5 transition-colors',
                isActive
                  ? 'bg-emerald-100 text-emerald-900'
                  : 'text-muted-foreground hover:bg-emerald-50 hover:text-emerald-900',
              )
            }
          >
            Matches
          </NavLink>
        </nav>
      </div>
    </header>
  );
}
