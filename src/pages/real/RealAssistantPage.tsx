import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, Bot, Gauge, Lightbulb, RotateCcw, SendHorizontal, ShieldCheck, Table2 } from 'lucide-react';
import { PageHeader } from '../../components/layout/PageHeader';
import { Card, CardHeader } from '../../components/ui/Card';
import { EmptyState, ErrorState, LoadingState } from '../../components/ui/States';
import { useApiClient } from '../../auth/apiContext';
import { useAsync } from '../../hooks/useAsync';
import { formatPeriod } from '../../lib/format';
import { AssistantError, createAssistantApi, inAppPath, type AssistantAnswer, type AssistantLink, type SuggestionsResult } from '../../reports/assistantApi';
import { useMonthParam, useRealMember } from '../../reports/useRealReport';
import { MonthSelect } from './RealParts';
import { AssistantTabs } from '../../components/upgrade/AssistantTabs';
import { AssistantAvatar, scrollConversationToEnd, SUGGESTION_CHIP_CLASS, ThinkingIndicator, TypedParagraphs, useTypedParagraphs, UserBubble } from '../../components/assistant/ChatParts';

const MAX_QUESTION_LENGTH = 2000;

const ADMIN_QUESTIONS = ['What did each team spend this month?', 'How can we lower our AI spend?', 'What’s our FinOps score and the biggest savings levers?', 'What does each workflow cost in tokens?', 'Why did spending change compared with last month?'];
const USER_QUESTIONS = ['What did I spend this month?', 'How can I lower my AI spend?', 'What’s my cost per request, and how could I cut it?', 'Which models did I use most this month?'];

type ChatMessage = { id: number; from: 'user'; text: string } | { id: number; from: 'assistant'; answer: AssistantAnswer } | { id: number; from: 'error'; text: string };

function useAssistantApi() {
  const api = useApiClient();
  return useMemo(() => (api ? createAssistantApi(api) : null), [api]);
}

/** The AI Cost Assistant on the company's real usage: a chat, plus savings suggestions for a month. */
export function RealAssistantPage() {
  const assistant = useAssistantApi();
  const { isAdmin, user } = useRealMember();
  const [month, setMonth, months] = useMonthParam();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [pending, setPending] = useState(false);
  const [notSetUp, setNotSetUp] = useState(false);
  const nextId = useRef(1);
  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const suggestions = useAsync(async () => {
    if (!assistant) throw new AssistantError('AxiomFlo isn’t connected in this build.', true);
    return assistant.suggestions(month);
  }, [assistant, month, user.uid]);

  useEffect(() => {
    if (suggestions.status === 'error' && suggestions.error instanceof AssistantError && suggestions.error.notSetUp) setNotSetUp(true);
  }, [suggestions]);

  useEffect(() => {
    const log = logRef.current;
    if (log) log.scrollTo?.({ top: log.scrollHeight, behavior: 'smooth' });
  }, [messages, pending]);

  const ask = async (question: string) => {
    const text = question.trim().slice(0, MAX_QUESTION_LENGTH);
    if (!text || pending || !assistant) return;
    setDraft('');
    setMessages((m) => [...m, { id: nextId.current++, from: 'user', text }]);
    setPending(true);
    try {
      const answer = await assistant.ask(text, sessionId);
      if (answer.sessionId) setSessionId(answer.sessionId);
      setMessages((m) => [...m, { id: nextId.current++, from: 'assistant', answer }]);
    } catch (error) {
      if (error instanceof AssistantError && error.notSetUp) setNotSetUp(true);
      const message = error instanceof AssistantError && error.message ? error.message : 'The assistant couldn’t answer just now. Please try again.';
      setMessages((m) => [...m, { id: nextId.current++, from: 'error', text: message }]);
    } finally {
      setPending(false);
      inputRef.current?.focus({ preventScroll: true });
    }
  };

  const restart = () => {
    setMessages([]);
    setSessionId(null);
  };

  if (notSetUp) {
    return (
      <>
        <PageHeader title="AxiomFlo Cost Assistant" breadcrumbs={[{ label: 'Overview', to: '/' }, { label: 'AI Cost Assistant' }]} />
        <AssistantTabs />
        <Card>
          <div className="flex justify-center pt-8 text-slate-300">
            <Bot className="h-8 w-8" aria-hidden />
          </div>
          <EmptyState
            title="The assistant isn’t set up yet"
            description={
              isAdmin
                ? 'It needs the AxiomFlo Agent service running in Google Cloud. The steps are in docs/agent/deploy.md. Meanwhile, the Overview, Teams and Showback pages show the same figures.'
                : 'Your Company Admin needs to finish setting it up. Meanwhile, the Overview page shows the same figures.'
            }
          />
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="AxiomFlo Cost Assistant"
        breadcrumbs={[{ label: 'Overview', to: '/' }, { label: 'AI Cost Assistant' }]}
        description="Ask about your AI spend in plain language. Every figure comes from the same records as the other pages."
        actions={
          messages.length > 0 ? (
            <button type="button" className="btn-secondary" onClick={restart} disabled={pending}>
              <RotateCcw className="h-4 w-4" aria-hidden /> New conversation
            </button>
          ) : undefined
        }
      />
      <AssistantTabs />

      <div className="mb-4 flex animate-fade-in items-start gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-teal-700" aria-hidden />
        <p>
          Read-only. It answers only from what {isAdmin ? 'a Company Admin' : 'you'} can see, for this month and the two before it. Amounts are estimates from provider list prices, not bills. Answers are
          written by Gemini; a check withholds any answer with a figure AxiomFlo didn’t calculate.
        </p>
      </div>

      <div className="grid animate-fade-in gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <Card className="flex flex-col">
          <div ref={logRef} className="h-[calc(100vh-24rem)] min-h-[380px] space-y-5 overflow-y-auto px-4 py-5 sm:px-6" role="log" aria-live="polite" aria-label="Conversation" aria-busy={pending}>
            {messages.length === 0 && <Welcome questions={isAdmin ? ADMIN_QUESTIONS : USER_QUESTIONS} onAsk={ask} disabled={pending} />}
            {messages.map((m) =>
              m.from === 'user' ? (
                <UserBubble key={m.id} text={m.text} />
              ) : m.from === 'error' ? (
                <p key={m.id} role="alert" className="animate-fade-up rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
                  {m.text}
                </p>
              ) : (
                <AnswerBubble key={m.id} answer={m.answer} />
              ),
            )}
            {pending && <ThinkingIndicator label="Looking that up…" />}
          </div>

          <form
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              void ask(draft);
            }}
            className="border-t border-slate-200 px-4 py-4 sm:px-6"
          >
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
            <p className="mt-2 text-xs text-slate-500">Press Enter to send, Shift + Enter for a new line. Your question goes to Gemini on Vertex AI with the figures it needs; prompts and answers from your own AI requests are never included.</p>
          </form>
        </Card>

        <Card>
          <CardHeader title="Savings suggestions" description="Worked out by AxiomFlo’s own rules, not by the AI." />
          <div className="p-4 sm:p-5">
            <MonthSelect month={month} months={months} onChange={setMonth} />
            <Link to={`/scorecard?month=${month}`} className="btn-secondary mt-3 w-full justify-center">
              <Gauge className="h-4 w-4" aria-hidden /> Open the FinOps Scorecard
            </Link>
            <div className="mt-4">
              {suggestions.status === 'loading' && !suggestions.data && <LoadingState label="Looking for savings…" />}
              {suggestions.status === 'error' && <ErrorState message={suggestions.error.message} onRetry={suggestions.reload} />}
              {suggestions.data && suggestions.status !== 'error' && <SuggestionList result={suggestions.data} month={month} />}
            </div>
          </div>
        </Card>
      </div>
    </>
  );
}

function SuggestionList({ result, month }: { result: SuggestionsResult; month: string }) {
  if (result.status === 'error') return <p className="text-sm text-slate-600">{result.error?.message ?? 'Suggestions are unavailable for this month.'}</p>;
  const items = result.suggestions ?? [];
  if (items.length === 0) return <p className="text-sm text-slate-600">{result.message ?? `Nothing stands out for ${formatPeriod(month)}.`}</p>;
  return (
    <ul className="space-y-3" aria-label={`Savings suggestions for ${formatPeriod(month)}`}>
      {items.map((s) => (
        <li key={`${s.kind}:${s.title}`} className="animate-fade-up rounded-lg border border-slate-200 bg-slate-50 px-3 py-3">
          <p className="flex items-start gap-2 text-sm font-semibold text-slate-900">
            <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden />
            {s.title}
          </p>
          <p className="mt-1 text-sm leading-relaxed text-slate-700">{s.detail}</p>
          {s.link && <LinkButton link={s.link} />}
        </li>
      ))}
    </ul>
  );
}

function LinkButton({ link }: { link: AssistantLink }) {
  const path = inAppPath(link.url);
  if (!path) return null;
  return (
    <Link to={path} className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-teal-800 underline">
      <Table2 className="h-4 w-4" aria-hidden /> {link.label}
    </Link>
  );
}

function Welcome({ questions, onAsk, disabled }: { questions: string[]; onAsk: (q: string) => void; disabled: boolean }) {
  return (
    <div className="mx-auto max-w-2xl animate-fade-up py-6 text-center">
      <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-teal-50 text-teal-700">
        <Bot className="h-5 w-5" aria-hidden />
      </span>
      <h2 className="mt-3 text-base font-semibold text-slate-900">What would you like to know about AI spend?</h2>
      <p className="mt-1 text-sm text-slate-600">Answers say which month, currency and cost status they use, with a link to the requests behind them.</p>
      <ul className="stagger mt-5 flex flex-wrap justify-center gap-2" aria-label="Suggested questions">
        {questions.map((q) => (
          <li key={q}>
            <button
              type="button"
              onClick={() => onAsk(q)}
              disabled={disabled}
              className={SUGGESTION_CHIP_CLASS}
            >
              {q}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function AnswerBubble({ answer }: { answer: AssistantAnswer }) {
  const ok = answer.status === 'ok';
  const links = answer.links.filter((l, i, all) => inAppPath(l.url) && all.findIndex((x) => x.url === l.url) === i).slice(0, 3);
  const paragraphs = useMemo(() => [answer.text], [answer.text]);
  const typed = useTypedParagraphs(paragraphs);
  const ref = useRef<HTMLDivElement>(null);
  // The links arrive once the text has been typed out, so bring them into view.
  useEffect(() => {
    if (typed.done) scrollConversationToEnd(ref.current);
  }, [typed.done]);
  return (
    <div ref={ref} className="flex animate-slide-in-left gap-3">
      <AssistantAvatar />
      <div className={`stagger min-w-0 flex-1 rounded-2xl rounded-tl-sm border px-4 py-3 text-sm leading-relaxed ${ok ? 'border-slate-200 bg-white text-slate-800' : 'border-amber-200 bg-amber-50 text-amber-950'}`}>
        <span className="sr-only">Assistant answered: </span>
        {!ok && <AlertTriangle className="mb-1 h-4 w-4 text-amber-700" aria-hidden />}
        <TypedParagraphs paragraphs={paragraphs} {...typed} className={() => 'whitespace-pre-wrap break-words'} />
        {typed.done && links.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-x-4">
            {links.map((l) => (
              <LinkButton key={l.url} link={l} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
