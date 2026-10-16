import { ChevronLeft, ChevronRight } from 'lucide-react';
import { formatNumber } from '../../lib/format';

export function Pagination({ page, pageSize, total, onPageChange }: { page: number; pageSize: number; total: number; onPageChange: (page: number) => void }) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <nav aria-label="Pagination" className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-5 py-3 text-sm text-slate-600">
      <p>
        Showing <span className="font-medium tabular-nums">{formatNumber(from)}</span>–<span className="font-medium tabular-nums">{formatNumber(to)}</span> of{' '}
        <span className="font-medium tabular-nums">{formatNumber(total)}</span>
      </p>
      <div className="flex items-center gap-2">
        <button type="button" className="btn-secondary px-2.5 py-1.5" onClick={() => onPageChange(page - 1)} disabled={page <= 1} aria-label="Previous page">
          <ChevronLeft className="h-4 w-4" aria-hidden />
        </button>
        <span className="tabular-nums">
          Page {page} of {pageCount}
        </span>
        <button type="button" className="btn-secondary px-2.5 py-1.5" onClick={() => onPageChange(page + 1)} disabled={page >= pageCount} aria-label="Next page">
          <ChevronRight className="h-4 w-4" aria-hidden />
        </button>
      </div>
    </nav>
  );
}
