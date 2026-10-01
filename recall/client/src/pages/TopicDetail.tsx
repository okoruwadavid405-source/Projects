import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { CalendarCheck, ChevronRight, History, MessageSquarePlus, Pencil, Play, Plus, Trash2 } from 'lucide-react';
import type { Question, TopicDetail } from '@shared/api';
import { compareDates, isLocalDate } from '@shared/dates';
import { questionInputSchema, topicUpdateSchema } from '@shared/validation';
import { ApiError, errorMessage, fieldErrors } from '../api/client';
import { useAddQuestion, useCourses, useDeleteQuestion, useDeleteTopic, useTopic, useUpdateQuestion, useUpdateTopic } from '../api/hooks';
import { useToday } from '../auth/AuthContext';
import { CourseTag, RatingBadge, StatusBadge } from '../components/Badges';
import { Field, FormError } from '../components/Field';
import { ConfirmDialog, Modal } from '../components/Modal';
import { EmptyState, ErrorState, PageSkeleton } from '../components/States';
import { useToast } from '../components/Toast';
import { dueLabel, formatDate, formatInterval, pluralize, relativeDay, UNDERSTANDING_LABELS } from '../lib/format';
import { NotFoundPage } from './NotFound';

export function TopicDetailPage() {
  const id = Number(useParams().topicId);
  const { data: topic, error, isPending, refetch } = useTopic(id);
  const today = useToday();
  const navigate = useNavigate();
  const toast = useToast();
  const remove = useDeleteTopic();
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);

  if (isPending) return <PageSkeleton />;
  if (error instanceof ApiError && error.status === 404) return <NotFoundPage what="topic" />;
  if (error) return <div className="page"><ErrorState error={error} onRetry={() => void refetch()} /></div>;

  const due = topic.daysUntilDue <= 0;
  return (
    <div className="page">
      <div className="page-header">
        <div className="titles">
          <nav className="breadcrumb" aria-label="Breadcrumb">
            <Link to="/courses">Courses</Link> <ChevronRight size={14} aria-hidden />
            <Link to={`/courses/${topic.course.id}`}>{topic.course.code}</Link> <ChevronRight size={14} aria-hidden />
            <span>{topic.title}</span>
          </nav>
          <div className="row">
            <h1>{topic.title}</h1>
            <StatusBadge status={topic.status} />
          </div>
          {topic.description && <p className="muted" style={{ maxWidth: 680 }}>{topic.description}</p>}
        </div>
        <div className="actions">
          <button type="button" className="btn btn-secondary" onClick={() => setEditing(true)}>
            <Pencil size={16} aria-hidden /> Edit
          </button>
          <button type="button" className="btn btn-danger-ghost" onClick={() => setDeleting(true)}>
            <Trash2 size={16} aria-hidden /> Delete
          </button>
          <Link to={`/review/${topic.id}`} className={`btn ${due ? 'btn-primary' : 'btn-secondary'}`}>
            <Play size={16} aria-hidden /> {due ? 'Review now' : 'Review early'}
          </Link>
        </div>
      </div>

      <div className="split">
        <div className="stack-lg">
          <Questions topic={topic} />
          <ReviewHistory topic={topic} />
        </div>
        <div className="stack-lg">
          <section className="card stack" aria-labelledby="schedule-title">
            <h2 id="schedule-title" className="row">
              <CalendarCheck size={18} aria-hidden /> Schedule
            </h2>
            <div>
              <div className="stat">
                <span className="label">Next review</span>
                <span className="value">{due ? dueLabel(topic.daysUntilDue) : relativeDay(topic.nextReviewOn, today)}</span>
                <span className="foot">{formatDate(topic.nextReviewOn, today)}</span>
              </div>
            </div>
            <dl className="kv">
              <div>
                <dt>Course</dt>
                <dd>
                  <CourseTag course={topic.course} />
                </dd>
              </div>
              <div>
                <dt>Learned</dt>
                <dd>{formatDate(topic.learnedOn, today)}</dd>
              </div>
              <div>
                <dt>Current gap</dt>
                <dd>{formatInterval(topic.interval)}</dd>
              </div>
              <div>
                <dt>Reviews</dt>
                <dd>{topic.reviewCount}</dd>
              </div>
              <div>
                <dt>Times forgotten</dt>
                <dd>{topic.lapseCount}</dd>
              </div>
              <div>
                <dt>Understanding</dt>
                <dd>
                  {topic.understanding}/5 · {UNDERSTANDING_LABELS[topic.understanding - 1]}
                </dd>
              </div>
            </dl>
            <div>
              <h3 style={{ fontSize: '0.88rem', marginBottom: 8 }}>Projected reviews</h3>
              <ol className="schedule-dates">
                {topic.projected.map((d, i) => (
                  <li key={d}>
                    <strong>#{topic.reviewCount + i + 1}</strong>
                    {formatDate(d, today)}
                  </li>
                ))}
              </ol>
              <p className="subtle" style={{ marginTop: 8 }}>
                If each review goes well — every rating adjusts the dates.
              </p>
            </div>
          </section>
        </div>
      </div>

      <EditTopicModal open={editing} topic={topic} onClose={() => setEditing(false)} />
      <ConfirmDialog
        open={deleting}
        title={`Delete “${topic.title}”?`}
        message="This deletes the topic, its questions and its review history. This can't be undone."
        confirmLabel="Delete topic"
        busy={remove.isPending}
        onClose={() => setDeleting(false)}
        onConfirm={() =>
          remove.mutate(topic.id, {
            onSuccess: () => {
              toast('Topic deleted');
              navigate(`/courses/${topic.course.id}`, { replace: true });
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

function Questions({ topic }: { topic: TopicDetail }) {
  const [adding, setAdding] = useState(false);
  return (
    <section className="card" aria-labelledby="questions-title">
      <div className="card-header">
        <h2 id="questions-title">Questions</h2>
        {topic.questions.length > 0 && !adding && (
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setAdding(true)}>
            <Plus size={16} aria-hidden /> Add question
          </button>
        )}
      </div>
      {topic.questions.length === 0 && !adding ? (
        <EmptyState
          icon={<MessageSquarePlus size={26} />}
          title="No questions yet"
          actions={
            <button type="button" className="btn btn-primary" onClick={() => setAdding(true)}>
              <Plus size={16} aria-hidden /> Add a question
            </button>
          }
        >
          Add questions to this topic so Recall can test your memory.
        </EmptyState>
      ) : (
        <ul>
          {topic.questions.map((q) => (
            <QuestionRow key={q.id} question={q} />
          ))}
        </ul>
      )}
      {adding && <QuestionForm topicId={topic.id} onDone={() => setAdding(false)} />}
    </section>
  );
}

function QuestionRow({ question }: { question: Question }) {
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const remove = useDeleteQuestion();
  const toast = useToast();

  if (editing) {
    return (
      <li className="question-item">
        <QuestionForm question={question} topicId={question.topicId} onDone={() => setEditing(false)} />
      </li>
    );
  }
  return (
    <li className="question-item">
      <div className="qa">
        <span className="q">{question.prompt}</span>
        <span className="a">{question.answer}</span>
      </div>
      <div className="row" style={{ flexWrap: 'nowrap', alignItems: 'flex-start' }}>
        <button type="button" className="icon-btn" onClick={() => setEditing(true)} aria-label={`Edit question: ${question.prompt}`}>
          <Pencil size={16} aria-hidden />
        </button>
        <button type="button" className="icon-btn" onClick={() => setConfirming(true)} aria-label={`Delete question: ${question.prompt}`}>
          <Trash2 size={16} aria-hidden />
        </button>
      </div>
      <ConfirmDialog
        open={confirming}
        title="Delete this question?"
        message={question.prompt}
        confirmLabel="Delete question"
        busy={remove.isPending}
        onClose={() => setConfirming(false)}
        onConfirm={() =>
          remove.mutate(question.id, {
            onSuccess: () => toast('Question deleted'),
            onError: (err) => toast(errorMessage(err), 'error'),
            onSettled: () => setConfirming(false),
          })
        }
      />
    </li>
  );
}

function QuestionForm({ topicId, question, onDone }: { topicId: number; question?: Question; onDone: () => void }) {
  const [prompt, setPrompt] = useState(question?.prompt ?? '');
  const [answer, setAnswer] = useState(question?.answer ?? '');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const add = useAddQuestion();
  const update = useUpdateQuestion();
  const toast = useToast();
  const busy = add.isPending || update.isPending;

  async function submit(e: FormEvent) {
    e.preventDefault();
    const parsed = questionInputSchema.safeParse({ prompt, answer });
    if (!parsed.success) {
      const errs: Record<string, string> = {};
      for (const issue of parsed.error.issues) errs[String(issue.path[0])] ??= issue.message;
      return setErrors(errs);
    }
    setErrors({});
    setFormError(null);
    try {
      if (question) await update.mutateAsync({ id: question.id, prompt, answer });
      else await add.mutateAsync({ topicId, prompt, answer });
      toast(question ? 'Question updated' : 'Question added');
      if (question) onDone();
      else {
        setPrompt('');
        setAnswer('');
      }
    } catch (err) {
      const f = fieldErrors(err);
      if (Object.keys(f).length) setErrors(f);
      else setFormError(errorMessage(err));
    }
  }

  return (
    <form className="question-draft" style={{ flex: 1, marginTop: question ? 0 : 12 }} onSubmit={submit} noValidate>
      <FormError message={formError} />
      <Field label="Question" error={errors.prompt}>
        <input className="input" value={prompt} onChange={(e) => setPrompt(e.target.value)} maxLength={1000} autoFocus />
      </Field>
      <Field label="Answer" error={errors.answer}>
        <textarea className="textarea" value={answer} onChange={(e) => setAnswer(e.target.value)} maxLength={4000} />
      </Field>
      <div className="form-actions">
        <button type="button" className="btn btn-ghost" onClick={onDone} disabled={busy}>
          {question ? 'Cancel' : 'Done'}
        </button>
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy && <span className="spinner" aria-hidden />}
          {question ? 'Save' : 'Add question'}
        </button>
      </div>
    </form>
  );
}

function ReviewHistory({ topic }: { topic: TopicDetail }) {
  const today = useToday();
  return (
    <section className="card" aria-labelledby="history-title">
      <div className="card-header">
        <h2 id="history-title">
          <History size={18} aria-hidden /> Review history
        </h2>
        <span className="subtle">{pluralize(topic.reviews.length, 'review')}</span>
      </div>
      {topic.reviews.length === 0 ? (
        <p className="muted">
          No reviews yet. The first one is {relativeDay(topic.nextReviewOn, today).toLowerCase()} ({formatDate(topic.nextReviewOn, today)}).
        </p>
      ) : (
        <ul className="list">
          {topic.reviews.map((r) => (
            <li key={r.id} className="list-item">
              <div className="main-col">
                <span className="title">{formatDate(r.reviewDay, today)}</span>
                <div className="meta">
                  <span>
                    Gap {formatInterval(r.previousInterval)} → {formatInterval(r.newInterval)}
                  </span>
                  {r.daysOverdue > 0 && <span>{pluralize(r.daysOverdue, 'day')} late</span>}
                </div>
              </div>
              <RatingBadge rating={r.rating} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function EditTopicModal({ open, topic, onClose }: { open: boolean; topic: TopicDetail; onClose: () => void }) {
  return (
    <Modal open={open} title="Edit topic" onClose={onClose}>
      {open && <EditTopicForm topic={topic} onDone={onClose} />}
    </Modal>
  );
}

function EditTopicForm({ topic, onDone }: { topic: TopicDetail; onDone: () => void }) {
  const today = useToday();
  const courses = useCourses();
  const update = useUpdateTopic();
  const toast = useToast();
  const [courseId, setCourseId] = useState(topic.courseId);
  const [title, setTitle] = useState(topic.title);
  const [description, setDescription] = useState(topic.description ?? '');
  const [learnedOn, setLearnedOn] = useState<string>(topic.learnedOn);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const input = { courseId, title, description, learnedOn };
    const parsed = topicUpdateSchema.safeParse(input);
    const errs: Record<string, string> = {};
    if (!parsed.success) for (const issue of parsed.error.issues) errs[String(issue.path[0])] ??= issue.message;
    if (isLocalDate(learnedOn) && compareDates(learnedOn, today) > 0) errs.learnedOn = 'The date learned cannot be in the future.';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    try {
      await update.mutateAsync({ id: topic.id, ...input });
      toast('Topic updated');
      onDone();
    } catch (err) {
      const f = fieldErrors(err);
      if (Object.keys(f).length) setErrors(f);
      else setFormError(errorMessage(err));
    }
  }

  return (
    <form className="stack-lg" onSubmit={submit} noValidate>
      <FormError message={formError} />
      <Field label="Course" error={errors.courseId}>
        <select className="select" value={courseId} onChange={(e) => setCourseId(Number(e.target.value))}>
          {(courses.data ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {c.code} — {c.name}
            </option>
          ))}
          {!courses.data && <option value={topic.courseId}>{topic.course.code}</option>}
        </select>
      </Field>
      <Field label="Topic" error={errors.title}>
        <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} />
      </Field>
      <Field label="Description" optional error={errors.description}>
        <textarea className="textarea" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000} />
      </Field>
      <Field
        label="Date learned"
        error={errors.learnedOn}
        hint={topic.reviewCount === 0 ? 'Changing this moves the first review.' : 'Your review history decides the next review date.'}
      >
        <input className="input" type="date" value={learnedOn} max={today} onChange={(e) => setLearnedOn(e.target.value)} />
      </Field>
      <div className="form-actions">
        <button type="button" className="btn btn-secondary" onClick={onDone} disabled={update.isPending}>
          Cancel
        </button>
        <button type="submit" className="btn btn-primary" disabled={update.isPending}>
          {update.isPending && <span className="spinner" aria-hidden />}
          Save changes
        </button>
      </div>
    </form>
  );
}
