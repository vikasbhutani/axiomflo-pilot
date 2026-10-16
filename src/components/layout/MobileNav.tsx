import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { SidebarContent } from './Sidebar';

/** Slide-in navigation drawer for small screens. Escape or the backdrop closes it. */
export function MobileNav({ open, onClose }: { open: boolean; onClose: () => void }) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    panelRef.current?.querySelector<HTMLElement>('a, button')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'Tab' && panelRef.current) {
        const focusable = panelRef.current.querySelectorAll<HTMLElement>('a, button');
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
      previous?.focus();
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
      <div className="absolute inset-0 bg-navy-950/60" onClick={onClose} aria-hidden />
      <div ref={panelRef} className="absolute inset-y-0 left-0 w-72 max-w-[85vw] shadow-xl">
        <button type="button" onClick={onClose} className="absolute right-3 top-5 z-10 rounded-md p-1.5 text-navy-200 hover:bg-navy-800 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-300" aria-label="Close navigation">
          <X className="h-5 w-5" aria-hidden />
        </button>
        <SidebarContent onNavigate={onClose} />
      </div>
    </div>
  );
}
