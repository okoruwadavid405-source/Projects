import { Link } from 'react-router-dom';
import { Compass } from 'lucide-react';
import { EmptyState } from '../components/States';

export function NotFoundPage({ what = 'page' }: { what?: string }) {
  return (
    <div className="page">
      <div className="card">
        <EmptyState
          icon={<Compass size={26} />}
          title={`We couldn't find that ${what}`}
          actions={
            <Link to="/" className="btn btn-primary">
              Back to Today
            </Link>
          }
        >
          It may have been deleted, or the link is incorrect.
        </EmptyState>
      </div>
    </div>
  );
}
