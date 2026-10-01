import type { ReactNode } from 'react';
import { AlertTriangle, RotateCw } from 'lucide-react';
import { errorMessage } from '../api/client';

export function EmptyState({ icon, title, children, actions }: { icon: ReactNode; title: string; children?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-icon" aria-hidden>
        {icon}
      </div>
      <h2>{title}</h2>
      {children && <p>{children}</p>}
      {actions && <div className="row">{actions}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <div className="card">
      <div className="empty" role="alert">
        <div className="empty-icon" style={{ background: 'var(--danger-soft)', color: 'var(--danger)' }} aria-hidden>
          <AlertTriangle size={26} />
        </div>
        <h2>We couldn't load this</h2>
        <p>{errorMessage(error)}</p>
        {onRetry && (
          <div className="row">
            <button type="button" className="btn btn-secondary" onClick={onRetry}>
              <RotateCw size={16} aria-hidden /> Try again
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export function PageSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="page" aria-busy="true" aria-label="Loading">
      <div className="skeleton" style={{ height: 34, width: '40%' }} />
      <div className="skeleton" style={{ height: 130 }} />
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="skeleton" style={{ height: 64 }} />
      ))}
      <span className="visually-hidden">Loading…</span>
    </div>
  );
}

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <span className="row" role="status">
      <span className="spinner" aria-hidden />
      <span className="visually-hidden">{label}</span>
    </span>
  );
}
