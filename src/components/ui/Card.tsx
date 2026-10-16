import type { ReactNode } from 'react';

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`min-w-0 rounded-xl border border-slate-200 bg-white shadow-sm ${className}`}>{children}</section>;
}

export function CardHeader({ title, description, action, titleId }: { title: ReactNode; description?: ReactNode; action?: ReactNode; titleId?: string }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
      <div className="min-w-0">
        <h2 id={titleId} className="text-sm font-semibold text-slate-900">{title}</h2>
        {description && <p className="mt-0.5 text-xs text-slate-500">{description}</p>}
      </div>
      {action}
    </div>
  );
}
