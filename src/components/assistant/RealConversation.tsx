import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, Bot, Table2 } from 'lucide-react';
import { useApiClient } from '../../auth/apiContext';
import { AssistantError, createAssistantApi, inAppPath, type AssistantAnswer, type AssistantLink } from '../../reports/assistantApi';
import { useRealMember } from '../../reports/useRealReport';
import { AssistantAvatar, ChatComposer, scrollConversationToEnd, SUGGESTION_CHIP_CLASS, ThinkingIndicator, TypedParagraphs, useTypedParagraphs, UserBubble } from './ChatParts';

const MAX_QUESTION_LENGTH = 2000;

const ADMIN_QUESTIONS = ['What did each team spend this month?', 'How can we lower our AI spend?', 'What’s our FinOps score and the biggest savings levers?', 'What does each workflow cost in tokens?', 'Why did spending change compared with last month?'];
const USER_QUESTIONS = ['What did I spend this month?', 'How can I lower my AI spend?', 'What’s my cost per request, and how could I cut it?', 'Which models did I use most this month?'];

type ChatMessage = { id: number; from: 'user'; text: string } | { id: number; from: 'assistant'; answer: AssistantAnswer } | { id: number; from: 'error'; text: string };

export function useAssistantApi() {
  const api = useApiClient();
  return useMemo(() => (api ? createAssistantApi(api) : null), [api]);
}

interface RealConversation {
  messages: ChatMessage[];
  pending: boolean;
  draft: string;
  setDraft: (text: string) => void;
  ask: (question: string) => Promise<void>;
  restart: () => void;
  /** True once the API has said the assistant service isn't deployed. */
  notSetUp: boolean;
  markNotSetUp: () => void;
  isAdmin: boolean;
  inputRef: RefObject<HTMLTextAreaElement>;
}

const RealConversationContext = createContext<RealConversation | null>(null);

/**
 * Holds the real assistant's conversation (and its server session) for the whole workspace, so the
 * full page and the side panel opened from any other page continue the same chat.
 */
export function RealConversationProvider({ children }: { children: ReactNode }) {
  const assistant = useAssistantApi();
  const { isAdmin } = useRealMember();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [pending, setPending] = useState(false);
  const [notSetUp, setNotSetUp] = useState(false);
  const nextId = useRef(1);
  const inputRef = useRef<HTMLTextAreaElement>(null);

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

  const value: RealConversation = { messages, pending, draft, setDraft, ask, restart, notSetUp: notSetUp || !assistant, markNotSetUp: () => setNotSetUp(true), isAdmin, inputRef };
  return <RealConversationContext.Provider value={value}>{children}</RealConversationContext.Provider>;
}

export function useRealConversation() {
  const value = useContext(RealConversationContext);
  if (!value) throw new Error('useRealConversation needs a RealConversationProvider');
  return value;
}

/** The real conversation and its question box. `compact` fits it into the side panel. */
export function RealConversationView({ compact = false }: { compact?: boolean }) {
  const { messages, pending, draft, setDraft, ask, isAdmin, inputRef } = useRealConversation();
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const log = logRef.current;
    if (log) log.scrollTo?.({ top: log.scrollHeight, behavior: 'smooth' });
  }, [messages, pending]);

  return (
    <>
      <div
        ref={logRef}
        className={compact ? 'min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-5' : 'h-[calc(100vh-24rem)] min-h-[380px] space-y-5 overflow-y-auto px-4 py-5 sm:px-6'}
        role="log"
        aria-live="polite"
        aria-label="Conversation"
        aria-busy={pending}
      >
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
      <ChatComposer
        ref={inputRef}
        id={compact ? 'assistant-panel-question' : 'assistant-question'}
        draft={draft}
        onDraft={setDraft}
        onSend={() => void ask(draft)}
        pending={pending}
        maxLength={MAX_QUESTION_LENGTH}
        className={compact ? 'px-4 py-3' : undefined}
        hint={
          compact
            ? 'Enter sends, Shift + Enter adds a line. Your question goes to Gemini on Vertex AI with the figures it needs.'
            : 'Press Enter to send, Shift + Enter for a new line. Your question goes to Gemini on Vertex AI with the figures it needs; prompts and answers from your own AI requests are never included.'
        }
      />
    </>
  );
}

export function LinkButton({ link }: { link: AssistantLink }) {
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
