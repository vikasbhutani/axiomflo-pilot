import type { ReactNode } from 'react';
import { AlertCircle, Inbox, Loader2 } from 'lucide-react';

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded-md bg-slate-200/70 ${className}`} aria-hidden />;
}

export function LoadingState({ label = 'Loading sample data…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-10 text-sm text-slate-500" role="status">
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> {label}
    </div>
  );
}

export function EmptyState({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-10 text-center">
      <Inbox className="h-8 w-8 text-slate-300" aria-hidden />
      <p className="mt-3 text-sm font-medium text-slate-700">{title}</p>
      {description && <p className="mt-1 max-w-sm text-sm text-slate-500">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-10 text-center" role="alert">
      <AlertCircle className="h-8 w-8 text-red-400" aria-hidden />
      <p className="mt-3 text-sm font-medium text-slate-800">Something went wrong loading this view</p>
      <p className="mt-1 max-w-sm text-sm text-slate-500">{message}</p>
      {onRetry && (
        <button type="button" onClick={onRetry} className="btn-secondary mt-4">
          Try again
        </button>
      )}
    </div>
  );
}
