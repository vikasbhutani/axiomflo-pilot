import { Bot, User as UserIcon } from 'lucide-react';

/** Suggested-question chip style; the chip lifts slightly on hover. */
export const SUGGESTION_CHIP_CLASS =
  'rounded-full border border-slate-200 bg-white px-3 py-1.5 text-left text-sm text-slate-700 transition duration-150 hover:-translate-y-0.5 hover:border-teal-300 hover:bg-teal-50 hover:text-teal-900 hover:shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-600 disabled:translate-y-0 disabled:opacity-50 disabled:shadow-none';

export function AssistantAvatar({ thinking = false }: { thinking?: boolean }) {
  return (
    <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-teal-700 text-white ${thinking ? 'animate-breathe' : ''}`} aria-hidden>
      <Bot className="h-4 w-4" />
    </span>
  );
}

/** Shown while an answer is being prepared: a breathing avatar beside a shimmering bubble. */
export function ThinkingIndicator({ label }: { label: string }) {
  return (
    <div className="flex animate-fade-in items-center gap-3 text-sm text-slate-500">
      <AssistantAvatar thinking />
      <span className="inline-flex animate-shimmer items-center gap-2 rounded-2xl rounded-tl-sm border border-slate-200 bg-[linear-gradient(90deg,#f8fafc_0%,#ccfbf1_50%,#f8fafc_100%)] bg-[length:200%_100%] px-4 py-2.5">
        <span className="inline-flex items-center gap-1" aria-hidden>
          <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-teal-600 [animation-delay:-0.2s]" />
          <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-teal-600 [animation-delay:-0.1s]" />
          <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-teal-600" />
        </span>
        <span className="text-xs text-slate-600">{label}</span>
      </span>
    </div>
  );
}

/** The person's question, sliding in from the right. */
export function UserBubble({ text }: { text: string }) {
  return (
    <div className="flex animate-slide-in-right justify-end gap-3">
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
