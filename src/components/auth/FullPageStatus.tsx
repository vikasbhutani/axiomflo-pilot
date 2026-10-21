import { ConnectingLoader } from '../ui/ConnectingLoader';

/** Shown while sign-in or access is being checked, so no protected content flashes on screen. */
export function FullPageStatus({ label }: { label: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4" role="status" aria-live="polite">
      <div className="flex flex-col items-center gap-4 text-sm text-slate-600">
        <ConnectingLoader className="h-48 w-auto" />
        <p>{label}</p>
      </div>
    </div>
  );
}
