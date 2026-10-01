import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { CalendarClock, ChevronRight, MessageSquareText, Pencil, Plus, Sparkles, Trash2 } from 'lucide-react';
import { ApiError, errorMessage } from '../api/client';
import { useCourse, useDeleteCourse } from '../api/hooks';
import { useToday } from '../auth/AuthContext';
import { DemoBadge, StatusBadge } from '../components/Badges';
import { CourseFormModal } from '../components/CourseForm';
import { ConfirmDialog } from '../components/Modal';
import { EmptyState, ErrorState, PageSkeleton } from '../components/States';
import { useToast } from '../components/Toast';
import { dueLabel, formatDate, pluralize } from '../lib/format';
import { NotFoundPage } from './NotFound';

export function CourseDetailPage() {
  const id = Number(useParams().courseId);
  const { data, error, isPending, refetch } = useCourse(id);
  const today = useToday();
  const navigate = useNavigate();
  const toast = useToast();
  const remove = useDeleteCourse();
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);

  if (isPending) return <PageSkeleton />;
  if (error instanceof ApiError && error.status === 404) return <NotFoundPage what="course" />;
  if (error) return <div className="page"><ErrorState error={error} onRetry={() => void refetch()} /></div>;

  const { course, topics } = data;
  return (
    <div className="page">
      <div className="page-header">
        <div className="titles">
          <nav className="breadcrumb" aria-label="Breadcrumb">
            <Link to="/courses">Courses</Link> <ChevronRight size={14} aria-hidden /> <span>{course.code}</span>
          </nav>
          <div className={`row c-${course.color}`}>
            <span className="course-swatch" style={{ width: 14, height: 14 }} aria-hidden />
            <h1>{course.code}</h1>
            {course.isDemo && <DemoBadge />}
          </div>
          <p className="muted">
            {course.name}
            {course.professor && ` · ${course.professor}`}
          </p>
        </div>
        <div className="actions">
          <button type="button" className="btn btn-secondary" onClick={() => setEditing(true)}>
            <Pencil size={16} aria-hidden /> Edit
          </button>
          <button type="button" className="btn btn-danger-ghost" onClick={() => setDeleting(true)}>
            <Trash2 size={16} aria-hidden /> Delete
          </button>
          <Link to={`/topics/new?courseId=${course.id}`} className="btn btn-primary">
            <Plus size={18} aria-hidden /> Add topic
          </Link>
        </div>
      </div>

      <section className="card" aria-labelledby="topics-title">
        <div className="card-header">
          <h2 id="topics-title">Topics</h2>
          <span className="subtle">
            {pluralize(course.topicCount, 'topic')} · {course.dueCount} to review
          </span>
        </div>
        {topics.length === 0 ? (
          <EmptyState
            icon={<Sparkles size={26} />}
            title="No topics yet"
            actions={
              <Link to={`/topics/new?courseId=${course.id}`} className="btn btn-primary">
                <Plus size={18} aria-hidden /> Add a topic
              </Link>
            }
          >
            Add something you learned in {course.code} and Recall will schedule its reviews.
          </EmptyState>
        ) : (
          <ul className="list">
            {topics.map((t) => (
              <li key={t.id} className="list-item">
                <div className="main-col">
                  <Link to={`/topics/${t.id}`} className="title">
                    {t.title}
                  </Link>
                  <div className="meta">
                    <StatusBadge status={t.status} />
                    <span>
                      <CalendarClock aria-hidden />
                      {t.daysUntilDue <= 0 ? dueLabel(t.daysUntilDue) : `Next ${formatDate(t.nextReviewOn, today)}`}
                    </span>
                    <span>
                      <MessageSquareText aria-hidden />
                      {pluralize(t.questionCount, 'question')}
                    </span>
                  </div>
                </div>
                {t.daysUntilDue <= 0 ? (
                  <Link to={`/review/${t.id}`} className="btn btn-secondary btn-sm" aria-label={`Review ${t.title} now`}>
                    Review now
                  </Link>
                ) : (
                  <ChevronRight size={18} aria-hidden className="subtle" />
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <CourseFormModal open={editing} course={course} onClose={() => setEditing(false)} />
      <ConfirmDialog
        open={deleting}
        title={`Delete ${course.code}?`}
        message={
          <>
            This permanently deletes the course, its {pluralize(course.topicCount, 'topic')}, their questions and review history.
            This can't be undone.
          </>
        }
        confirmLabel="Delete course"
        busy={remove.isPending}
        onClose={() => setDeleting(false)}
        onConfirm={() =>
          remove.mutate(course.id, {
            onSuccess: () => {
              toast(`${course.code} deleted`);
              navigate('/courses', { replace: true });
            },
            onError: (err) => {
              setDeleting(false);
              toast(errorMessage(err), 'error');
            },
          })
        }
      />
    </div>
  );
}
