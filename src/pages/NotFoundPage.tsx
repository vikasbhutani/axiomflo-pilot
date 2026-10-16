import { Link } from 'react-router-dom';
import { PageHeader } from '../components/layout/PageHeader';
import { Card } from '../components/ui/Card';
import { EmptyState } from '../components/ui/States';

export function NotFoundPage() {
  return (
    <>
      <PageHeader title="Page not found" />
      <Card>
        <EmptyState
          title="This page doesn’t exist"
          description="That address isn't part of the AxiomFlo demo workspace."
          action={
            <Link to="/" className="btn-secondary">
              Go to Overview
            </Link>
          }
        />
      </Card>
    </>
  );
}
