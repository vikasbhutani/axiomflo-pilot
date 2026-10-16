import type { ReactNode } from 'react';

/**
 * Horizontal scroll container for wide tables on small screens. It is
 * focusable so keyboard users can scroll it with the arrow keys.
 */
export function TableScroll({ label, className = '', children }: { label: string; className?: string; children: ReactNode }) {
  return (
    <div role="region" aria-label={label} tabIndex={0} className={`overflow-x-auto focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-teal-600 ${className}`}>
      {children}
    </div>
  );
}
