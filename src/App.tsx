import { lazy } from 'react';
import { Route, Routes } from 'react-router-dom';
import { AuthStatusRoute } from './auth/guards';
import { AccessDeniedPage, AccessPendingPage } from './pages/auth/AccessPages';
import { LoginPage, SignupPage } from './pages/auth/LoginPage';
import { AppShell } from './components/layout/AppShell';
import { NotFoundPage } from './pages/NotFoundPage';

// Workspace screens load on demand so the sign-in page stays small.
const OverviewPage = lazy(() => import('./pages/OverviewPage').then((m) => ({ default: m.OverviewPage })));
const UsageExplorerPage = lazy(() => import('./pages/UsageExplorerPage').then((m) => ({ default: m.UsageExplorerPage })));
const TeamsPage = lazy(() => import('./pages/TeamsPage').then((m) => ({ default: m.TeamsPage })));
const ProvidersPage = lazy(() => import('./pages/ProvidersPage').then((m) => ({ default: m.ProvidersPage })));
const ShowbackPage = lazy(() => import('./pages/ShowbackPage').then((m) => ({ default: m.ShowbackPage })));
const AssistantPage = lazy(() => import('./pages/AssistantPage').then((m) => ({ default: m.AssistantPage })));
const SettingsPage = lazy(() => import('./pages/SettingsPage').then((m) => ({ default: m.SettingsPage })));

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
