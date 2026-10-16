import { useId, useState } from 'react';
import { Info } from 'lucide-react';

/** Small "i" button that reveals an explanation on hover or keyboard focus. */
export function InfoTooltip({ text, label = 'More information' }: { text: string; label?: string }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-flex align-middle">
      <button
        type="button"
        aria-label={label}
        aria-describedby={open ? id : undefined}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}
        className="rounded-full text-slate-400 hover:text-slate-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-teal-600"
      >
        <Info className="h-3.5 w-3.5" aria-hidden />
      </button>
      {open && (
        <span id={id} role="tooltip" className="absolute left-1/2 top-full z-50 mt-2 w-64 -translate-x-1/2 rounded-md bg-navy-900 px-3 py-2 text-xs font-normal normal-case leading-relaxed tracking-normal text-white shadow-lg">
          {text}
        </span>
      )}
    </span>
  );
}
