import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ChevronDown, LogOut, UserCircle } from 'lucide-react';
import { useDemoSession } from '../../auth/demoSession';
import { useSignOutAndLeave } from '../../auth/useSignOutAndLeave';
import { useWorkspaceSession } from '../../auth/WorkspaceSession';
import { useDemo } from '../../context/DemoContext';
import { useToast } from '../../context/ToastContext';
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
  const demo = useDemo();
  const session = useWorkspaceSession();
  const { exitDemo } = useDemoSession();
  const signOut = useSignOutAndLeave();
  const navigate = useNavigate();
  const notify = useToast();
  const [open, setOpen] = useState(false);

  // In a real workspace the name and role come from Google and the membership service,
  // never from the demo role switcher.
  const isReal = session.mode === 'real';
  const name = isReal ? session.user.displayName || session.user.email || 'Signed-in user' : demo.currentUser.name;
  const email = isReal ? session.user.email : demo.currentUser.email;
  const roleLabel = roleLabels[isReal ? session.membership.role : demo.role];
  const detail = isReal ? `${session.membership.companyName ?? 'Your company'} · ${roleLabel}` : `${demo.currentUser.title} · ${roleLabel}`;

  useEffect(() => {
    if (signOut.failed) notify('We couldn’t sign you out. Check your connection and try again.', 'error');
  }, [signOut.failed, notify]);

  const leave = () => {
    setOpen(false);
    if (isReal) {
      void signOut.run();
    } else {
      exitDemo();
      navigate('/login');
    }
  };
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
          {initials(name)}
        </span>
        <span className="hidden text-left sm:block">
          <span className="block text-sm font-medium leading-tight text-slate-900">{name}</span>
          <span className="block text-xs leading-tight text-slate-500">{roleLabel}</span>
        </span>
        <ChevronDown className="hidden h-4 w-4 text-slate-400 sm:block" aria-hidden />
        <span className="sr-only">Open profile menu</span>
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-40 mt-2 w-72 rounded-xl border border-slate-200 bg-white p-2 shadow-lg">
          <div className="border-b border-slate-100 px-3 pb-3 pt-2">
            <p className="truncate text-sm font-medium text-slate-900">{name}</p>
            {email && <p className="truncate text-xs text-slate-500">{email}</p>}
            <p className="mt-1 text-xs text-slate-500">{detail}</p>
          </div>
          {!isReal && (
            <Link to="/settings" role="menuitem" onClick={() => setOpen(false)} className="mt-1 flex items-center gap-2 rounded-md px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 focus-visible:bg-slate-50 focus-visible:outline-none">
              <UserCircle className="h-4 w-4 text-slate-400" aria-hidden /> Profile & settings
            </Link>
          )}
          <button type="button" role="menuitem" onClick={leave} className="mt-1 flex w-full items-start gap-2 rounded-md px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 focus-visible:bg-slate-50 focus-visible:outline-none">
            <LogOut className="mt-0.5 h-4 w-4 text-slate-400" aria-hidden />
            {isReal ? (
              'Sign out'
            ) : (
              <span>
                Exit demo
                <span className="block text-xs text-slate-500">Back to the sign-in page</span>
              </span>
            )}
          </button>
        </div>
      )}
    </div>
  );
}
