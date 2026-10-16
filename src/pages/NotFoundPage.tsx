import { Link } from 'react-router-dom';
import { Card } from '../components/ui/Card';
import { EmptyState } from '../components/ui/States';

export function NotFoundPage() {
  return (
    <Card>
      <EmptyState
        title="Page not found"
        description="That address isn't part of the AxiomFlo demo workspace."
        action={
          <Link to="/" className="btn-secondary">
            Go to Overview
          </Link>
        }
      />
    </Card>
  );
}
