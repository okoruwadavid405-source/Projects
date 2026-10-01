import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowRight,
  BookOpen,
  CalendarDays,
  CheckCircle2,
  Flame,
  GraduationCap,
  Lightbulb,
  ListChecks,
  Play,
  Plus,
  Sparkles,
  TrendingUp,
} from 'lucide-react';
import type { Dashboard, Insight, TopicSummary } from '@shared/api';
import { errorMessage } from '../api/client';
import { useDashboard, useLoadDemo, useRemoveDemo } from '../api/hooks';
import { useUser } from '../auth/AuthContext';
import { StatusBadge } from '../components/Badges';
import { BarChart } from '../components/BarChart';
import { CourseFormModal } from '../components/CourseForm';
import { RecommendationHeading, RecommendationList } from '../components/knowledge/Recommendations';
import { useRecommendations } from '../api/knowledge';
import { EmptyState, ErrorState, PageSkeleton } from '../components/States';
import { useToast } from '../components/Toast';
import { dueLabel, formatLongDate, formatWeekday, formatDate, greeting, pluralize } from '../lib/format';

export function TodayPage() {
  const user = useUser();
  const { data, error, isPending, refetch } = useDashboard();

  if (isPending) return <PageSkeleton />;
  if (error) return <div className="page"><ErrorState error={error} onRetry={() => void refetch()} /></div>;

  const firstName = user.name.split(' ')[0];
  return (
    <div className="page">
      <div className="page-header">
        <div className="titles">
          <span className="subtle">{formatLongDate(data.today)}</span>
          <h1>
            {greeting()}, {firstName}
          </h1>
        </div>
      </div>

      {data.hasDemoData && <DemoBanner />}

      {data.courseCount === 0 ? (
        <Onboarding />
      ) : data.topicCount === 0 ? (
        <NoTopics />
      ) : (
        <>
          <Hero data={data} />
          <div className="split">
            <div className="stack-lg">
              <DueList data={data} />
            </div>
            <div className="stack-lg">
              <StudyNext />
              {data.insights.length > 0 && <Insights insights={data.insights} />}
              <WeekAhead data={data} />
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Hero({ data }: { data: Dashboard }) {
  const total = data.dueTodayCount + data.overdueCount;
  if (total === 0) {
    const next = data.nextDays.find((d) => d.count > 0);
    return (
      <section className="hero calm" aria-labelledby="hero-title">
        <div>
          <h1 id="hero-title">Today's reviews</h1>
          <div className="big">You're all caught up</div>
          <p className="sub">
            {data.reviewedTodayCount > 0
              ? `You reviewed ${pluralize(data.reviewedTodayCount, 'topic')} today. Nice work.`
              : 'Nothing is due today.'}{' '}
            {next && `Next up: ${pluralize(next.count, 'review')} on ${formatDate(next.date)}.`}
          </p>
          {data.streak > 0 && (
            <div className="chips">
              <span className="chip">
                <Flame size={15} aria-hidden /> {data.streak}-day streak
              </span>
            </div>
          )}
        </div>
        <Link to="/topics/new" className="btn btn-lg btn-hero">
          <Plus size={18} aria-hidden /> Add what you learned
        </Link>
      </section>
    );
  }
  return (
    <section className="hero" aria-labelledby="hero-title">
      <div>
        <h1 id="hero-title">Today's reviews</h1>
        <div className="big">{pluralize(total, 'review')} due</div>
        <p className="sub">Answer from memory first, then rate how well you remembered.</p>
        <div className="chips">
          {data.overdueCount > 0 && (
            <span className="chip">
              <AlertTriangle size={15} aria-hidden /> {data.overdueCount} overdue
            </span>
          )}
          {data.dueTodayCount > 0 && (
            <span className="chip">
              <ListChecks size={15} aria-hidden /> {data.dueTodayCount} due today
            </span>
          )}
          {data.streak > 0 && (
            <span className="chip">
              <Flame size={15} aria-hidden /> {data.streak}-day streak
            </span>
          )}
        </div>
      </div>
      <Link to="/review" className="btn btn-lg btn-hero">
        <Play size={18} aria-hidden /> Start reviewing
      </Link>
    </section>
  );
}

function DueList({ data }: { data: Dashboard }) {
  if (data.groups.length === 0) {
    return (
      <section className="card" aria-labelledby="due-title">
        <h2 id="due-title" className="visually-hidden">
          Due topics
        </h2>
        <EmptyState icon={<CheckCircle2 size={26} />} title="You're all caught up.">
          Recall will bring topics back here on the day you should review them.
        </EmptyState>
      </section>
    );
  }
  return (
    <section className="card" aria-labelledby="due-title">
      <div className="card-header">
        <h2 id="due-title">What to review today</h2>
        <Link to="/upcoming" className="btn btn-ghost btn-sm">
          Upcoming <ArrowRight size={15} aria-hidden />
        </Link>
      </div>
      {data.groups.map((g) => (
        <div className="course-group" key={g.course.id}>
          <div className={`course-group-header c-${g.course.color}`}>
            <span className="course-swatch" aria-hidden />
            <Link to={`/courses/${g.course.id}`}>{g.course.code}</Link>
            <span className="name">{g.course.name}</span>
            <span className="subtle" style={{ marginLeft: 'auto' }}>
              {g.topics.length}
            </span>
          </div>
          <ul className="list">
            {g.topics.map((t) => (
              <DueRow key={t.id} topic={t} />
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}

function DueRow({ topic }: { topic: TopicSummary }) {
  return (
    <li className="list-item">
      <div className="main-col">
        <Link to={`/topics/${topic.id}`} className="title">
          {topic.title}
        </Link>
        <div className="meta">
          <StatusBadge status={topic.status} />
          {topic.status === 'overdue' && <span>{dueLabel(topic.daysUntilDue)}</span>}
          <span>{topic.questionCount > 0 ? pluralize(topic.questionCount, 'question') : 'Free recall'}</span>
        </div>
      </div>
      <Link to={`/review/${topic.id}`} className="btn btn-secondary btn-sm" aria-label={`Review ${topic.title} now`}>
        Review now
      </Link>
    </li>
  );
}

const INSIGHT_ICON = { info: Lightbulb, positive: TrendingUp, warning: AlertTriangle };

function Insights({ insights }: { insights: Insight[] }) {
  return (
    <section className="card" aria-labelledby="insights-title">
      <div className="card-header">
        <h2 id="insights-title">
          <Sparkles size={18} aria-hidden /> Insights
        </h2>
      </div>
      <ul>
        {insights.map((i) => {
          const Icon = INSIGHT_ICON[i.tone];
          return (
            <li key={i.id} className={`insight ${i.tone}`}>
              <span className="ic" aria-hidden>
                <Icon size={16} />
              </span>
              <span>
                {i.text}{' '}
                {i.topicId && (
                  <Link to={`/topics/${i.topicId}`} className="nowrap">
                    Open topic
                  </Link>
                )}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function WeekAhead({ data }: { data: Dashboard }) {
  const total = data.nextDays.reduce((s, d) => s + d.count, 0);
  return (
    <section className="card" aria-labelledby="week-title">
      <div className="card-header">
        <h2 id="week-title">
          <CalendarDays size={18} aria-hidden /> Next 7 days
        </h2>
        <span className="subtle">{pluralize(total, 'review')}</span>
      </div>
      <BarChart
        compact
        caption="Reviews scheduled for each of the next 7 days"
        bars={data.nextDays.map((d, i) => ({
          key: d.date,
          label: i === 0 ? 'Tmrw' : formatWeekday(d.date),
          value: d.count,
          title: `${formatDate(d.date)}: ${pluralize(d.count, 'review')}`,
        }))}
      />
    </section>
  );
}

function StudyNext() {
  const recs = useRecommendations();
  if (!recs.data || recs.data.length === 0) return null;
  return (
    <section className="card" aria-labelledby="study-next">
      <div id="study-next" style={{ marginBottom: 8 }}>
        <RecommendationHeading />
      </div>
      <RecommendationList items={recs.data} showCourse />
    </section>
  );
}

function DemoBanner() {
  const remove = useRemoveDemo();
  const toast = useToast();
  return (
    <div className="alert alert-warning" role="note">
      <Sparkles size={18} aria-hidden />
      <div className="alert-body">
        <strong>You're exploring demo data.</strong> The demo courses are marked "Demo" and won't mix with your own.
      </div>
      <button
        type="button"
        className="btn btn-secondary btn-sm"
        disabled={remove.isPending}
        onClick={() =>
          remove.mutate(undefined, {
            onSuccess: () => toast('Demo data removed'),
            onError: (err) => toast(errorMessage(err), 'error'),
          })
        }
      >
        Remove demo data
      </button>
    </div>
  );
}

function Onboarding() {
  const [open, setOpen] = useState(false);
  const loadDemo = useLoadDemo();
  const toast = useToast();
  return (
    <section className="card">
      <EmptyState
        icon={<BookOpen size={26} />}
        title="You don't have any courses yet."
        actions={
          <>
            <Link to="/connect" className="btn btn-primary">
              <GraduationCap size={18} aria-hidden /> Find my course at my school
            </Link>
            <button type="button" className="btn btn-secondary" onClick={() => setOpen(true)}>
              <Plus size={18} aria-hidden /> Add your first course
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={loadDemo.isPending}
              onClick={() =>
                loadDemo.mutate(undefined, {
                  onSuccess: () => toast('Demo data loaded'),
                  onError: (err) => toast(errorMessage(err), 'error'),
                })
              }
            >
              {loadDemo.isPending && <span className="spinner" aria-hidden />}
              Explore with demo data
            </button>
          </>
        }
      >
        Start with a course, add a topic you learned recently, and Recall will tell you exactly when to review it.
      </EmptyState>
      <ol className="grid grid-3" style={{ listStyle: 'none', padding: 0, margin: '8px 0 0' }}>
        {[
          ['1. Add a course', 'e.g. COMP 1805 — Discrete Mathematics.'],
          ['2. Log what you learned', 'A topic, the date, and a few questions.'],
          ['3. Review when asked', 'Answer from memory, rate yourself, done.'],
        ].map(([t, d]) => (
          <li key={t} className="alert">
            <div className="alert-body">
              <strong>{t}</strong>
              <p className="muted">{d}</p>
            </div>
          </li>
        ))}
      </ol>
      <CourseFormModal open={open} onClose={() => setOpen(false)} />
    </section>
  );
}

function NoTopics() {
  return (
    <section className="card">
      <EmptyState
        icon={<Sparkles size={26} />}
        title="What did you learn recently?"
        actions={
          <Link to="/topics/new" className="btn btn-primary">
            <Plus size={18} aria-hidden /> Add your first topic
          </Link>
        }
      >
        Add a topic from one of your courses. Recall schedules the first review automatically.
      </EmptyState>
    </section>
  );
}
