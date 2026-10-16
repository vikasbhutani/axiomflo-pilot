import { useCallback, useState } from 'react';
import { Outlet } from 'react-router-dom';
import { SidebarContent } from './Sidebar';
import { MobileNav } from './MobileNav';
import { TopBar } from './TopBar';

export function AppShell() {
  const [navOpen, setNavOpen] = useState(false);
  const closeNav = useCallback(() => setNavOpen(false), []);
  return (
    <div className="min-h-screen bg-slate-50">
      <a href="#main" className="sr-only z-[70] rounded bg-white px-3 py-2 text-sm focus:not-sr-only focus:fixed focus:left-3 focus:top-3">
        Skip to content
      </a>
      <aside className="fixed inset-y-0 left-0 hidden w-64 lg:block">
        <SidebarContent />
      </aside>
      <MobileNav open={navOpen} onClose={closeNav} />
      <div className="lg:pl-64">
        <TopBar onOpenNav={() => setNavOpen(true)} />
        <main id="main" className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:py-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
