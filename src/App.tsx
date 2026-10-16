import { Route, Routes } from 'react-router-dom';
import { AuthStatusRoute } from './auth/guards';
import { AccessDeniedPage, AccessPendingPage } from './pages/auth/AccessPages';
import { LoginPage, SignupPage } from './pages/auth/LoginPage';
import { AppShell } from './components/layout/AppShell';
import { OverviewPage } from './pages/OverviewPage';
import { UsageExplorerPage } from './pages/UsageExplorerPage';
import { TeamsPage } from './pages/TeamsPage';
import { ProvidersPage } from './pages/ProvidersPage';
import { SettingsPage } from './pages/SettingsPage';
import { ShowbackPage } from './pages/ShowbackPage';
import { AssistantPage } from './pages/AssistantPage';
import { NotFoundPage } from './pages/NotFoundPage';

export function App() {
  return (
    <Routes>
      <Route path="login" element={<AuthStatusRoute allow={['signed_out', 'config_missing']}><LoginPage /></AuthStatusRoute>} />
      <Route path="signup" element={<AuthStatusRoute allow={['signed_out', 'config_missing']}><SignupPage /></AuthStatusRoute>} />
      <Route path="access-pending" element={<AuthStatusRoute allow={['pending', 'error']}><AccessPendingPage /></AuthStatusRoute>} />
      <Route path="access-denied" element={<AuthStatusRoute allow={['denied']}><AccessDeniedPage /></AuthStatusRoute>} />
      {/* Workspace pages. AppShell only renders them for an approved member or an explicit demo session. */}
      <Route element={<AppShell />}>
        <Route index element={<OverviewPage />} />
        <Route path="usage" element={<UsageExplorerPage />} />
        <Route path="teams" element={<TeamsPage />} />
        <Route path="providers" element={<ProvidersPage />} />
        <Route path="showback" element={<ShowbackPage />} />
        <Route path="assistant" element={<AssistantPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
