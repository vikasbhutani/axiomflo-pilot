import { Suspense, useCallback, useState } from 'react';
import { Outlet } from 'react-router-dom';
import { RequireWorkspace } from '../../auth/guards';
import { useWorkspaceSession } from '../../auth/WorkspaceSession';
import { SidebarContent } from './Sidebar';
import { MobileNav } from './MobileNav';
import { TopBar } from './TopBar';
import { LoadingState } from '../ui/States';
import { AssistantLauncher, AssistantProvider } from '../assistant/AssistantPanel';

export function AppShell() {
  return (
    <RequireWorkspace>
      <Shell />
    </RequireWorkspace>
  );
}

function Shell() {
  const [navOpen, setNavOpen] = useState(false);
  const closeNav = useCallback(() => setNavOpen(false), []);
  const session = useWorkspaceSession();
  // The assistant's conversation lives here, above the pages, so it carries on as people move between them.
  return (
    <AssistantProvider key={session.mode === 'real' ? `real-${session.user.uid}` : 'demo'}>
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
          <main id="main" className="mx-auto max-w-7xl px-4 pb-24 pt-6 sm:px-6 lg:pt-8">
            {/* Each route shows its demo page only in demo mode, and its real page only for an approved member. */}
            <Suspense fallback={<LoadingState label="Loading page…" />}>
              <Outlet key={session.mode === 'real' ? `real-${session.user.uid}` : 'demo'} />
            </Suspense>
          </main>
        </div>
        <AssistantLauncher />
      </div>
    </AssistantProvider>
  );
}
