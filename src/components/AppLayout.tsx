import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Activity, BarChart3, Scan, Layers, Star, Settings, Search, Menu, X } from 'lucide-react';

const navItems = [
  { path: '/', label: 'Dashboard', icon: Layers },
  { path: '/screener', label: 'Screener', icon: Scan },
  { path: '/sectors', label: 'Sektorer', icon: BarChart3 },
  { path: '/watchlist', label: 'Watchlist', icon: Star },
];

export function AppLayout({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [searchValue, setSearchValue] = useState('');

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const q = searchValue.trim().toUpperCase();
    if (q) {
      navigate(`/stock/${q}`);
      setSearchValue('');
    }
  };

  return (
    <div className="min-h-screen bg-background flex">
      {/* Desktop sidebar */}
      <aside
        className={`hidden md:flex flex-col border-r border-border bg-sidebar shrink-0 transition-all duration-200 ${
          sidebarOpen ? 'w-48' : 'w-14'
        }`}
      >
        {/* Logo */}
        <div className="flex items-center gap-2 border-b border-border px-3 py-3">
          <div className="flex h-7 w-7 items-center justify-center rounded bg-primary/10 border border-primary/20 shrink-0">
            <Activity className="h-3.5 w-3.5 text-primary" />
          </div>
          {sidebarOpen && (
            <div className="min-w-0">
              <span className="text-sm font-bold tracking-widest text-foreground font-mono">WSP</span>
              <span className="text-[9px] text-muted-foreground font-mono block tracking-wider">SCREENER</span>
            </div>
          )}
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="ml-auto text-muted-foreground hover:text-foreground p-1"
          >
            {sidebarOpen ? <X className="h-3.5 w-3.5" /> : <Menu className="h-3.5 w-3.5" />}
          </button>
        </div>

        {/* Nav items */}
        <nav className="flex-1 py-2 space-y-0.5 px-2">
          {navItems.map((item) => {
            const active = location.pathname === item.path;
            return (
              <Link
                key={item.path}
                to={item.path}
                className={`flex items-center gap-2.5 rounded-md px-2.5 py-2 text-xs font-medium transition-colors ${
                  active
                    ? 'bg-primary/10 text-primary border border-primary/20'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted border border-transparent'
                }`}
              >
                <item.icon className="h-4 w-4 shrink-0" />
                {sidebarOpen && <span className="font-mono tracking-wider">{item.label.toUpperCase()}</span>}
              </Link>
            );
          })}
        </nav>
      </aside>

      {/* Main area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Global header */}
        <header className="border-b border-border bg-card/80 backdrop-blur-md z-10">
          <div className="flex items-center gap-3 px-4 py-2">
            {/* Mobile menu (logo only on mobile) */}
            <div className="flex md:hidden items-center gap-2">
              <Activity className="h-4 w-4 text-primary" />
              <span className="text-xs font-bold tracking-widest text-foreground font-mono">WSP</span>
            </div>

            {/* Search */}
            <form onSubmit={handleSearch} className="flex-1 max-w-sm mx-auto">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="text"
                  value={searchValue}
                  onChange={(e) => setSearchValue(e.target.value)}
                  placeholder="Sök symbol... (Enter)"
                  className="w-full rounded-md border border-border bg-background py-1.5 pl-8 pr-3 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary font-mono"
                />
              </div>
            </form>

            {/* Spacer for right side */}
            <div className="hidden md:block" />
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto">
          {children}
        </main>
      </div>

      {/* Mobile bottom nav */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 border-t border-border bg-card/95 backdrop-blur-md z-20">
        <div className="flex items-center justify-around py-1.5">
          {navItems.map((item) => {
            const active = location.pathname === item.path;
            return (
              <Link
                key={item.path}
                to={item.path}
                className={`flex flex-col items-center gap-0.5 px-3 py-1 rounded-md transition-colors ${
                  active ? 'text-primary' : 'text-muted-foreground'
                }`}
              >
                <item.icon className="h-4 w-4" />
                <span className="text-[9px] font-mono tracking-wider">{item.label.toUpperCase()}</span>
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
