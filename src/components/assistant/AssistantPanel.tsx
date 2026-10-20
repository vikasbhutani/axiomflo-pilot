import { useCallback, useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Bot, Maximize2, RotateCcw, ShieldCheck, X } from 'lucide-react';
import { useWorkspaceSession } from '../../auth/WorkspaceSession';
import { useDemo } from '../../context/DemoContext';
import { formatPeriod } from '../../lib/format';
import { roleLabels } from '../../lib/permissions';
import { DemoConversationProvider, DemoConversationView, useDemoConversation } from './DemoConversation';
import { RealConversationProvider, RealConversationView, useRealConversation } from './RealConversation';

/** Gives every workspace page the assistant conversation for its mode, so the page and the panel share one chat. */
export function AssistantProvider({ children }: { children: ReactNode }) {
  const session = useWorkspaceSession();
  if (session.mode === 'real') return <RealConversationProvider key={session.user.uid}>{children}</RealConversationProvider>;
  return <DemoConversationProvider>{children}</DemoConversationProvider>;
}

const PANEL_ID = 'assistant-panel';

/**
 * A floating "Ask AI" button on every workspace page that opens the AI Cost Assistant as a side
 * panel over the current page, so a question never means leaving it. Hidden on the assistant's
 * own pages, which already show the full chat.
 */
export function AssistantLauncher() {
  const { pathname } = useLocation();
  const onAssistantPage = pathname === '/assistant' || pathname.startsWith('/assistant/');
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);
  const close = useCallback(() => setOpen(false), []);

  // Going to the full assistant page closes the panel; the conversation carries over.
  useEffect(() => {
    if (onAssistantPage) setOpen(false);
  }, [onAssistantPage]);

  // Closing hands focus back to the button that opened the panel.
  useEffect(() => {
    if (wasOpen.current && !open) buttonRef.current?.focus();
    wasOpen.current = open;
  }, [open]);

  if (onAssistantPage) return null;
  if (open) return <AssistantPanel onClose={close} />;
  return (
    <button
      ref={buttonRef}
      type="button"
      onClick={() => setOpen(true)}
      aria-expanded={false}
      aria-controls={PANEL_ID}
      className="fixed bottom-5 right-5 z-40 inline-flex animate-fade-up items-center gap-2 rounded-full bg-teal-700 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-teal-900/20 transition hover:-translate-y-0.5 hover:bg-teal-800 hover:shadow-xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600"
    >
      <Bot className="h-5 w-5" aria-hidden />
      Ask AI
    </button>
  );
}

function AssistantPanel({ onClose }: { onClose: () => void }) {
  const session = useWorkspaceSession();
  const panelRef = useRef<HTMLElement>(null);

  useEffect(() => {
    panelRef.current?.querySelector<HTMLElement>('textarea')?.focus({ preventScroll: true });
    // Escape closes the panel only while focus is in it, so it never fights a dialog opened on the page.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && panelRef.current?.contains(document.activeElement)) onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  // On a phone the panel covers the page, so following a link from an answer closes it to show where it went.
  const onClickCapture = (e: MouseEvent) => {
    if ((e.target as HTMLElement).closest('a') && window.matchMedia?.('(max-width: 639px)').matches) onClose();
  };

  return (
    <aside
      id={PANEL_ID}
      ref={panelRef}
      aria-label="AI Cost Assistant"
      onClickCapture={onClickCapture}
      className="fixed inset-y-0 right-0 z-40 flex w-full animate-slide-in-right flex-col border-l border-slate-200 bg-white shadow-2xl sm:w-[26rem]"
    >
      {session.mode === 'real' ? <RealPanelBody onClose={onClose} /> : <DemoPanelBody onClose={onClose} />}
    </aside>
  );
}

function PanelHeader({ onClose, onRestart, canRestart }: { onClose: () => void; onRestart: () => void; canRestart: boolean }) {
  const iconButton = 'rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-600 disabled:opacity-40';
  return (
    <div className="flex items-center gap-3 border-b border-slate-200 px-4 py-3">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-teal-700 text-white" aria-hidden>
        <Bot className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <h2 className="text-sm font-semibold text-slate-900">AI Cost Assistant</h2>
        <p className="text-xs text-slate-500">Ask without leaving this page</p>
      </div>
      {canRestart && (
        <button type="button" onClick={onRestart} className={iconButton} aria-label="New conversation" title="New conversation">
          <RotateCcw className="h-4 w-4" aria-hidden />
        </button>
      )}
      <Link to="/assistant" className={iconButton} aria-label="Open the full assistant page" title="Open the full assistant page">
        <Maximize2 className="h-4 w-4" aria-hidden />
      </Link>
      <button type="button" onClick={onClose} className={iconButton} aria-label="Close assistant">
        <X className="h-5 w-5" aria-hidden />
      </button>
    </div>
  );
}

function PanelNote({ children }: { children: ReactNode }) {
  return (
    <p className="flex items-start gap-2 border-b border-slate-100 bg-slate-50 px-4 py-2 text-xs text-slate-600">
      <ShieldCheck className="mt-px h-3.5 w-3.5 shrink-0 text-teal-700" aria-hidden />
      <span>{children}</span>
    </p>
  );
}

function DemoPanelBody({ onClose }: { onClose: () => void }) {
  const { role, period } = useDemo();
  const { messages, pending, restart } = useDemoConversation();
  return (
    <>
      <PanelHeader onClose={onClose} onRestart={restart} canRestart={messages.length > 0 && !pending} />
      <PanelNote>
        Demonstration answers from sample data, as the {roleLabels[role]} role sees it ({formatPeriod(period)}). Figures are estimates, not bills.
      </PanelNote>
      <DemoConversationView compact />
    </>
  );
}

function RealPanelBody({ onClose }: { onClose: () => void }) {
  const { messages, pending, restart, notSetUp, isAdmin } = useRealConversation();
  return (
    <>
      <PanelHeader onClose={onClose} onRestart={restart} canRestart={messages.length > 0 && !pending} />
      {notSetUp ? (
        <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
          <Bot className="h-8 w-8 text-slate-300" aria-hidden />
          <p className="mt-3 text-sm font-semibold text-slate-900">The assistant isn’t set up yet</p>
          <p className="mt-1 text-sm text-slate-600">{isAdmin ? 'It needs the AxiomFlo Agent service running in Google Cloud. The steps are in docs/agent/deploy.md.' : 'Your Company Admin needs to finish setting it up.'}</p>
        </div>
      ) : (
        <>
          <PanelNote>Read-only, from what {isAdmin ? 'a Company Admin' : 'you'} can see. Amounts are estimates from list prices, not bills.</PanelNote>
          <RealConversationView compact />
        </>
      )}
    </>
  );
}
