import { useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { CalendarCheck, ChevronRight, Plus, Trash2 } from 'lucide-react';
import { compareDates, isLocalDate } from '@shared/dates';
import { initialSchedule, projectSchedule } from '@shared/scheduler';
import { topicCreateSchema } from '@shared/validation';
import { errorMessage, fieldErrors } from '../api/client';
import { useCourses, useCreateTopic } from '../api/hooks';
import { useToday } from '../auth/AuthContext';
import { CourseFormModal } from '../components/CourseForm';
import { Field, FormError } from '../components/Field';
import { ErrorState, PageSkeleton } from '../components/States';
import { useToast } from '../components/Toast';
import { formatDate, relativeDay, UNDERSTANDING_LABELS } from '../lib/format';

interface Draft {
  key: number;
  prompt: string;
  answer: string;
}

let draftKey = 1;
const blankDraft = (): Draft => ({ key: draftKey++, prompt: '', answer: '' });

export function NewTopicPage() {
  const today = useToday();
  const navigate = useNavigate();
  const toast = useToast();
  const [params] = useSearchParams();
  const courses = useCourses();
  const create = useCreateTopic();

  const [courseId, setCourseId] = useState<number | ''>(Number(params.get('courseId')) || '');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [learnedOn, setLearnedOn] = useState<string>(today);
  const [understanding, setUnderstanding] = useState(3);
  const [drafts, setDrafts] = useState<Draft[]>([blankDraft()]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [courseModal, setCourseModal] = useState(false);

  const effectiveCourseId = courseId || (courses.data?.length === 1 ? courses.data[0].id : '');

  const preview = useMemo(() => {
    if (!isLocalDate(learnedOn) || compareDates(learnedOn, today) > 0) return null;
    return projectSchedule(initialSchedule(learnedOn, understanding, today), 5);
  }, [learnedOn, understanding, today]);

  if (courses.isPending) return <PageSkeleton />;
  if (courses.error) return <div className="page"><ErrorState error={courses.error} onRetry={() => void courses.refetch()} /></div>;

  const updateDraft = (key: number, patch: Partial<Draft>) => setDrafts((ds) => ds.map((d) => (d.key === key ? { ...d, ...patch } : d)));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    // Ignore completely blank question rows; half-filled ones are flagged.
    const filled = drafts.filter((d) => d.prompt.trim() || d.answer.trim());
    const input = {
      courseId: effectiveCourseId === '' ? 0 : effectiveCourseId,
      title,
      description,
      learnedOn,
      understanding,
      questions: filled.map(({ prompt, answer }) => ({ prompt, answer })),
    };
    const parsed = topicCreateSchema.safeParse(input);
    const errs: Record<string, string> = {};
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const path = issue.path;
        if (path[0] === 'questions' && typeof path[1] === 'number') {
          errs[`q-${filled[path[1]].key}-${String(path[2])}`] ??= issue.message;
        } else {
          errs[String(path[0])] ??= path[0] === 'courseId' ? 'Choose a course.' : issue.message;
        }
      }
    }
    if (isLocalDate(learnedOn) && compareDates(learnedOn, today) > 0) errs.learnedOn = 'The date learned cannot be in the future.';
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;

    try {
      const topic = await create.mutateAsync(input);
      toast(`“${topic.title}” added — first review ${relativeDay(topic.nextReviewOn, today).toLowerCase()}`);
      navigate(`/topics/${topic.id}`);
    } catch (err) {
      const f = fieldErrors(err);
      if (Object.keys(f).length) setErrors(f);
      else setFormError(errorMessage(err));
    }
  }

  const noCourses = courses.data.length === 0;

  return (
    <div className="page page-narrow">
      <div className="page-header">
        <div className="titles">
          <nav className="breadcrumb" aria-label="Breadcrumb">
            <Link to="/">Today</Link> <ChevronRight size={14} aria-hidden /> <span>Add topic</span>
          </nav>
          <h1>What did you learn?</h1>
          <p className="muted">Recall will schedule the reviews for you.</p>
        </div>
      </div>

      <form className="stack-lg" onSubmit={submit} noValidate>
        <FormError message={formError} />

        <section className="card stack-lg" aria-labelledby="topic-section">
          <h2 id="topic-section">What you learned</h2>
          {noCourses ? (
            <div className="alert alert-info">
              <div className="alert-body">You need a course first — topics live inside courses.</div>
              <button type="button" className="btn btn-primary btn-sm" onClick={() => setCourseModal(true)}>
                <Plus size={16} aria-hidden /> Create course
              </button>
            </div>
          ) : (
            <Field label="Course" error={errors.courseId}>
              <select className="select" value={effectiveCourseId} onChange={(e) => setCourseId(Number(e.target.value) || '')}>
                <option value="">Choose a course…</option>
                {courses.data.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.code} — {c.name}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <Field label="Topic" error={errors.title} hint="e.g. Sets">
            <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} autoComplete="off" autoFocus />
          </Field>
          <Field label="Description" optional error={errors.description} hint="Key ideas in a sentence or two — shown when you review without questions.">
            <textarea className="textarea" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000} />
          </Field>
          <div className="form-row">
            <Field label="Date learned" error={errors.learnedOn}>
              <input className="input" type="date" value={learnedOn} max={today} onChange={(e) => setLearnedOn(e.target.value)} />
            </Field>
            <fieldset style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
              <legend style={{ fontWeight: 600, fontSize: '0.9rem', marginBottom: 6 }}>How well do you understand it?</legend>
              <div className="segmented">
                {UNDERSTANDING_LABELS.map((label, i) => (
                  <label key={label}>
                    <input type="radio" name="understanding" value={i + 1} checked={understanding === i + 1} onChange={() => setUnderstanding(i + 1)} />
                    <strong>{i + 1}</strong>
                    {label}
                  </label>
                ))}
              </div>
            </fieldset>
          </div>
        </section>

        <section className="card stack-lg" aria-labelledby="questions-section">
          <div className="spread">
            <div>
              <h2 id="questions-section">Questions</h2>
              <p className="subtle">Recall quizzes you with these. Short, specific questions work best.</p>
            </div>
          </div>
          {drafts.map((d, i) => (
            <div key={d.key} className="question-draft">
              <div className="spread">
                <strong>Question {i + 1}</strong>
                {drafts.length > 1 && (
                  <button
                    type="button"
                    className="icon-btn"
                    onClick={() => setDrafts((ds) => ds.filter((x) => x.key !== d.key))}
                    aria-label={`Remove question ${i + 1}`}
                  >
                    <Trash2 size={17} aria-hidden />
                  </button>
                )}
              </div>
              <Field label="Question" error={errors[`q-${d.key}-prompt`]}>
                <input
                  className="input"
                  value={d.prompt}
                  onChange={(e) => updateDraft(d.key, { prompt: e.target.value })}
                  placeholder="What is the difference between a subset and a proper subset?"
                  maxLength={1000}
                />
              </Field>
              <Field label="Answer" error={errors[`q-${d.key}-answer`]}>
                <textarea className="textarea" value={d.answer} onChange={(e) => updateDraft(d.key, { answer: e.target.value })} maxLength={4000} />
              </Field>
            </div>
          ))}
          <div>
            <button type="button" className="btn btn-secondary" onClick={() => setDrafts((ds) => [...ds, blankDraft()])} disabled={drafts.length >= 50}>
              <Plus size={16} aria-hidden /> Add another question
            </button>
          </div>
        </section>

        {preview && (
          <section className="card" aria-labelledby="preview-title">
            <div className="card-header">
              <h2 id="preview-title">
                <CalendarCheck size={18} aria-hidden /> Your review plan
              </h2>
            </div>
            <ol className="schedule-dates">
              {preview.map((d, i) => (
                <li key={d}>
                  <strong>Review {i + 1}</strong>
                  {formatDate(d, today)}
                </li>
              ))}
            </ol>
            <p className="subtle" style={{ marginTop: 10 }}>
              If each review goes well. Recall adjusts every date to how well you actually remember.
            </p>
          </section>
        )}

        <div className="form-actions">
          <button type="button" className="btn btn-secondary" onClick={() => navigate(-1)}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary btn-lg" disabled={create.isPending || noCourses}>
            {create.isPending && <span className="spinner" aria-hidden />}
            Save topic
          </button>
        </div>
      </form>

      <CourseFormModal open={courseModal} onClose={() => setCourseModal(false)} onSaved={(c) => setCourseId(c.id)} />
    </div>
  );
}
