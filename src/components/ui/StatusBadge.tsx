import { AlertTriangle, CheckCircle2, CircleDashed, XCircle } from 'lucide-react';
import type { CostStatus, RequestStatus } from '../../types';

const costStyles: Record<CostStatus, { label: string; className: string; Icon: typeof CheckCircle2 }> = {
  reconciled: { label: 'Reconciled (sample)', className: 'bg-emerald-50 text-emerald-800 ring-emerald-200', Icon: CheckCircle2 },
  estimated: { label: 'Estimated', className: 'bg-sky-50 text-sky-800 ring-sky-200', Icon: CircleDashed },
  unavailable: { label: 'Cost unavailable', className: 'bg-amber-50 text-amber-900 ring-amber-200', Icon: AlertTriangle },
};

export function CostStatusBadge({ status }: { status: CostStatus }) {
  const { label, className, Icon } = costStyles[status];
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${className}`}>
      <Icon className="h-3 w-3" aria-hidden />
      {label}
    </span>
  );
}

export function RequestStatusBadge({ status }: { status: RequestStatus }) {
  return status === 'succeeded' ? (
    <span className="inline-flex items-center gap-1 whitespace-nowrap text-xs text-slate-600">
      <CheckCircle2 className="h-3 w-3 text-emerald-600" aria-hidden /> Succeeded
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 whitespace-nowrap text-xs text-red-700">
      <XCircle className="h-3 w-3" aria-hidden /> Failed
    </span>
  );
}

export function DemoTag({ children = 'Illustrative' }: { children?: string }) {
  return <span className="inline-flex items-center rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-600">{children}</span>;
}
