import { Loader2 } from 'lucide-react';

/** Shown while sign-in or access is being checked, so no protected content flashes on screen. */
export function FullPageStatus({ label }: { label: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4" role="status" aria-live="polite">
      <p className="flex items-center gap-2 text-sm text-slate-600">
        <Loader2 className="h-4 w-4 animate-spin text-teal-700" aria-hidden /> {label}
      </p>
    </div>
  );
}
