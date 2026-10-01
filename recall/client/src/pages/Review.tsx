import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowRight, CalendarCheck, CheckCircle2, Eye, Info, PartyPopper, Plus, RotateCw, X } from 'lucide-react';
import type { ReviewResult, ReviewSession } from '@shared/api';
import { RATINGS, type Rating } from '@shared/scheduler';
import { errorMessage } from '../api/client';
import { fetchQueue, fetchReviewSession, useSubmitReview } from '../api/hooks';
import { useToday } from '../auth/AuthContext';
import { CourseTag, RatingBadge } from '../components/Badges';
import { FormError } from '../components/Field';
import { EmptyState, ErrorState, Spinner } from '../components/States';
import { formatDate, formatInterval, KIND_LABEL, pluralize, RATING_META, relativeDay, uuid } from '../lib/format';

type QueueState = { status: 'loading' } | { status: 'error'; error: unknown } | { status: 'ready'; ids: number[] };

export function ReviewPage() {
  const { topicId } = useParams();
  const single = topicId !== undefined ? Number(topicId) : undefined;
  const [queue, setQueue] = useState<QueueState>({ status: 'loading' });
  const [index, setIndex] = useState(0);
  const [results, setResults] = useState<ReviewResult[]>([]);

  const loadQueue = useCallback(() => {
    setQueue({ status: 'loading' });
    setIndex(0);
    setResults([]);
    if (single !== undefined) {
      setQueue(Number.isSafeInteger(single) && single > 0 ? { status: 'ready', ids: [single] } : { status: 'ready', ids: [] });
      return;
    }
    // The queue is a snapshot: topics rescheduled during the session don't reappear in it.
    fetchQueue()
      .then((topics) => setQueue({ status: 'ready', ids: topics.map((t) => t.id) }))
      .catch((error) => setQueue({ status: 'error', error }));
  }, [single]);

  useEffect(loadQueue, [loadQueue]);

  if (queue.status === 'loading') {
    return (
      <div className="review-shell center-screen">
        <Spinner label="Preparing your review" />
      </div>
    );
  }
  if (queue.status === 'error') {
    return (
      <div className="review-shell">
        <ErrorState error={queue.error} onRetry={loadQueue} />
      </div>
    );
  }
  if (queue.ids.length === 0) {
    return (
      <div className="review-shell">
        <div className="card">
          <EmptyState
            icon={<CheckCircle2 size={26} />}
            title="You're all caught up."
            actions={
              <Link to="/" className="btn btn-primary">
                Back to Today
              </Link>
            }
          >
            Nothing is due for review right now. New reviews appear here on the day they're scheduled.
          </EmptyState>
        </div>
      </div>
    );
  }
  if (index >= queue.ids.length) {
    return <SessionSummary results={results} onRestart={loadQueue} single={single !== undefined} />;
  }

  return (
    <div className="review-shell">
      <div className="review-progress">
        <Link to="/" className="icon-btn" aria-label="End review session">
          <X size={20} aria-hidden />
        </Link>
        <div
          className="meter"
          role="progressbar"
          aria-label="Session progress"
          aria-valuemin={0}
          aria-valuemax={queue.ids.length}
          aria-valuenow={index}
        >
          <span style={{ width: `${(index / queue.ids.length) * 100}%` }} />
        </div>
        <span className="subtle nowrap">
          {index + 1} of {queue.ids.length}
        </span>
      </div>
      <TopicReview
        key={queue.ids[index]}
        topicId={queue.ids[index]}
        isLast={index === queue.ids.length - 1}
        onComplete={(r) => setResults((rs) => [...rs, r])}
        onNext={() => setIndex((i) => i + 1)}
      />
    </div>
  );
}

type Phase =
  | { name: 'loading' }
  | { name: 'load-error'; error: unknown }
  | { name: 'asking' }
  | { name: 'submitting' }
  | { name: 'submit-error'; message: string }
  | { name: 'done'; result: ReviewResult };

function TopicReview({
  topicId,
  isLast,
  onComplete,
  onNext,
}: {
  topicId: number;
  isLast: boolean;
  onComplete: (r: ReviewResult) => void;
  onNext: () => void;
}) {
  const today = useToday();
  const [session, setSession] = useState<ReviewSession | null>(null);
  const [phase, setPhase] = useState<Phase>({ name: 'loading' });
  const [qIndex, setQIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [attempt, setAttempt] = useState('');
  const [ratings, setRatings] = useState<Rating[]>([]);
  // One id per topic review: a retried submission is recognised by the server and not double-counted.
  const clientId = useRef(uuid());
  const submit = useSubmitReview();
  const revealRef = useRef<HTMLButtonElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);

  const load = useCallback(() => {
    setPhase({ name: 'loading' });
    fetchReviewSession(topicId)
      .then((s) => {
        setSession(s);
        setPhase({ name: 'asking' });
      })
      .catch((error) => setPhase({ name: 'load-error', error }));
  }, [topicId]);
  useEffect(load, [load]);

  const cards = session
    ? session.mode === 'questions'
      ? session.questions
      : [
          {
            id: 0,
            prompt: `Without looking at your notes, explain “${session.topic.title}” in your own words.`,
            answer: session.topic.description || 'This topic has no description yet. Compare your answer with your course notes.',
            kind: null,
            isNew: false,
          },
        ]
    : [];
  const card = cards[qIndex];

  const send = useCallback(
    (all: Rating[]) => {
      if (!session) return;
      setPhase({ name: 'submitting' });
      const body =
        session.mode === 'questions'
          ? { clientId: clientId.current, answers: session.questions.map((q, i) => ({ questionId: q.id, rating: all[i] })) }
          : { clientId: clientId.current, rating: all[0] };
      submit.mutate(
        { topicId, ...body },
        {
          onSuccess: (result) => {
            onComplete(result);
            setPhase({ name: 'done', result });
          },
          onError: (err) => setPhase({ name: 'submit-error', message: errorMessage(err) }),
        },
      );
    },
    [session, submit, topicId, onComplete],
  );

  const rate = useCallback(
    (rating: Rating) => {
      const all = [...ratings, rating];
      setRatings(all);
      if (all.length < cards.length) {
        setQIndex((i) => i + 1);
        setRevealed(false);
        setAttempt('');
      } else {
        send(all);
      }
    },
    [ratings, cards.length, send],
  );

  // Keyboard: Space/Enter reveals, 1–4 rates, Enter continues.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement;
      if (phase.name === 'asking' && !revealed) {
        if ((e.key === 'Enter' && (e.ctrlKey || e.metaKey)) || (!typing && (e.key === ' ' || e.key === 'Enter'))) {
          e.preventDefault();
          setRevealed(true);
        }
      } else if (phase.name === 'asking' && revealed && !typing && ['1', '2', '3', '4'].includes(e.key)) {
        e.preventDefault();
        rate(RATINGS[Number(e.key) - 1]);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase.name, revealed, rate]);

  useEffect(() => {
    if (phase.name === 'done') nextRef.current?.focus();
  }, [phase.name]);

  if (phase.name === 'loading') {
    return (
      <div className="flashcard" aria-busy="true">
        <div className="skeleton" style={{ height: 18, width: '30%' }} />
        <div className="skeleton" style={{ height: 60 }} />
        <div className="skeleton" style={{ height: 44, width: 160 }} />
      </div>
    );
  }
  if (phase.name === 'load-error' || !session || !card) {
    return <ErrorState error={phase.name === 'load-error' ? phase.error : null} onRetry={load} />;
  }

  const topic = session.topic;

  if (phase.name === 'done') {
    const r = phase.result;
    return (
      <section className="flashcard" aria-labelledby="result-title" aria-live="polite">
        <div className="eyebrow">
          <CourseTag course={topic.course} /> {topic.title}
        </div>
        <div className="row">
          <CalendarCheck size={28} aria-hidden style={{ color: 'var(--success)' }} />
          <div>
            <h2 id="result-title" className="result-big">
              Next review {relativeDay(r.nextReviewOn, today).toLowerCase()}
            </h2>
            <p className="muted">
              {formatDate(r.nextReviewOn, today)} · you rated it <RatingBadge rating={r.rating} />
            </p>
          </div>
        </div>
        <div className="alert">
          <Info size={18} aria-hidden />
          <div className="alert-body">
            <p>
              Interval {formatInterval(r.previousInterval)} → <strong>{formatInterval(r.newInterval)}</strong>.{' '}
              {explainResult(r)}
            </p>
          </div>
        </div>
        {session.mode === 'free' && (
          <p className="subtle">
            Tip: <Link to={`/topics/${topic.id}`}>add questions to this topic</Link> so Recall can test specific facts next time.
          </p>
        )}
        <div className="form-actions">
          <button ref={nextRef} type="button" className="btn btn-primary btn-lg" onClick={onNext}>
            {isLast ? 'Finish' : 'Next topic'} <ArrowRight size={18} aria-hidden />
          </button>
        </div>
      </section>
    );
  }

  const early = topic.daysUntilDue > 0;
  return (
    <section className="flashcard" aria-labelledby="prompt">
      <div className="eyebrow">
        <CourseTag course={topic.course} />
        <span>{topic.title}</span>
        {card.kind && <span className="badge badge-new">{KIND_LABEL[card.kind]}</span>}
        {card.isNew && <span className="badge badge-mastered">New question</span>}
        {cards.length > 1 && (
          <span style={{ marginLeft: 'auto' }}>
            Question {qIndex + 1} of {cards.length}
          </span>
        )}
      </div>

      {early && qIndex === 0 && !revealed && (
        <div className="alert alert-info">
          <Info size={18} aria-hidden />
          <div className="alert-body">
            This topic isn't due until {formatDate(topic.nextReviewOn, today)}. Reviewing early is fine — a good result
            won't move your review earlier.
          </div>
        </div>
      )}

      <p id="prompt" className="prompt">
        {card.prompt}
      </p>

      {!revealed ? (
        <>
          <label className="field">
            <span className="label subtle">Your answer (optional — saying it out loud works too)</span>
            <textarea className="textarea" value={attempt} onChange={(e) => setAttempt(e.target.value)} placeholder="Type what you remember…" />
          </label>
          <button ref={revealRef} type="button" className="btn btn-primary btn-lg" onClick={() => setRevealed(true)}>
            <Eye size={18} aria-hidden /> Show answer
          </button>
          <p className="keyboard-hint">
            Press <kbd>Space</kbd> to show the answer (<kbd>Ctrl</kbd>+<kbd>Enter</kbd> while typing)
          </p>
        </>
      ) : (
        <>
          {attempt.trim() && (
            <div>
              <span className="subtle">Your answer</span>
              <div className="attempt">{attempt}</div>
            </div>
          )}
          <div className="answer" aria-live="polite">
            <span className="subtle" style={{ display: 'block', marginBottom: 6 }}>
              Answer
            </span>
            {card.answer}
          </div>

          {phase.name === 'submit-error' && (
            <div className="stack">
              <FormError message={`Your rating wasn't saved: ${phase.message}`} />
              <button type="button" className="btn btn-primary" onClick={() => send(ratings)}>
                <RotateCw size={16} aria-hidden /> Try again
              </button>
            </div>
          )}

          {phase.name !== 'submit-error' && (
            <fieldset style={{ border: 0, padding: 0, margin: 0 }} disabled={phase.name === 'submitting'}>
              <legend style={{ fontWeight: 650, marginBottom: 10 }}>How well did you remember it?</legend>
              <div className="rating-grid">
                {RATINGS.map((r, i) => (
                  <button key={r} type="button" className={`rating-btn ${r}`} onClick={() => rate(r)}>
                    <strong>
                      {RATING_META[r].label} <kbd>{i + 1}</kbd>
                    </strong>
                    <span>{RATING_META[r].description}</span>
                  </button>
                ))}
              </div>
              {phase.name === 'submitting' && (
                <div className="row" style={{ marginTop: 12 }}>
                  <Spinner label="Saving" /> <span className="subtle">Scheduling your next review…</span>
                </div>
              )}
            </fieldset>
          )}
        </>
      )}
    </section>
  );
}

function explainResult(r: ReviewResult): string {
  if (r.rating === 'forgot') return "No problem — you'll see it again tomorrow and rebuild from there.";
  if (r.early) return 'Early review: only the time that actually passed was credited.';
  if (r.daysOverdue > 0) return `You were ${pluralize(r.daysOverdue, 'day')} late and still remembered it, so part of that time counted in your favour.`;
  if (r.rating === 'hard') return 'Slightly longer gap, and Recall will be more cautious with this topic.';
  if (r.rating === 'easy') return 'Big jump — this one is sticking.';
  return 'The gap grows each time you remember it.';
}

function SessionSummary({ results, onRestart, single }: { results: ReviewResult[]; onRestart: () => void; single: boolean }) {
  const navigate = useNavigate();
  const counts = RATINGS.map((r) => [r, results.filter((x) => x.rating === r).length] as const).filter(([, n]) => n > 0);
  return (
    <div className="review-shell">
      <div className="card">
        <EmptyState
          icon={<PartyPopper size={26} />}
          title={single ? 'Review saved' : 'Session complete'}
          actions={
            <>
              <button type="button" className="btn btn-primary" onClick={() => navigate('/')}>
                Back to Today
              </button>
              {!single && (
                <button type="button" className="btn btn-secondary" onClick={onRestart}>
                  Check for more
                </button>
              )}
              <Link to="/topics/new" className="btn btn-ghost">
                <Plus size={16} aria-hidden /> Add a topic
              </Link>
            </>
          }
        >
          You reviewed {pluralize(results.length, 'topic')}. Recall has scheduled each one for the right time.
        </EmptyState>
        {counts.length > 0 && (
          <div className="row" style={{ justifyContent: 'center' }}>
            {counts.map(([r, n]) => (
              <span key={r} className={`badge rating-${r}`}>
                {RATING_META[r].label}: {n}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
