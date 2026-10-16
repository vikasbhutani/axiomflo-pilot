import { useId } from 'react';
import { ChevronDown } from 'lucide-react';

export interface Option {
  value: string;
  label: string;
}

/** Native select with a visible label: accessible and keyboard-friendly by default. */
export function SelectField({ label, value, onChange, options, hideLabel = false, className = '' }: { label: string; value: string; onChange: (value: string) => void; options: Option[]; hideLabel?: boolean; className?: string }) {
  const id = useId();
  return (
    <div className={className}>
      <label htmlFor={id} className={hideLabel ? 'sr-only' : 'mb-1 block text-xs font-medium text-slate-600'}>
        {label}
      </label>
      <div className="relative">
        <select id={id} value={value} onChange={(e) => onChange(e.target.value)} className="w-full appearance-none rounded-lg border border-slate-300 bg-white py-2 pl-3 pr-9 text-sm text-slate-900 shadow-sm focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/20">
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
      </div>
    </div>
  );
}
