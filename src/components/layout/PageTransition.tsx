import { useRef, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';

// The AI Cost Assistant's tabs, in order, so moving between them slides along one axis.
const TAB_ORDER = ['/assistant', '/assistant/upgrade'];

/**
 * Plays a Material transition whenever the page changes: the assistant's tabs slide along a shared
 * horizontal axis (next tab from the right, previous from the left); any other page "fades through",
 * fading in while settling from slightly smaller. Changes to only the query string don't replay it.
 */
export function PageTransition({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const previous = useRef(pathname);
  const animation = useRef('animate-fade-through');

  if (previous.current !== pathname) {
    const from = TAB_ORDER.indexOf(previous.current);
    const to = TAB_ORDER.indexOf(pathname);
    animation.current = from >= 0 && to >= 0 ? (to > from ? 'animate-axis-forward' : 'animate-axis-back') : 'animate-fade-through';
    previous.current = pathname;
  }

  return (
    <div key={pathname} className={animation.current}>
      {children}
    </div>
  );
}
