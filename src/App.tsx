import { lazy } from 'react';
import { Route, Routes } from 'react-router-dom';
import { AuthStatusRoute } from './auth/guards';
import { AccessDeniedPage, AccessPendingPage } from './pages/auth/AccessPages';
import { ResetPasswordPage, VerifyEmailPage } from './pages/auth/EmailPages';
import { LoginPage, SignupPage } from './pages/auth/LoginPage';
import { AppShell } from './components/layout/AppShell';
import { NotFoundPage } from './pages/NotFoundPage';
import { ByMode } from './pages/real/ByMode';

// Workspace screens load on demand so the sign-in page stays small.
const OverviewPage = lazy(() => import('./pages/OverviewPage').then((m) => ({ default: m.OverviewPage })));
const UsageExplorerPage = lazy(() => import('./pages/UsageExplorerPage').then((m) => ({ default: m.UsageExplorerPage })));
const TeamsPage = lazy(() => import('./pages/TeamsPage').then((m) => ({ default: m.TeamsPage })));
const ProvidersPage = lazy(() => import('./pages/ProvidersPage').then((m) => ({ default: m.ProvidersPage })));
const ShowbackPage = lazy(() => import('./pages/ShowbackPage').then((m) => ({ default: m.ShowbackPage })));
const AssistantPage = lazy(() => import('./pages/AssistantPage').then((m) => ({ default: m.AssistantPage })));
const SettingsPage = lazy(() => import('./pages/SettingsPage').then((m) => ({ default: m.SettingsPage })));
// The real workspace's pages, built on the AxiomFlo API's usage records.
const RealOverviewPage = lazy(() => import('./pages/real/RealOverviewPage').then((m) => ({ default: m.RealOverviewPage })));
const RealUsagePage = lazy(() => import('./pages/real/RealUsagePage').then((m) => ({ default: m.RealUsagePage })));
const RealTeamsPage = lazy(() => import('./pages/real/RealTeamsPage').then((m) => ({ default: m.RealTeamsPage })));
const RealProvidersPage = lazy(() => import('./pages/real/RealProvidersPage').then((m) => ({ default: m.RealProvidersPage })));
const RealShowbackPage = lazy(() => import('./pages/real/RealShowbackPage').then((m) => ({ default: m.RealShowbackPage })));
const RealAssistantPage = lazy(() => import('./pages/real/RealAssistantPage').then((m) => ({ default: m.RealAssistantPage })));
const RealSettingsPage = lazy(() => import('./pages/real/RealSettingsPage').then((m) => ({ default: m.RealSettingsPage })));
const SlackLinkPage = lazy(() => import('./pages/real/SlackLinkPage').then((m) => ({ default: m.SlackLinkPage })));

export function App() {
  return (
    <Routes>
      <Route path="login" element={<AuthStatusRoute allow={['signed_out', 'config_missing']}><LoginPage /></AuthStatusRoute>} />
      <Route path="signup" element={<AuthStatusRoute allow={['signed_out', 'config_missing']}><SignupPage /></AuthStatusRoute>} />
      <Route path="reset-password" element={<AuthStatusRoute allow={['signed_out', 'config_missing']}><ResetPasswordPage /></AuthStatusRoute>} />
      <Route path="verify-email" element={<AuthStatusRoute allow={['verification_required']}><VerifyEmailPage /></AuthStatusRoute>} />
      <Route path="access-pending" element={<AuthStatusRoute allow={['pending', 'error']}><AccessPendingPage /></AuthStatusRoute>} />
      <Route path="access-denied" element={<AuthStatusRoute allow={['denied']}><AccessDeniedPage /></AuthStatusRoute>} />
      {/* Workspace pages. AppShell only renders them for an approved member or an explicit demo session; ByMode picks the demo or the real page. */}
      <Route element={<AppShell />}>
        <Route index element={<ByMode demo={<OverviewPage />} real={<RealOverviewPage />} />} />
        <Route path="usage" element={<ByMode demo={<UsageExplorerPage />} real={<RealUsagePage />} />} />
        <Route path="teams" element={<ByMode demo={<TeamsPage />} real={<RealTeamsPage />} />} />
        <Route path="providers" element={<ByMode demo={<ProvidersPage />} real={<RealProvidersPage />} />} />
        <Route path="showback" element={<ByMode demo={<ShowbackPage />} real={<RealShowbackPage />} />} />
        <Route path="assistant" element={<ByMode demo={<AssistantPage />} real={<RealAssistantPage />} />} />
        <Route path="settings" element={<ByMode demo={<SettingsPage />} real={<RealSettingsPage />} />} />
        <Route path="slack/link" element={<ByMode demo={<NotFoundPage />} real={<SlackLinkPage />} />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
