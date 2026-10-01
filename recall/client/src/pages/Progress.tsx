import { Link } from 'react-router-dom';
import { Activity, AlertTriangle, Award, BookOpen, CheckCircle2, Flame, Layers, Target, Trophy } from 'lucide-react';
import { RATINGS } from '@shared/scheduler';
import { useProgress } from '../api/hooks';
import { useToday } from '../auth/AuthContext';
import { CourseTag, StatusBadge } from '../components/Badges';
import { BarChart } from '../components/BarChart';
import { EmptyState, ErrorState, PageSkeleton } from '../components/States';
import { formatDate, formatShortDate, percent, pluralize, RATING_META } from '../lib/format';

const STAGE_COLORS = { new: 'var(--primary)', learning: '#94a3b8', reviewing: '#22a37a', mastered: 'var(--success)' } as const;
const RATING_COLORS = { forgot: 'var(--danger)', hard: 'var(--warning)', good: 'var(--primary)', easy: 'var(--success)' } as const;

export function ProgressPage() {
  const { data, error, isPending, refetch } = useProgress();
  const today = useToday();

  if (isPending) return <PageSkeleton rows={4} />;
  if (error) return <div className="page"><ErrorState error={error} onRetry={() => void refetch()} /></div>;

  const { totals } = data;
  if (totals.topics === 0) {
    return (
      <div className="page">
        <h1>Progress</h1>
        <div className="card">
          <EmptyState
            icon={<Activity size={26} />}
            title="No progress to show yet"
            actions={
              <Link to="/topics/new" className="btn btn-primary">
                Add a topic
              </Link>
            }
          >
            Add topics and complete reviews — your stats will build up here.
          </EmptyState>
        </div>
      </div>
    );
  }

  const stats = [
    { label: 'Total topics', value: totals.topics, icon: Layers, foot: `${totals.new} new` },
    { label: 'Learning', value: totals.learning, icon: BookOpen, foot: `${totals.reviewing} reviewing` },
    { label: 'Mastered', value: totals.mastered, icon: Award, foot: 'Gap of 30+ days' },
    { label: 'Due today', value: totals.dueToday, icon: CheckCircle2, foot: `${totals.overdue} overdue` },
    { label: 'Review streak', value: `${data.streak} ${data.streak === 1 ? 'day' : 'days'}`, icon: Flame, foot: `Best: ${data.longestStreak}` },
    { label: 'Reviews completed', value: totals.reviews, icon: Activity, foot: 'All time' },
    { label: 'Recall accuracy', value: percent(data.accuracy), icon: Target, foot: 'Reviews not rated "Forgot"' },
    {
      label: 'Strongest course',
      value: data.strongestCourse?.course.code ?? '—',
      icon: Trophy,
      foot: data.strongestCourse ? `${percent(data.strongestCourse.accuracy)} accuracy` : 'Needs 3+ reviews in a course',
    },
  ];

  return (
    <div className="page">
      <div className="page-header">
        <div className="titles">
          <h1>Progress</h1>
          <p className="muted">How your memory is building up, based on every review you've done.</p>
        </div>
      </div>

      <ul className="grid grid-4">
        {stats.map(({ label, value, icon: Icon, foot }) => (
          <li key={label} className="card stat">
            <span className="label">
              <Icon size={15} aria-hidden /> {label}
            </span>
            <span className="value">{value}</span>
            <span className="foot">{foot}</span>
          </li>
        ))}
      </ul>

      <div className="grid grid-2">
        <section className="card stack" aria-labelledby="stages-title">
          <h2 id="stages-title">Where your topics are</h2>
          <div className="stacked" aria-hidden>
            {(['new', 'learning', 'reviewing', 'mastered'] as const).map((s) =>
              totals[s] > 0 ? <span key={s} style={{ width: `${(totals[s] / totals.topics) * 100}%`, background: STAGE_COLORS[s] }} /> : null,
            )}
          </div>
          <div className="legend">
            {(['new', 'learning', 'reviewing', 'mastered'] as const).map((s) => (
              <span key={s}>
                <i style={{ background: STAGE_COLORS[s] }} aria-hidden />
                {s[0].toUpperCase() + s.slice(1)}: {totals[s]}
              </span>
            ))}
          </div>
          <h3 style={{ marginTop: 8 }}>How you rated your reviews</h3>
          {totals.reviews === 0 ? (
            <p className="muted">Complete a review to see this.</p>
          ) : (
            <>
              <div className="stacked" aria-hidden>
                {RATINGS.map((r) =>
                  data.ratingCounts[r] > 0 ? (
                    <span key={r} style={{ width: `${(data.ratingCounts[r] / totals.reviews) * 100}%`, background: RATING_COLORS[r] }} />
                  ) : null,
                )}
              </div>
              <div className="legend">
                {RATINGS.map((r) => (
                  <span key={r}>
                    <i style={{ background: RATING_COLORS[r] }} aria-hidden />
                    {RATING_META[r].label}: {data.ratingCounts[r]}
                  </span>
                ))}
              </div>
            </>
          )}
        </section>

        <section className="card" aria-labelledby="activity-title">
          <div className="card-header">
            <h2 id="activity-title">Last 4 weeks</h2>
            <span className="subtle">{pluralize(data.activity.reduce((s, d) => s + d.count, 0), 'review')}</span>
          </div>
          <BarChart
            showValues={false}
            axis={[formatShortDate(data.activity[0].date), 'Today']}
            caption="Reviews completed per day over the last 28 days"
            bars={data.activity.map((d) => ({
              key: d.date,
              label: '',
              value: d.count,
              title: `${formatDate(d.date, today)}: ${pluralize(d.count, 'review')}`,
            }))}
          />
        </section>
      </div>

      <div className="grid grid-2">
        <section className="card" aria-labelledby="courses-title">
          <h2 id="courses-title" style={{ marginBottom: 12 }}>
            By course
          </h2>
          <ul className="list">
            {data.courses.map((c) => (
              <li key={c.course.id} className="list-item">
                <div className={`main-col c-${c.course.color}`}>
                  <div className="spread">
                    <Link to={`/courses/${c.course.id}`} className="title">
                      {c.course.code}
                    </Link>
                    <span className="subtle">
                      {c.accuracy === null ? 'No reviews yet' : `${percent(c.accuracy)} recalled · ${pluralize(c.reviewCount, 'review')}`}
                    </span>
                  </div>
                  <div className="meter" aria-hidden>
                    <span style={{ width: `${c.topicCount ? (c.masteredCount / c.topicCount) * 100 : 0}%` }} />
                  </div>
                  <span className="subtle">
                    {c.masteredCount} of {pluralize(c.topicCount, 'topic')} mastered
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section className="card" aria-labelledby="attention-title">
          <h2 id="attention-title" className="row" style={{ marginBottom: 12 }}>
            <AlertTriangle size={18} aria-hidden /> Needs attention
          </h2>
          {data.needsAttention.length === 0 ? (
            <p className="muted">Nothing is slipping. Keep reviewing on schedule.</p>
          ) : (
            <ul className="list">
              {data.needsAttention.map((t) => (
                <li key={t.id} className="list-item">
                  <div className="main-col">
                    <Link to={`/topics/${t.id}`} className="title">
                      {t.title}
                    </Link>
                    <div className="meta">
                      <CourseTag course={t.course} />
                      <span>{t.reason}</span>
                    </div>
                  </div>
                  <StatusBadge status={t.status} />
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
