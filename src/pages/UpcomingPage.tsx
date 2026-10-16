import { Link } from 'react-router-dom';
import { Construction } from 'lucide-react';
import { PageHeader } from '../components/layout/PageHeader';
import { Card } from '../components/ui/Card';

/**
 * Temporary page for screens scheduled in a later milestone, so navigation
 * never leads to a dead end while the pilot is being built.
 */
export function UpcomingPage({ title, milestone, summary, features }: { title: string; milestone: string; summary: string; features: string[] }) {
  return (
    <>
      <PageHeader title={title} breadcrumbs={[{ label: 'Overview', to: '/' }, { label: title }]} />
      <Card className="p-6 sm:p-8">
        <div className="flex items-start gap-4">
          <span className="rounded-lg bg-teal-50 p-2.5 text-teal-700">
            <Construction className="h-5 w-5" aria-hidden />
          </span>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-teal-700">Planned for {milestone}</p>
            <p className="mt-1 text-sm text-slate-700">{summary}</p>
            <ul className="mt-4 list-disc space-y-1 pl-5 text-sm text-slate-600">
              {features.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
            <Link to="/" className="btn-secondary mt-6">
              Back to Overview
            </Link>
          </div>
        </div>
      </Card>
    </>
  );
}
