import { useId, type InputHTMLAttributes, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';

const inputClass =
  'w-full rounded-lg border bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500';

function fieldBorder(error?: string) {
  return error ? 'border-red-400 focus:border-red-500 focus:ring-red-500/20' : 'border-slate-300 focus:border-teal-600 focus:ring-teal-600/20';
}

interface FieldShellProps {
  label: string;
  hint?: ReactNode;
  error?: string;
  children: (ids: { id: string; describedBy?: string }) => ReactNode;
}

function FieldShell({ label, hint, error, children }: FieldShellProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ') || undefined;
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-medium text-slate-700">
        {label}
      </label>
      {children({ id, describedBy })}
      {hint && !error && (
        <p id={hintId} className="mt-1 text-xs text-slate-500">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="mt-1 text-xs text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}

export function TextField({ label, hint, error, ...props }: { label: string; hint?: ReactNode; error?: string } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <FieldShell label={label} hint={hint} error={error}>
      {({ id, describedBy }) => <input id={id} aria-describedby={describedBy} aria-invalid={error ? true : undefined} className={`${inputClass} ${fieldBorder(error)}`} {...props} />}
    </FieldShell>
  );
}

export function TextAreaField({ label, hint, error, value, onChange, rows = 3, maxLength }: { label: string; hint?: ReactNode; error?: string; value: string; onChange: (v: string) => void; rows?: number; maxLength?: number }) {
  return (
    <FieldShell label={label} hint={hint} error={error}>
      {({ id, describedBy }) => (
        <textarea id={id} aria-describedby={describedBy} aria-invalid={error ? true : undefined} value={value} onChange={(e) => onChange(e.target.value)} rows={rows} maxLength={maxLength} className={`${inputClass} ${fieldBorder(error)}`} />
      )}
    </FieldShell>
  );
}

export function SelectInput({ label, hint, error, value, onChange, options, disabled }: { label: string; hint?: ReactNode; error?: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; disabled?: boolean }) {
  return (
    <FieldShell label={label} hint={hint} error={error}>
      {({ id, describedBy }) => (
        <div className="relative">
          <select id={id} aria-describedby={describedBy} aria-invalid={error ? true : undefined} value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} className={`${inputClass} ${fieldBorder(error)} appearance-none pr-9`}>
            {options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
        </div>
      )}
    </FieldShell>
  );
}
