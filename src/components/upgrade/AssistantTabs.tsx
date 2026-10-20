import { useLayoutEffect, useRef, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { Bot, TrendingDown } from 'lucide-react';

type Indicator = { left: number; width: number };

// Each tab is its own page, so the underline's last position is kept here to slide from it on the next page.
let lastIndicator: Indicator | null = null;

/** Switches between the assistant's chat and its Upgrade Analysis view. */
export function AssistantTabs() {
  const navRef = useRef<HTMLElement>(null);
  const [indicator, setIndicator] = useState<Indicator | null>(lastIndicator);
  const { pathname } = useLocation();

  useLayoutEffect(() => {
    const active = navRef.current?.querySelector<HTMLElement>('a[aria-current="page"]');
    if (!active) return;
    const measure = () => {
      const next = { left: active.offsetLeft, width: active.offsetWidth };
      lastIndicator = next;
      setIndicator(next);
    };
    // Re-measure if the tab's width changes (e.g. once the web font loads).
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
    const start = () => {
      measure();
      observer?.observe(active);
    };
    // Paint at the previous tab first, then move, so the underline slides across.
    const frame = typeof requestAnimationFrame === 'function' ? requestAnimationFrame(start) : (start(), 0);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      observer?.disconnect();
    };
  }, [pathname]);

  const tab = ({ isActive }: { isActive: boolean }) =>
    `inline-flex items-center gap-1.5 border-b-2 border-transparent px-3 py-2 text-sm font-medium transition-colors ${isActive ? 'text-teal-900' : 'text-slate-600 hover:text-slate-900'}`;
  return (
    <nav ref={navRef} aria-label="AI Cost Assistant" className="relative mb-4 flex gap-1 border-b border-slate-200">
      <NavLink to="/assistant" end className={tab}>
        <Bot className="h-4 w-4" aria-hidden /> Chat
      </NavLink>
      <NavLink to="/assistant/upgrade" className={tab}>
        <TrendingDown className="h-4 w-4" aria-hidden /> Upgrade Analysis
      </NavLink>
      {indicator && (
        <span
          className="absolute bottom-0 h-0.5 bg-teal-700 transition-[left,width] duration-300 ease-out"
          style={{ left: indicator.left, width: indicator.width }}
          aria-hidden
        />
      )}
    </nav>
  );
}
