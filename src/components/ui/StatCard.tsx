import type { ReactNode } from 'react';
import { InfoTooltip } from './InfoTooltip';

export function StatCard({ label, value, detail, tooltip, icon, tone = 'default' }: { label: string; value: ReactNode; detail?: ReactNode; tooltip?: string; icon?: ReactNode; tone?: 'default' | 'warning' }) {
  return (
    <div className={`rounded-xl border bg-white p-5 shadow-sm transition duration-200 hover:-translate-y-0.5 hover:shadow-md ${tone === 'warning' ? 'border-amber-200' : 'border-slate-200'}`}>
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-slate-500">
          {label}
          {tooltip && <InfoTooltip text={tooltip} label={`About ${label}`} />}
        </p>
        {icon && <span className="text-slate-400">{icon}</span>}
      </div>
      <p className="mt-2 text-2xl font-semibold tabular-nums tracking-tight text-slate-900">{value}</p>
      {detail && <div className="mt-1 text-xs text-slate-500">{detail}</div>}
    </div>
  );
}
