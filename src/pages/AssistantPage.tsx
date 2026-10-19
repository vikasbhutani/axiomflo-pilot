import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Bot, Gauge, Lightbulb, RotateCcw, SendHorizontal, ShieldCheck, Table2, User as UserIcon } from 'lucide-react';
import { PageHeader } from '../components/layout/PageHeader';
import { Card } from '../components/ui/Card';
import { useDemo } from '../context/DemoContext';
import { getAssistantResponse, SUGGESTED_QUESTIONS, type AssistantResponse, type SupportingFilters } from '../services/assistantService';
import { roleLabels } from '../lib/permissions';
import { formatPeriod } from '../lib/format';
import { TableScroll } from '../components/ui/TableScroll';

type ChatMessage = { id: number; from: 'user'; text: string } | { id: number; from: 'assistant'; response: AssistantResponse } | { id: number; from: 'error'; text: string };

const MAX_QUESTION_LENGTH = 300;

function usageHref(f: SupportingFilters) {
  const params = new URLSearchParams({ from: f.from, to: f.to });
  if (f.team) params.set('team', f.team);
  if (f.provider) params.set('provider', f.provider);
  if (f.cost) params.set('cost', f.cost);
  return `/usage?${params.toString()}`;
}

export function AssistantPage() {
  const { userContext, role, period } = useDemo();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [pending, setPending] = useState(false);
  const nextId = useRef(1);
  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Answers are scoped to the role, so a role switch starts a fresh conversation.
  const scopeKey = `${userContext.userId}:${role}`;
  const [lastScope, setLastScope] = useState(scopeKey);
  if (scopeKey !== lastScope) {
    setLastScope(scopeKey);
    setMessages([]);
  }

  useEffect(() => {
    // Scroll only the conversation panel, never the whole page.
    const log = logRef.current;
    if (log) log.scrollTo?.({ top: log.scrollHeight, behavior: 'smooth' });
  }, [messages, pending]);

  const lastSupporting = [...messages].reverse().find((m): m is Extract<ChatMessage, { from: 'assistant' }> => m.from === 'assistant')?.response.supporting?.filters;

  const ask = async (question: string) => {
    const text = question.trim().slice(0, MAX_QUESTION_LENGTH);
    if (!text || pending) return;
    setDraft('');
    setMessages((m) => [...m, { id: nextId.current++, from: 'user', text }]);
    setPending(true);
    try {
      const response = await getAssistantResponse(text, { period, previous: lastSupporting }, userContext);
      setMessages((m) => [...m, { id: nextId.current++, from: 'assistant', response }]);
    } catch {
      setMessages((m) => [...m, { id: nextId.current++, from: 'error', text: 'Something went wrong preparing that answer. Please try again.' }]);
    } finally {
      setPending(false);
      inputRef.current?.focus({ preventScroll: true });
    }
  };

  // A question handed over in the link (e.g. from the FinOps Scorecard) is asked once, then removed from the address.
  const [params, setParams] = useSearchParams();
  const handedOver = params.get('q');
  const askedHandover = useRef<string | null>(null);
  useEffect(() => {
    if (!handedOver || askedHandover.current === handedOver) return;
    askedHandover.current = handedOver;
    setParams((p) => {
      const next = new URLSearchParams(p);
      next.delete('q');
      return next;
    }, { replace: true });
    void ask(handedOver);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handedOver]);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void ask(draft);
  };

  return (
    <>
      <PageHeader
        title="AxiomFlo Cost Assistant"
        breadcrumbs={[{ label: 'Overview', to: '/' }, { label: 'AI Cost Assistant' }]}
        description="Ask about estimated AI spend in plain language. Answers are calculated from the same data as every other page."
        actions={
          messages.length > 0 ? (
            <button type="button" className="btn-secondary" onClick={() => setMessages([])} disabled={pending}>
              <RotateCcw className="h-4 w-4" aria-hidden /> New conversation
            </button>
          ) : undefined
        }
      />

      <div className="mb-4 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" aria-hidden />
        <p>
          <strong className="font-semibold">Demonstration assistant.</strong> Answers are prepared by fixed rules from sample data, not by a live AI model. It is read-only, answers only
          from data the <strong className="font-semibold">{roleLabels[role]}</strong> role can see ({formatPeriod(period)} selected), and its figures are estimates, not bills.
        </p>
      </div>

      <Card className="flex flex-col">
        <div ref={logRef} className="h-[calc(100vh-22rem)] min-h-[380px] space-y-5 overflow-y-auto px-4 py-5 sm:px-6" role="log" aria-live="polite" aria-label="Conversation" aria-busy={pending}>
          {messages.length === 0 && <Welcome onAsk={ask} disabled={pending} />}
          {messages.map((m) =>
            m.from === 'user' ? (
              <UserBubble key={m.id} text={m.text} />
            ) : m.from === 'error' ? (
              <p key={m.id} role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
                {m.text}
              </p>
            ) : (
              <AssistantAnswer key={m.id} response={m.response} onAsk={ask} disabled={pending} />
            ),
          )}
          {pending && (
            <div className="flex items-center gap-3 text-sm text-slate-500">
              <AssistantAvatar />
              <span className="inline-flex items-center gap-1" aria-label="Preparing answer">
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400 [animation-delay:-0.2s]" />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400 [animation-delay:-0.1s]" />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400" />
              </span>
            </div>
          )}
        </div>

        <form onSubmit={onSubmit} className="border-t border-slate-200 px-4 py-4 sm:px-6">
          <label htmlFor="assistant-question" className="sr-only">
            Ask a question about AI costs
          </label>
          <div className="flex items-end gap-2">
            <textarea
              id="assistant-question"
              ref={inputRef}
              rows={1}
              value={draft}
              maxLength={MAX_QUESTION_LENGTH}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void ask(draft);
                }
              }}
              placeholder="Ask about AI spend…"
              className="max-h-32 min-h-[42px] flex-1 resize-none rounded-lg border border-slate-300 px-3 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/20"
            />
            <button type="submit" className="btn-primary h-[42px]" disabled={pending || draft.trim() === ''} aria-label="Send question">
              <SendHorizontal className="h-4 w-4" aria-hidden />
              <span className="hidden sm:inline">Send</span>
            </button>
          </div>
          <p className="mt-2 text-xs text-slate-500">Press Enter to send, Shift + Enter for a new line. Don’t enter prompts, secrets or personal information; this demo doesn’t need them.</p>
        </form>
      </Card>
    </>
  );
}

function Welcome({ onAsk, disabled }: { onAsk: (q: string) => void; disabled: boolean }) {
  return (
    <div className="mx-auto max-w-2xl py-6 text-center">
      <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-teal-50 text-teal-700">
        <Bot className="h-5 w-5" aria-hidden />
      </span>
      <h2 className="mt-3 text-base font-semibold text-slate-900">What would you like to know about AI spend?</h2>
      <p className="mt-1 text-sm text-slate-600">Try a suggested question. Every answer shows its dates, currency and cost status, with a link to the requests behind it.</p>
      <ul className="mt-5 flex flex-wrap justify-center gap-2" aria-label="Suggested questions">
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
    <button
      type="button"
      onClick={() => onAsk(text)}
      disabled={disabled}
      className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-left text-sm text-slate-700 hover:border-teal-300 hover:bg-teal-50 hover:text-teal-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-600 disabled:opacity-50"
    >
      {text}
    </button>
  );
}

function AssistantAvatar() {
  return (
    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-teal-700 text-white" aria-hidden>
      <Bot className="h-4 w-4" />
    </span>
  );
}

function UserBubble({ text }: { text: string }) {
  return (
    <div className="flex justify-end gap-3">
      <p className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-tr-sm bg-navy-900 px-4 py-2.5 text-sm text-white">
        <span className="sr-only">You asked: </span>
        {text}
      </p>
      <span className="hidden h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-200 text-slate-600 sm:flex" aria-hidden>
        <UserIcon className="h-4 w-4" />
      </span>
    </div>
  );
}

function AssistantAnswer({ response, onAsk, disabled }: { response: AssistantResponse; onAsk: (q: string) => void; disabled: boolean }) {
  const r = response;
  return (
    <div className="flex gap-3">
      <AssistantAvatar />
      <div className="min-w-0 flex-1 space-y-3">
        <div className="rounded-2xl rounded-tl-sm border border-slate-200 bg-white px-4 py-3 text-sm leading-relaxed text-slate-800">
          <span className="sr-only">Assistant answered: </span>
          {r.answer.map((p, i) => (
            <p key={i} className={i > 0 ? 'mt-2' : undefined}>
              {p}
            </p>
          ))}

          {r.facts.length > 0 && (
            <dl className="mt-3 flex flex-wrap gap-x-4 gap-y-1 border-t border-slate-100 pt-3 text-xs">
              {r.facts.map((f) => (
                <div key={f.label} className="flex gap-1">
                  <dt className="text-slate-500">{f.label}:</dt>
                  <dd className="text-slate-700">{f.value}</dd>
                </div>
              ))}
            </dl>
          )}

          {r.table && (
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

          {r.supporting && (
            <Link to={usageHref(r.supporting.filters)} className="btn-secondary mt-3">
              <Table2 className="h-4 w-4" aria-hidden /> {r.supporting.label}
            </Link>
          )}
          {r.page && (
            <Link to={r.page.to} className="btn-secondary mt-3">
              <Gauge className="h-4 w-4" aria-hidden /> {r.page.label}
            </Link>
          )}
        </div>

        {r.followUps.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
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
