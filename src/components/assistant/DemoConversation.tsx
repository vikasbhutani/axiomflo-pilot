import { createContext, useContext, useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { Bot, Gauge, Lightbulb, Table2 } from 'lucide-react';
import { useDemo } from '../../context/DemoContext';
import { getAssistantResponse, SUGGESTED_QUESTIONS, type AssistantResponse, type SupportingFilters } from '../../services/assistantService';
import { TableScroll } from '../ui/TableScroll';
import { askFromChip, AssistantAvatar, ChatComposer, MorphLink, scrollConversationToEnd, SUGGESTION_CHIP_CLASS, ThinkingIndicator, TypedParagraphs, useTypedParagraphs, UserBubble } from './ChatParts';

type ChatMessage = { id: number; from: 'user'; text: string } | { id: number; from: 'assistant'; response: AssistantResponse } | { id: number; from: 'error'; text: string };

const MAX_QUESTION_LENGTH = 300;

function usageHref(f: SupportingFilters) {
  const params = new URLSearchParams({ from: f.from, to: f.to });
  if (f.team) params.set('team', f.team);
  if (f.provider) params.set('provider', f.provider);
  if (f.cost) params.set('cost', f.cost);
  return `/usage?${params.toString()}`;
}

interface DemoConversation {
  messages: ChatMessage[];
  pending: boolean;
  draft: string;
  setDraft: (text: string) => void;
  ask: (question: string) => Promise<void>;
  restart: () => void;
  inputRef: RefObject<HTMLTextAreaElement>;
}

const DemoConversationContext = createContext<DemoConversation | null>(null);

/**
 * Holds the demo assistant's conversation for the whole workspace, so the full page and the
 * side panel opened from any other page show the same chat, and it survives moving between pages.
 */
export function DemoConversationProvider({ children }: { children: ReactNode }) {
  const { userContext, role, period } = useDemo();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [pending, setPending] = useState(false);
  const nextId = useRef(1);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Answers are scoped to the role, so a role switch starts a fresh conversation.
  const scopeKey = `${userContext.userId}:${role}`;
  const [lastScope, setLastScope] = useState(scopeKey);
  if (scopeKey !== lastScope) {
    setLastScope(scopeKey);
    setMessages([]);
  }

  const lastResponse = [...messages].reverse().find((m): m is Extract<ChatMessage, { from: 'assistant' }> => m.from === 'assistant')?.response;
  const lastSupporting = lastResponse?.supporting?.filters;

  const ask = async (question: string) => {
    const text = question.trim().slice(0, MAX_QUESTION_LENGTH);
    if (!text || pending) return;
    setDraft('');
    setMessages((m) => [...m, { id: nextId.current++, from: 'user', text }]);
    setPending(true);
    try {
      const response = await getAssistantResponse(text, { period, previous: lastSupporting, upgrade: lastResponse?.upgrade }, userContext);
      setMessages((m) => [...m, { id: nextId.current++, from: 'assistant', response }]);
    } catch {
      setMessages((m) => [...m, { id: nextId.current++, from: 'error', text: 'Something went wrong preparing that answer. Please try again.' }]);
    } finally {
      setPending(false);
      inputRef.current?.focus({ preventScroll: true });
    }
  };

  const value: DemoConversation = { messages, pending, draft, setDraft, ask, restart: () => setMessages([]), inputRef };
  return <DemoConversationContext.Provider value={value}>{children}</DemoConversationContext.Provider>;
}

export function useDemoConversation() {
  const value = useContext(DemoConversationContext);
  if (!value) throw new Error('useDemoConversation needs a DemoConversationProvider');
  return value;
}

/** The demo conversation and its question box. `compact` fits it into the side panel. */
export function DemoConversationView({ compact = false }: { compact?: boolean }) {
  const { messages, pending, draft, setDraft, ask, inputRef } = useDemoConversation();
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Scroll only the conversation panel, never the whole page.
    const log = logRef.current;
    if (log) log.scrollTo?.({ top: log.scrollHeight, behavior: 'smooth' });
  }, [messages, pending]);

  return (
    <>
      <div
        ref={logRef}
        className={compact ? 'min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-5' : 'h-[calc(100vh-22rem)] min-h-[380px] space-y-5 overflow-y-auto px-4 py-5 sm:px-6'}
        role="log"
        aria-live="polite"
        aria-label="Conversation"
        aria-busy={pending}
      >
        {messages.length === 0 && <Welcome onAsk={ask} disabled={pending} />}
        {messages.map((m) =>
          m.from === 'user' ? (
            <UserBubble key={m.id} text={m.text} />
          ) : m.from === 'error' ? (
            <p key={m.id} role="alert" className="animate-fade-up rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
              {m.text}
            </p>
          ) : (
            <AssistantAnswer key={m.id} response={m.response} onAsk={ask} disabled={pending} />
          ),
        )}
        {pending && <ThinkingIndicator label="Preparing answer…" />}
      </div>
      <ChatComposer
        ref={inputRef}
        id={compact ? 'assistant-panel-question' : 'assistant-question'}
        draft={draft}
        onDraft={setDraft}
        onSend={() => void ask(draft)}
        pending={pending}
        maxLength={MAX_QUESTION_LENGTH}
        className={compact ? 'px-4 py-3' : undefined}
        hint={compact ? 'Enter sends, Shift + Enter adds a line. Don’t enter secrets or personal information.' : 'Press Enter to send, Shift + Enter for a new line. Don’t enter prompts, secrets or personal information; this demo doesn’t need them.'}
      />
    </>
  );
}

function Welcome({ onAsk, disabled }: { onAsk: (q: string) => void; disabled: boolean }) {
  return (
    <div className="mx-auto max-w-2xl animate-fade-up py-6 text-center">
      <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-teal-50 text-teal-700">
        <Bot className="h-5 w-5" aria-hidden />
      </span>
      <h2 className="mt-3 text-base font-semibold text-slate-900">What would you like to know about AI spend?</h2>
      <p className="mt-1 text-sm text-slate-600">Try a suggested question. Every answer shows its dates, currency and cost status, with a link to the requests behind it.</p>
      <ul className="stagger mt-5 flex flex-wrap justify-center gap-2" aria-label="Suggested questions">
        {SUGGESTED_QUESTIONS.map((q) => (
          <li key={q}>
            <SuggestionChip text={q} onAsk={onAsk} disabled={disabled} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function SuggestionChip({ text, onAsk, disabled }: { text: string; onAsk: (q: string) => void; disabled: boolean }) {
  return (
    <button type="button" onClick={(e) => askFromChip(e.currentTarget, () => onAsk(text))} disabled={disabled} className={SUGGESTION_CHIP_CLASS}>
      {text}
    </button>
  );
}

function AssistantAnswer({ response, onAsk, disabled }: { response: AssistantResponse; onAsk: (q: string) => void; disabled: boolean }) {
  const r = response;
  const typed = useTypedParagraphs(r.answer);
  const ref = useRef<HTMLDivElement>(null);
  // The facts, table and links arrive once the text has been typed out, so bring them into view.
  useEffect(() => {
    if (typed.done) scrollConversationToEnd(ref.current);
  }, [typed.done]);
  return (
    <div ref={ref} className="flex animate-slide-in-left gap-3">
      <AssistantAvatar />
      <div className="min-w-0 flex-1 space-y-3">
        <div className="stagger rounded-2xl rounded-tl-sm border border-slate-200 bg-white px-4 py-3 text-sm leading-relaxed text-slate-800">
          <span className="sr-only">Assistant answered: </span>
          <TypedParagraphs paragraphs={r.answer} {...typed} className={(i) => `whitespace-pre-line${i > 0 ? ' mt-2' : ''}`} />

          {typed.done && r.facts.length > 0 && (
            <dl className="mt-3 flex flex-wrap gap-x-4 gap-y-1 border-t border-slate-100 pt-3 text-xs">
              {r.facts.map((f) => (
                <div key={f.label} className="flex gap-1">
                  <dt className="text-slate-500">{f.label}:</dt>
                  <dd className="text-slate-700">{f.value}</dd>
                </div>
              ))}
            </dl>
          )}

          {typed.done && r.table && (
            <TableScroll label={r.table.caption} className="mt-3 rounded-lg border border-slate-200">
              <table className="w-full min-w-[420px] text-xs tabular-nums">
                <caption className="bg-slate-50 px-3 py-2 text-left text-xs font-medium text-slate-600">{r.table.caption}</caption>
                <thead className="whitespace-nowrap bg-slate-50 text-slate-500">
                  <tr>
                    {r.table.columns.map((c) => (
                      <th key={c.key} scope="col" className={`px-3 py-2 font-medium ${c.align === 'right' ? 'text-right' : 'text-left'}`}>
                        {c.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {r.table.rows.map((row, i) => (
                    <tr key={i}>
                      {r.table!.columns.map((c, j) =>
                        j === 0 ? (
                          <th key={c.key} scope="row" className="px-3 py-2 text-left font-medium text-slate-800">
                            {row[c.key]}
                          </th>
                        ) : (
                          <td key={c.key} className={`whitespace-nowrap px-3 py-2 text-slate-700 ${c.align === 'right' ? 'text-right' : ''} ${c.key === 'code' ? 'font-mono' : ''}`}>
                            {row[c.key]}
                          </td>
                        ),
                      )}
                    </tr>
                  ))}
                </tbody>
                {r.table.footer && (
                  <tfoot className="border-t border-slate-200 bg-slate-50 font-semibold text-slate-900">
                    <tr>
                      {r.table.columns.map((c, j) =>
                        j === 0 ? (
                          <th key={c.key} scope="row" className="px-3 py-2 text-left">
                            {r.table!.footer![c.key]}
                          </th>
                        ) : (
                          <td key={c.key} className={`whitespace-nowrap px-3 py-2 ${c.align === 'right' ? 'text-right' : ''}`}>
                            {r.table!.footer![c.key]}
                          </td>
                        ),
                      )}
                    </tr>
                  </tfoot>
                )}
              </table>
            </TableScroll>
          )}

          {typed.done && r.supporting && (
            <MorphLink to={usageHref(r.supporting.filters)} className="btn-secondary mt-3">
              <Table2 className="h-4 w-4" aria-hidden /> {r.supporting.label}
            </MorphLink>
          )}
          {typed.done && r.page && (
            <MorphLink to={r.page.to} className="btn-secondary mt-3">
              <Gauge className="h-4 w-4" aria-hidden /> {r.page.label}
            </MorphLink>
          )}
        </div>

        {typed.done && r.followUps.length > 0 && (
          <div className="flex animate-fade-up flex-wrap items-center gap-2" style={{ animationDelay: '400ms' }}>
            <span className="inline-flex items-center gap-1 text-xs text-slate-500">
              <Lightbulb className="h-3.5 w-3.5" aria-hidden /> Ask next:
            </span>
            {r.followUps.map((q) => (
              <SuggestionChip key={q} text={q} onAsk={onAsk} disabled={disabled} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
