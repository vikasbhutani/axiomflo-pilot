import type { ReactNode } from 'react';
import { Card } from '../ui/Card';

export interface ProfileFact {
  label: string;
  value: ReactNode;
}

function initials(name: string): string {
  const parts = name.replace(/@.*/, '').split(/[\s._-]+/).filter(Boolean);
  return (parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : (parts[0] ?? '?').slice(0, 2)).toUpperCase();
}

/** A one-row summary of who is signed in, shown at the top of Settings. */
export function ProfileSummary({ name, email, role, badge, facts }: { name: string; email?: string; role: string; badge?: ReactNode; facts: ProfileFact[] }) {
  return (
    <Card className="mb-5">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3 px-5 py-4">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-navy-900 text-sm font-semibold text-teal-300" aria-hidden>
            {initials(name)}
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="truncate text-sm font-semibold text-slate-900">{name}</h2>
              <span className="rounded-full bg-teal-50 px-2 py-0.5 text-xs font-medium text-teal-800 ring-1 ring-inset ring-teal-200">{role}</span>
              {badge}
            </div>
            {email && email !== name && <p className="truncate text-xs text-slate-500">{email}</p>}
          </div>
        </div>
        <dl className="flex min-w-0 flex-wrap gap-x-6 gap-y-2 text-sm sm:ml-auto">
          {facts.map((f) => (
            <div key={f.label} className="min-w-0">
              <dt className="text-xs text-slate-500">{f.label}</dt>
              <dd className="break-words text-slate-800">{f.value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </Card>
  );
}
