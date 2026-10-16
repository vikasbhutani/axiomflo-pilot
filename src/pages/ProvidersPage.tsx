import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, KeyRound, Loader2, Lock, PlugZap, Power, Settings2, ShieldAlert, XCircle } from 'lucide-react';
import { PageHeader } from '../components/layout/PageHeader';
import { Card } from '../components/ui/Card';
import { ConfirmDialog, Modal } from '../components/ui/Modal';
import { SelectInput, TextAreaField, TextField } from '../components/ui/FormFields';
import { DemoTag } from '../components/ui/StatusBadge';
import { EmptyState, ErrorState, LoadingState } from '../components/ui/States';
import { useDemo } from '../context/DemoContext';
import { useToast } from '../context/ToastContext';
import { useAsync } from '../hooks/useAsync';
import {
  AccessDeniedError,
  GEMINI_REGIONS,
  getProviderConnections,
  saveAnthropicConfig,
  saveGeminiConfig,
  setConnectionEnabled,
  simulateConnectionTest,
  ValidationError,
  type ProviderCard,
  type SimulatedOutcome,
} from '../services/mockService';
import { formatCurrency, formatDateTime, formatNumber, formatPeriod } from '../lib/format';
import type { ProviderConnection } from '../types';

export function ProvidersPage() {
  const { userContext, period, dataVersion } = useDemo();
  const state = useAsync(() => getProviderConnections(period, userContext), [period, userContext.userId, userContext.role, dataVersion]);
  const [configuring, setConfiguring] = useState<ProviderConnection | null>(null);
  const [disabling, setDisabling] = useState<ProviderCard | null>(null);
  const notify = useToast();

  return (
    <>
      <PageHeader
        title="AI Providers"
        breadcrumbs={[{ label: 'Overview', to: '/' }, { label: 'AI Providers' }]}
        description={`Simulated provider connections. Requests and estimated spend are for ${formatPeriod(period)}.`}
      />

      <p className="mb-6 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <span>
          These connections are simulated. No provider is contacted, and no credentials are entered, stored or sent. In production, credentials will be configured and kept on the server side.
        </span>
      </p>

      {state.status === 'error' ? (
        <Card>
          {state.error instanceof AccessDeniedError ? (
            <EmptyState
              title="Provider settings are for Company Admins"
              description="Switch the demo role to Company Admin to preview provider connections."
              action={
                <Link to="/" className="btn-secondary">
                  Back to Overview
                </Link>
              }
            />
          ) : (
            <ErrorState message={state.error.message} onRetry={state.reload} />
          )}
        </Card>
      ) : !state.data ? (
        <Card>
          <LoadingState />
        </Card>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          {state.data.map((card) => (
            <ProviderConnectionCard
              key={card.connection.id}
              card={card}
              onConfigure={() => setConfiguring(card.connection)}
              onDisable={() => setDisabling(card)}
              onEnable={async () => {
                try {
                  await setConnectionEnabled(card.connection.id, true, userContext);
                  notify(`${card.providerName} enabled (simulated).`, 'success');
                } catch (e) {
                  notify(e instanceof Error ? e.message : 'Something went wrong.', 'error');
                }
              }}
            />
          ))}
        </div>
      )}

      {configuring?.providerId === 'gemini_vertex' && <GeminiConfigModal connection={configuring} onClose={() => setConfiguring(null)} />}
      {configuring?.providerId === 'anthropic' && <AnthropicConfigModal connection={configuring} onClose={() => setConfiguring(null)} />}

      <ConfirmDialog
        open={disabling !== null}
        onClose={() => setDisabling(null)}
        tone="danger"
        title="Disable connection?"
        confirmLabel="Disable"
        description={
          disabling && (
            <p>
              <strong className="text-slate-900">{disabling.providerName}</strong> will show as disabled and can’t be tested until it’s enabled again. Existing usage records and reports aren’t affected. This is a simulated change.
            </p>
          )
        }
        onConfirm={async () => {
          if (!disabling) return;
          await setConnectionEnabled(disabling.connection.id, false, userContext);
          notify(`${disabling.providerName} disabled (simulated).`, 'success');
        }}
      />
    </>
  );
}

function ConnectionStatus({ connection }: { connection: ProviderConnection }) {
  if (connection.status === 'disabled')
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600">
        <span className="h-2 w-2 rounded-full bg-slate-400" aria-hidden /> Disabled
      </span>
    );
  if (connection.status === 'not_configured')
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600">
        <span className="h-2 w-2 rounded-full bg-slate-300" aria-hidden /> Not configured
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700">
      <span className="h-2 w-2 rounded-full bg-emerald-500" aria-hidden /> Connected — demo
    </span>
  );
}

function ProviderConnectionCard({ card, onConfigure, onDisable, onEnable }: { card: ProviderCard; onConfigure: () => void; onDisable: () => void; onEnable: () => void }) {
  const { connection, providerName, summary } = card;
  const { userContext } = useDemo();
  const notify = useToast();
  const [outcome, setOutcome] = useState<SimulatedOutcome>('success');
  const [testing, setTesting] = useState(false);
  const disabled = connection.status === 'disabled';

  const runTest = async () => {
    setTesting(true);
    try {
      const result = await simulateConnectionTest(connection.id, outcome, userContext);
      if (result.lastSimulatedTestResult === 'success') notify(`${providerName}: simulated test succeeded. No provider was contacted.`, 'success');
      else notify(`${providerName}: simulated test failed. In production this would show the provider’s error.`, 'error');
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Something went wrong.', 'error');
    } finally {
      setTesting(false);
    }
  };

  return (
    <Card className="flex flex-col">
      <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
        <div className="flex min-w-0 items-start gap-3">
          <span className="rounded-lg bg-slate-100 p-2.5 text-slate-600">
            <PlugZap className="h-5 w-5" aria-hidden />
          </span>
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-slate-900">{providerName}</h2>
            <p className="truncate text-xs text-slate-500">{connection.displayName}</p>
            <div className="mt-1">
              <ConnectionStatus connection={connection} />
            </div>
          </div>
        </div>
        <DemoTag>Simulated</DemoTag>
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-4 px-5 py-4 text-sm">
        <div className="col-span-2">
          <dt className="text-xs text-slate-500">Configuration (masked)</dt>
          <dd className="mt-0.5 break-words text-slate-800">{connection.configSummary || 'Not configured'}</dd>
        </div>
        <div className="col-span-2">
          <dt className="text-xs text-slate-500">Last simulated test</dt>
          <dd className="mt-0.5 flex items-center gap-1.5 text-slate-800">
            {connection.lastSimulatedTestResult === 'success' && <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-hidden />}
            {connection.lastSimulatedTestResult === 'failure' && <XCircle className="h-4 w-4 text-red-600" aria-hidden />}
            {connection.lastSimulatedTestAt ? (
              <>
                {formatDateTime(connection.lastSimulatedTestAt)} · {connection.lastSimulatedTestResult === 'failure' ? 'Failed' : 'Succeeded'}
              </>
            ) : (
              'Never tested'
            )}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500">Requests</dt>
          <dd className="mt-0.5 font-semibold tabular-nums text-slate-900">{formatNumber(summary.requestCount)}</dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500">Estimated spend</dt>
          <dd className="mt-0.5 font-semibold tabular-nums text-slate-900">{formatCurrency(summary.estimatedSpend)}</dd>
        </div>
      </dl>

      <div className="mt-auto space-y-3 border-t border-slate-100 px-5 py-4">
        <div className="flex flex-wrap items-end gap-2">
          <div className="w-44">
            <SelectInput
              label="Outcome to simulate"
              value={outcome}
              onChange={(v) => setOutcome(v as SimulatedOutcome)}
              disabled={disabled || testing}
              options={[
                { value: 'success', label: 'Success' },
                { value: 'failure', label: 'Failure' },
              ]}
            />
          </div>
          <button type="button" className="btn-secondary" onClick={runTest} disabled={disabled || testing} aria-live="polite">
            {testing ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <PlugZap className="h-4 w-4" aria-hidden />}
            {testing ? 'Testing (simulated)…' : 'Simulate connection test'}
          </button>
        </div>
        {disabled && <p className="text-xs text-slate-500">Enable the connection to run a simulated test.</p>}
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-secondary" onClick={onConfigure}>
            <Settings2 className="h-4 w-4" aria-hidden /> Configure
          </button>
          {disabled ? (
            <button type="button" className="btn-secondary" onClick={onEnable}>
              <Power className="h-4 w-4" aria-hidden /> Enable
            </button>
          ) : (
            <button type="button" className="btn-secondary text-red-700" onClick={onDisable}>
              <Power className="h-4 w-4" aria-hidden /> Disable
            </button>
          )}
        </div>
      </div>
    </Card>
  );
}

function GeminiConfigModal({ connection, onClose }: { connection: ProviderConnection; onClose: () => void }) {
  const { userContext } = useDemo();
  const notify = useToast();
  const [projectId, setProjectId] = useState(connection.projectId ?? '');
  const [region, setRegion] = useState(connection.region ?? GEMINI_REGIONS[0]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      await saveGeminiConfig(connection.id, { projectId, region }, userContext);
      notify('Gemini settings saved in the demo workspace. No connection was made.', 'success');
      onClose();
    } catch (e) {
      if (e instanceof ValidationError) setErrors(e.fieldErrors);
      else notify(e instanceof Error ? e.message : 'Something went wrong.', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Configure Gemini on Vertex AI"
      description="Demo configuration. Production authentication is configured server-side with a Google Cloud service identity; AxiomFlo never asks for a Google account password."
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="gemini-form" className="btn-primary" disabled={busy}>
            Save settings
          </button>
        </>
      }
    >
      <form
        id="gemini-form"
        className="space-y-4"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <TextField label="Google Cloud project ID" value={projectId} onChange={(e) => setProjectId(e.target.value)} error={errors.projectId} hint="For example: acme-ai-pilot-demo" autoComplete="off" spellCheck={false} data-autofocus />
        <SelectInput label="Region" value={region} onChange={setRegion} error={errors.region} options={GEMINI_REGIONS.map((r) => ({ value: r, label: r }))} />
        <div>
          <p className="mb-1 text-sm font-medium text-slate-700">Service identity</p>
          <div className="flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-600">
            <Lock className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" aria-hidden />
            <span>
              {connection.identitySummary ?? 'Not configured'}
              <span className="mt-1 block text-xs text-slate-500">Placeholder only. A future backend will use a Google Cloud service account with read-only billing and usage access. No key files are uploaded here.</span>
            </span>
          </div>
        </div>
      </form>
    </Modal>
  );
}

function AnthropicConfigModal({ connection, onClose }: { connection: ProviderConnection; onClose: () => void }) {
  const { userContext } = useDemo();
  const notify = useToast();
  const [displayName, setDisplayName] = useState(connection.displayName);
  const [notes, setNotes] = useState(connection.notes ?? '');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      await saveAnthropicConfig(connection.id, { displayName, notes }, userContext);
      notify('Anthropic settings saved in the demo workspace. No connection was made.', 'success');
      onClose();
    } catch (e) {
      if (e instanceof ValidationError) setErrors(e.fieldErrors);
      else notify(e instanceof Error ? e.message : 'Something went wrong.', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Configure Anthropic"
      description="Demo configuration. No API key is entered or stored in this prototype."
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="anthropic-form" className="btn-primary" disabled={busy}>
            Save settings
          </button>
        </>
      }
    >
      <form
        id="anthropic-form"
        className="space-y-4"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <TextField label="Connection display name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} error={errors.displayName} maxLength={80} autoComplete="off" data-autofocus />
        <div>
          <TextField
            label="API key"
            type="text"
            value={connection.maskedCredential ?? ''}
            disabled
            readOnly
            hint={
              <span className="inline-flex items-start gap-1">
                <KeyRound className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
                Sample masked value, disabled on purpose. A future secure backend will collect and store the key server-side; it will never be saved in the browser.
              </span>
            }
          />
        </div>
        <TextAreaField label="Connection notes (optional)" value={notes} onChange={setNotes} error={errors.notes} maxLength={500} hint="Visible to Company Admins. Don’t put secrets here." />
      </form>
    </Modal>
  );
}
