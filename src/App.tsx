import { Route, Routes } from 'react-router-dom';
import { AppShell } from './components/layout/AppShell';
import { OverviewPage } from './pages/OverviewPage';
import { UsageExplorerPage } from './pages/UsageExplorerPage';
import { TeamsPage } from './pages/TeamsPage';
import { ProvidersPage } from './pages/ProvidersPage';
import { SettingsPage } from './pages/SettingsPage';
import { UpcomingPage } from './pages/UpcomingPage';
import { NotFoundPage } from './pages/NotFoundPage';

export function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<OverviewPage />} />
        <Route path="usage" element={<UsageExplorerPage />} />
        <Route path="teams" element={<TeamsPage />} />
        <Route path="providers" element={<ProvidersPage />} />
        <Route
          path="showback"
          element={
            <UpcomingPage
              title="Monthly Showback"
              milestone="milestone 4"
              summary="A monthly review of allocated AI usage costs. It is not an invoice and does not initiate payment."
              features={['Team and provider allocation', 'Reconciliation status and unresolved requests', 'Role-scoped CSV export built from the same calculations as the Overview']}
            />
          }
        />
        <Route
          path="assistant"
          element={
            <UpcomingPage
              title="AI Cost Assistant"
              milestone="milestone 5"
              summary="A read-only, deterministic demo assistant that answers questions from the same reporting data. It does not call a live LLM."
              features={['Suggested questions with calculated answers', 'Supporting tables and “View supporting requests” links', 'Answers limited to the data your role can see']}
            />
          }
        />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
