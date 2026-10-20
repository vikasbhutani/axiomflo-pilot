import { useId, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { LucideIcon } from 'lucide-react';

export interface TabItem {
  id: string;
  label: string;
  icon?: LucideIcon;
  content: ReactNode;
}

/**
 * Tabs kept in the URL (`?tab=`), so a link can open a section directly.
 * Every panel stays mounted and only the selected one is shown, so loads and
 * unsaved input in another tab survive switching.
 */
export function UrlTabs({ tabs, label }: { tabs: TabItem[]; label: string }) {
  const [params, setParams] = useSearchParams();
  const baseId = useId();
  const listRef = useRef<HTMLDivElement>(null);
  const selected = tabs.find((t) => t.id === params.get('tab'))?.id ?? tabs[0]?.id;

  const select = (id: string) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set('tab', id);
        return next;
      },
      { replace: true },
    );

  const onKeyDown = (e: KeyboardEvent) => {
    const index = tabs.findIndex((t) => t.id === selected);
    const moves: Record<string, number> = { ArrowRight: index + 1, ArrowLeft: index - 1, Home: 0, End: tabs.length - 1 };
    if (!(e.key in moves)) return;
    e.preventDefault();
    const target = tabs[(moves[e.key] + tabs.length) % tabs.length];
    select(target.id);
    listRef.current?.querySelector<HTMLElement>(`[data-tab="${target.id}"]`)?.focus();
  };

  return (
    <div>
      <div ref={listRef} role="tablist" aria-label={label} onKeyDown={onKeyDown} className="-mx-1 mb-5 flex gap-1 overflow-x-auto border-b border-slate-200 px-1">
        {tabs.map(({ id, label: tabLabel, icon: Icon }) => {
          const active = id === selected;
          return (
            <button
              key={id}
              type="button"
              role="tab"
              data-tab={id}
              id={`${baseId}-tab-${id}`}
              aria-selected={active}
              aria-controls={`${baseId}-panel-${id}`}
              tabIndex={active ? 0 : -1}
              onClick={() => select(id)}
              className={`-mb-px inline-flex items-center gap-2 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-teal-600 ${
                active ? 'border-teal-600 text-navy-900' : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-800'
              }`}
            >
              {Icon && <Icon className={`h-4 w-4 ${active ? 'text-teal-700' : 'text-slate-400'}`} aria-hidden />}
              {tabLabel}
            </button>
          );
        })}
      </div>
      {tabs.map(({ id, content }) => (
        <div key={id} role="tabpanel" id={`${baseId}-panel-${id}`} aria-labelledby={`${baseId}-tab-${id}`} hidden={id !== selected}>
          {content}
        </div>
      ))}
    </div>
  );
}
