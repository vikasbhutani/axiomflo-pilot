import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';

export interface Crumb {
  label: string;
  to?: string;
}

export function PageHeader({ title, description, breadcrumbs, actions }: { title: string; description?: ReactNode; breadcrumbs?: Crumb[]; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {breadcrumbs && breadcrumbs.length > 0 && (
          <nav aria-label="Breadcrumb" className="mb-1">
            <ol className="flex flex-wrap items-center gap-1 text-xs text-slate-500">
              {breadcrumbs.map((c, i) => (
                <li key={c.label} className="flex items-center gap-1">
                  {i > 0 && <ChevronRight className="h-3 w-3" aria-hidden />}
                  {c.to ? (
                    <Link to={c.to} className="hover:text-slate-800 hover:underline">
                      {c.label}
                    </Link>
                  ) : (
                    <span aria-current="page">{c.label}</span>
                  )}
                </li>
              ))}
            </ol>
          </nav>
        )}
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{title}</h1>
        {description && <p className="mt-1 text-sm text-slate-500">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-end gap-3">{actions}</div>}
    </div>
  );
}
