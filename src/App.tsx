import { Route, Routes } from 'react-router-dom';
import { AppShell } from './components/layout/AppShell';
import { OverviewPage } from './pages/OverviewPage';
import { UsageExplorerPage } from './pages/UsageExplorerPage';
import { UpcomingPage } from './pages/UpcomingPage';
import { NotFoundPage } from './pages/NotFoundPage';

export function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<OverviewPage />} />
        <Route path="usage" element={<UsageExplorerPage />} />
        <Route
          path="teams"
          element={
            <UpcomingPage
              title="Teams & Users"
              milestone="milestone 3"
              summary="One department, two teams, each with a read-only usage code, members, request counts and estimated spend."
              features={['Edit team names (Company Admin)', 'Invite users in the demo (no real emails)', 'Move members between teams, suspend or reactivate', 'Confirmation dialogs for sensitive changes']}
            />
          }
        />
        <Route
          path="providers"
          element={
            <UpcomingPage
              title="AI Providers"
              milestone="milestone 3"
              summary="Gemini on Vertex AI and Anthropic connection cards with simulated tests. No live provider calls and no stored credentials."
              features={['Masked configuration summaries', 'Simulated connection test with loading, success and failure states', 'Disable-connection confirmation']}
            />
          }
        />
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
        <Route
          path="settings"
          element={
            <UpcomingPage
              title="Settings"
              milestone="milestone 3"
              summary="Company and profile details, read-only AUD reporting currency, Australia/Sydney timezone, demo reset and a simulated audit log."
              features={['Company name and reporting preferences', 'Profile information', 'Reset sample data', 'Audit events for simulated admin actions']}
            />
          }
        />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
