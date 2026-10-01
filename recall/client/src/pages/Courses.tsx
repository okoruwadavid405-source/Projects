import { useState } from 'react';
import { Link } from 'react-router-dom';
import { BookOpen, GraduationCap, Plus } from 'lucide-react';
import { useCourses } from '../api/hooks';
import { DemoBadge } from '../components/Badges';
import { CourseFormModal } from '../components/CourseForm';
import { EmptyState, ErrorState, PageSkeleton } from '../components/States';
import { pluralize } from '../lib/format';

export function CoursesPage() {
  const { data: courses, error, isPending, refetch } = useCourses();
  const [open, setOpen] = useState(false);

  if (isPending) return <PageSkeleton />;
  if (error) return <div className="page"><ErrorState error={error} onRetry={() => void refetch()} /></div>;

  return (
    <div className="page">
      <div className="page-header">
        <div className="titles">
          <h1>Courses</h1>
          <p className="muted">{courses.length > 0 ? pluralize(courses.length, 'course') : 'Organise your topics by course.'}</p>
        </div>
        {courses.length > 0 && (
          <div className="actions">
            <Link to="/connect" className="btn btn-secondary">
              <GraduationCap size={18} aria-hidden /> Add from your school
            </Link>
            <button type="button" className="btn btn-primary" onClick={() => setOpen(true)}>
              <Plus size={18} aria-hidden /> New course
            </button>
          </div>
        )}
      </div>

      {courses.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={<BookOpen size={26} />}
            title="You don't have any courses yet."
            actions={
              <>
                <Link to="/connect" className="btn btn-primary">
                  <GraduationCap size={18} aria-hidden /> Find my course at my school
                </Link>
                <button type="button" className="btn btn-secondary" onClick={() => setOpen(true)}>
                  <Plus size={18} aria-hidden /> Add a course manually
                </button>
              </>
            }
          >
            Courses keep your topics organised — add one for each class you're taking.
          </EmptyState>
        </div>
      ) : (
        <ul className="grid grid-3">
          {courses.map((c) => {
            const masteredPct = c.topicCount > 0 ? (c.masteredCount / c.topicCount) * 100 : 0;
            return (
              <li key={c.id}>
                <Link to={`/courses/${c.id}`} className={`card course-card c-${c.color}`}>
                  <div className="spread">
                    <span className="code">{c.code}</span>
                    {c.isDemo && <DemoBadge />}
                  </div>
                  <div>
                    <div className="name">{c.name}</div>
                    {c.professor && <div className="subtle">{c.professor}</div>}
                  </div>
                  <div className="row subtle">
                    <span>{pluralize(c.topicCount, 'topic')}</span>
                    <span aria-hidden>·</span>
                    <span style={c.dueCount > 0 ? { color: 'var(--warning)', fontWeight: 650 } : undefined}>
                      {c.dueCount > 0 ? `${c.dueCount} to review` : 'Nothing due'}
                    </span>
                  </div>
                  <div className="stack" style={{ gap: 6 }}>
                    <div className="meter" aria-hidden>
                      <span style={{ width: `${masteredPct}%` }} />
                    </div>
                    <span className="subtle">
                      {c.masteredCount} of {c.topicCount} mastered
                    </span>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      <CourseFormModal open={open} onClose={() => setOpen(false)} />
    </div>
  );
}
