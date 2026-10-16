import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, LogOut, UserCircle } from 'lucide-react';
import { useDemo } from '../../context/DemoContext';
import { roleLabels } from '../../lib/permissions';

function initials(name: string) {
  return name
    .split(' ')
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

export function ProfileMenu() {
  const { currentUser, role } = useDemo();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={() => setOpen((v) => !v)} aria-haspopup="menu" aria-expanded={open} className="flex items-center gap-2 rounded-lg p-1 pr-2 hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-600">
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-teal-700 text-xs font-semibold text-white" aria-hidden>
          {initials(currentUser.name)}
        </span>
        <span className="hidden text-left sm:block">
          <span className="block text-sm font-medium leading-tight text-slate-900">{currentUser.name}</span>
          <span className="block text-xs leading-tight text-slate-500">{roleLabels[role]}</span>
        </span>
        <ChevronDown className="h-4 w-4 text-slate-400" aria-hidden />
        <span className="sr-only">Open profile menu</span>
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-40 mt-2 w-72 rounded-xl border border-slate-200 bg-white p-2 shadow-lg">
          <div className="border-b border-slate-100 px-3 pb-3 pt-2">
            <p className="text-sm font-medium text-slate-900">{currentUser.name}</p>
            <p className="text-xs text-slate-500">{currentUser.email}</p>
            <p className="mt-1 text-xs text-slate-500">
              {currentUser.title} · {roleLabels[role]}
            </p>
          </div>
          <Link to="/settings" role="menuitem" onClick={() => setOpen(false)} className="mt-1 flex items-center gap-2 rounded-md px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 focus-visible:bg-slate-50 focus-visible:outline-none">
            <UserCircle className="h-4 w-4 text-slate-400" aria-hidden /> Profile & settings
          </Link>
          <div role="menuitem" aria-disabled="true" className="flex items-start gap-2 rounded-md px-3 py-2 text-sm text-slate-400">
            <LogOut className="mt-0.5 h-4 w-4" aria-hidden />
            <span>
              Sign out
              <span className="block text-xs">Not available: the demo has no live sign-in.</span>
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
