import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarDays, CalendarX2 } from 'lucide-react';
import type { TopicSummary } from '@shared/api';
import { useUpcoming } from '../api/hooks';
import { useToday } from '../auth/AuthContext';
import { CourseTag, StatusBadge } from '../components/Badges';
import { BarChart } from '../components/BarChart';
import { EmptyState, ErrorState, PageSkeleton } from '../components/States';
import { formatDate, formatShortDate, pluralize, relativeDay } from '../lib/format';

const RANGES = [
  { days: 14, label: '2 weeks' },
  { days: 42, label: '6 weeks' },
  { days: 84, label: '12 weeks' },
];

export function UpcomingPage() {
  const [days, setDays] = useState(42);
  const { data, error, isPending, refetch } = useUpcoming(days);
  const today = useToday();

  return (
    <div className="page">
      <div className="page-header">
        <div className="titles">
          <h1>Upcoming reviews</h1>
          <p className="muted">See how your study workload looks over the coming weeks.</p>
        </div>
        <div className="actions" role="group" aria-label="Time range">
          {RANGES.map((r) => (
            <button
              key={r.days}
              type="button"
              className={`btn btn-sm ${days === r.days ? 'btn-primary' : 'btn-secondary'}`}
              aria-pressed={days === r.days}
              onClick={() => setDays(r.days)}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {isPending ? (
        <PageSkeleton rows={2} />
      ) : error ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : (
        <>
          <section className="card" aria-labelledby="workload-title">
            <div className="card-header">
              <h2 id="workload-title">
                <CalendarDays size={18} aria-hidden /> Weekly workload
              </h2>
              <span className="subtle">{pluralize(data.weeks.reduce((s, w) => s + w.count, 0), 'review')} scheduled</span>
            </div>
            <BarChart
              caption="Reviews scheduled per week"
              bars={data.weeks.map((w, i) => ({
                key: w.start,
                label: i === 0 ? 'This wk' : formatShortDate(w.start),
                value: w.count,
                title: `Week of ${formatDate(w.start, today)}: ${pluralize(w.count, 'review')}`,
              }))}
            />
            <p className="subtle" style={{ marginTop: 10 }}>
              Each topic appears once, on its next review. Later dates are set after you rate each review.
            </p>
          </section>

          <section className="card" aria-labelledby="timeline-title">
            <h2 id="timeline-title" className="visually-hidden">
              Timeline
            </h2>
            {data.overdue.length === 0 && data.days.length === 0 ? (
              <EmptyState
                icon={<CalendarX2 size={26} />}
                title="Nothing scheduled"
                actions={
                  <Link to="/topics/new" className="btn btn-primary">
                    Add a topic
                  </Link>
                }
              >
                Add topics and Recall will plan their reviews here.
              </EmptyState>
            ) : (
              <div>
                {data.overdue.length > 0 && (
                  <TimelineDay label="Overdue" sub="Review when you can" topics={data.overdue} />
                )}
                {data.days.map((d) => (
                  <TimelineDay key={d.date} label={relativeDay(d.date, today)} sub={formatDate(d.date, today)} topics={d.topics} />
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function TimelineDay({ label, sub, topics }: { label: string; sub: string; topics: TopicSummary[] }) {
  return (
    <div className="timeline-day">
      <div className="when">
        <strong>{label}</strong>
        <span>
          {sub} · {pluralize(topics.length, 'review')}
        </span>
      </div>
      <ul className="chip-list">
        {topics.map((t) => (
          <li key={t.id}>
            <Link to={`/topics/${t.id}`} className="chip-link">
              <CourseTag course={t.course} />
              {t.title}
              {t.status === 'overdue' && <StatusBadge status="overdue" />}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
