import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  BookMarked,
  CalendarClock,
  ExternalLink,
  FileText,
  GraduationCap,
  History,
  Info,
  Link2Off,
  Lock,
  Play,
  Sparkles,
  Trash2,
  Upload,
} from 'lucide-react';
import type { LocalDate } from '@shared/dates';
import { EVIDENCE_STATUSES, STATUS_META, type EvidenceStatus } from '@shared/knowledge';
import type { CourseProfile, ProfileTopic, StudentCourse } from '@shared/knowledgeApi';
import type { Course } from '@shared/api';
import { errorMessage } from '../../api/client';
import { useFeatures } from '../../api/hooks';
import { deleteDocument, deleteSource, requestSuggestions, unlinkCourse, useKnowledgeMutation, useProfile, useRecommendations } from '../../api/knowledge';
import { formatDate, pluralize, relativeDay } from '../../lib/format';
import { RatingBadge, StatusBadge } from '../Badges';
import { ConfirmDialog } from '../Modal';
import { EmptyState, ErrorState, PageSkeleton } from '../States';
import { useToast } from '../Toast';
import { EvidenceBadge } from './EvidenceBadge';
import { ReviewModal, UploadModal } from './ExtractionReview';
import { RecommendationHeading, RecommendationList } from './Recommendations';
import { ResourcesPanel } from './Resources';
import { StudyModal } from './StudyModal';

/** Shown on a Recall course that isn't linked to a school course yet. */
export function ConnectPrompt({ course }: { course: Course }) {
  return (
    <div className="card">
      <EmptyState
        icon={<GraduationCap size={26} />}
        title="Connect this course to your school"
        actions={
          <Link to={`/connect?code=${encodeURIComponent(course.code)}`} className="btn btn-primary">
            Find {course.code} at my school
          </Link>
        }
      >
        Recall can build a profile of {course.code} from your syllabus and other sources — what's confirmed for your term, what appeared in past
        versions, and what you haven't started yet.
      </EmptyState>
    </div>
  );
}

type Filter = 'all' | EvidenceStatus;

export function CourseKnowledge({ sc, reviewDocId, onReviewDocChange }: { sc: StudentCourse; reviewDocId: number | null; onReviewDocChange: (id: number | null) => void }) {
  const { data: profile, error, isPending, refetch } = useProfile(sc.id);
  const recs = useRecommendations(sc.id);
  const features = useFeatures().data;
  const toast = useToast();
  const [uploading, setUploading] = useState(false);
  const [studying, setStudying] = useState<ProfileTopic | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [unlinking, setUnlinking] = useState(false);
  const suggest = useKnowledgeMutation(() => requestSuggestions(sc.id));
  const unlink = useKnowledgeMutation(() => unlinkCourse(sc.id));
  const removeDoc = useKnowledgeMutation((id: number) => deleteDocument(id));
  const removeSource = useKnowledgeMutation((id: number) => deleteSource(id));

  const topics = useMemo(() => (profile ? profile.topics.filter((t) => filter === 'all' || t.status === filter) : []), [profile, filter]);

  if (isPending) return <PageSkeleton rows={2} />;
  if (error) return <ErrorState error={error} onRetry={() => void refetch()} />;

  const p: CourseProfile = profile;
  const pendingReview = p.documents.filter((d) => d.status === 'needs_review');
  const processing = p.documents.filter((d) => d.status === 'processing');

  return (
    <div className="stack-lg">
      <section className="card stack" aria-labelledby="kp-title">
        <div className="spread" style={{ flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <div>
            <h2 id="kp-title">Course knowledge profile</h2>
            <p className="subtle">
              {sc.course.university.name} · {sc.course.department.name} · {sc.version.label}
              {p.instructor && ` · Instructor: ${p.instructor.name}`}
            </p>
            {!sc.course.verified && <p className="subtle">This course was added by a student and hasn't been verified.</p>}
          </div>
          <div className="row">
            <button type="button" className="btn btn-primary btn-sm" onClick={() => setUploading(true)}>
              <Upload size={15} aria-hidden /> Upload material
            </button>
            {features?.suggestions && (
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={suggest.isPending}
                onClick={() =>
                  suggest.mutate(undefined, {
                    onSuccess: (r) => toast(r.added ? `${pluralize(r.added, 'suggestion')} added — labelled as AI suggestions` : 'No new suggestions'),
                    onError: (e) => toast(errorMessage(e), 'error'),
                  })
                }
              >
                {suggest.isPending ? <span className="spinner" aria-hidden /> : <Sparkles size={15} aria-hidden />} Suggest related topics
              </button>
            )}
          </div>
        </div>
        <div className="summary-tiles">
          {(['confirmed', 'your_materials', 'historical', 'suggested'] as const).map((s) => (
            <div key={s}>
              <strong>{p.counts[s]}</strong>
              <span>{STATUS_META[s].label}</span>
            </div>
          ))}
          <div>
            <strong>{p.sources.length}</strong>
            <span>{p.sources.length === 1 ? 'Source' : 'Sources'}</span>
          </div>
        </div>
        {p.notice && (
          <div className="alert alert-warning" role="status">
            <Info size={18} aria-hidden />
            <div className="alert-body">{p.notice}</div>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setUploading(true)}>
              Upload syllabus
            </button>
          </div>
        )}
        {processing.map((d) => (
          <p key={d.id} className="generating-note" role="status">
            <span className="spinner" aria-hidden /> Reading {d.filename}…
          </p>
        ))}
        {pendingReview.map((d) => (
          <div key={d.id} className="alert alert-info">
            <FileText size={18} aria-hidden />
            <div className="alert-body">
              <strong>{d.filename}</strong> is ready — check what Recall found before it's used.
            </div>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => onReviewDocChange(d.id)}>
              Review
            </button>
          </div>
        ))}
      </section>

      <div className="split">
        <div className="stack-lg">
          <section className="card" aria-labelledby="ktopics-title">
            <div className="card-header" style={{ flexWrap: 'wrap' }}>
              <h2 id="ktopics-title">Course topics</h2>
              <div className="row" role="group" aria-label="Filter topics">
                {(['all', ...EVIDENCE_STATUSES] as Filter[])
                  .filter((f) => f === 'all' || p.counts[f as EvidenceStatus] > 0)
                  .map((f) => (
                    <button key={f} type="button" className={`btn btn-sm ${filter === f ? 'btn-primary' : 'btn-ghost'}`} aria-pressed={filter === f} onClick={() => setFilter(f)}>
                      {f === 'all' ? 'All' : STATUS_META[f as EvidenceStatus].label}
                    </button>
                  ))}
              </div>
            </div>
            {p.topics.length === 0 ? (
              <EmptyState icon={<BookMarked size={26} />} title="No course topics yet" actions={<button type="button" className="btn btn-primary" onClick={() => setUploading(true)}>Upload your syllabus</button>}>
                Recall doesn't guess what your course covers. Upload your syllabus (or find the official outline) and confirm the topics.
              </EmptyState>
            ) : (
              <ul>
                {topics.map((t) => (
                  <TopicRow key={t.key} topic={t} today={p.today} onStudy={() => setStudying(t)} />
                ))}
              </ul>
            )}
          </section>

          {p.missing.length > 0 && (
            <section className="card stack" aria-labelledby="missing-title">
              <h2 id="missing-title" className="row">
                <History size={18} aria-hidden /> What am I missing?
              </h2>
              <p className="muted">
                These topics appeared in historical versions of this course. They are <strong>not confirmed</strong> in your current course — check
                with your syllabus or instructor before spending time on them.
              </p>
              <ul>
                {p.missing.map((t) => (
                  <li key={t.key} className="ktopic">
                    <div className="body">
                      <span className="name">{t.name}</span>
                      <span className="subs">From: {t.evidence.map((e) => e.sourceTitle).join('; ')}</span>
                      {t.conflict && <span className="subs">{t.conflict}</span>}
                    </div>
                    <EvidenceBadge status={t.status} />
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>

        <div className="stack-lg">
          <section className="card" aria-labelledby="recs-title">
            <div id="recs-title" style={{ marginBottom: 8 }}>
              <RecommendationHeading />
            </div>
            {recs.data ? (
              <RecommendationList
                items={recs.data}
                onStudy={(r) => {
                  const t = p.topics.find((x) => x.key === r.topicKey);
                  if (t) setStudying(t);
                }}
              />
            ) : (
              <span className="spinner" aria-label="Loading" />
            )}
          </section>

          {p.assessments.length > 0 && (
            <section className="card" aria-labelledby="assess-title">
              <h2 id="assess-title" className="row" style={{ marginBottom: 8 }}>
                <CalendarClock size={18} aria-hidden /> Assessments
              </h2>
              <ul>
                {p.assessments.map((a) => (
                  <li key={a.id} className="ktopic">
                    <div className="body">
                      <span className="name">
                        {a.name}
                        {a.weight !== null && ` · ${a.weight}%`}
                      </span>
                      <span className="meta">
                        {a.dueOn ? `${formatDate(a.dueOn, p.today)} (${relativeDay(a.dueOn, p.today).toLowerCase()})` : 'Date not stated'}
                        {a.topics.length > 0 && ` · covers ${a.topics.join(', ')}`}
                      </span>
                    </div>
                    <EvidenceBadge status={a.status} />
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="card" aria-labelledby="src-title">
            <h2 id="src-title" style={{ marginBottom: 4 }}>
              Sources
            </h2>
            <p className="subtle" style={{ marginBottom: 8 }}>
              Most reliable first. Current official material outranks everything else.
            </p>
            {p.sources.length === 0 && <p className="muted">No sources yet.</p>}
            <ul>
              {p.sources.map((s) => (
                <li key={s.id} className="ktopic">
                  <div className="body">
                    <span className="name">
                      {s.url ? (
                        <a href={s.url} target="_blank" rel="noopener noreferrer">
                          {s.title} <ExternalLink size={12} aria-hidden style={{ display: 'inline' }} />
                        </a>
                      ) : (
                        s.title
                      )}
                    </span>
                    <span className="meta">
                      <span className="badge">{s.tierLabel}</span>
                      {s.isPrivate && (
                        <span>
                          <Lock size={12} aria-hidden style={{ display: 'inline' }} /> Private to you
                        </span>
                      )}
                      {s.isDemo && <span className="badge badge-demo">Demo</span>}
                      {s.topicCount > 0 && <span>{pluralize(s.topicCount, 'topic')}</span>}
                    </span>
                  </div>
                  {s.isPrivate && !s.isDemo && (
                    <button
                      type="button"
                      className="icon-btn"
                      aria-label={`Remove ${s.title}`}
                      onClick={() =>
                        s.documentId
                          ? removeDoc.mutate(s.documentId, { onSuccess: () => toast('Removed') })
                          : removeSource.mutate(s.id, { onSuccess: () => toast('Removed') })
                      }
                    >
                      <Trash2 size={16} aria-hidden />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </section>

          <ResourcesPanel sc={sc} onImported={(doc) => onReviewDocChange(doc.id)} />

          <div>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setUnlinking(true)}>
              <Link2Off size={15} aria-hidden /> Disconnect from {sc.course.university.name}
            </button>
          </div>
        </div>
      </div>

      <UploadModal
        open={uploading}
        sc={sc}
        onClose={() => setUploading(false)}
        onUploaded={(doc) => {
          setUploading(false);
          onReviewDocChange(doc.id);
        }}
      />
      <ReviewModal docId={reviewDocId} sc={sc} onClose={() => onReviewDocChange(null)} />
      <StudyModal topic={studying} sc={sc} onClose={() => setStudying(null)} />
      <ConfirmDialog
        open={unlinking}
        title="Disconnect this course?"
        message="This removes your uploaded documents, saved links and AI suggestions for this course. Your reviews and their history are kept."
        confirmLabel="Disconnect"
        busy={unlink.isPending}
        onClose={() => setUnlinking(false)}
        onConfirm={() => unlink.mutate(undefined, { onSuccess: () => (setUnlinking(false), toast('Course disconnected')) })}
      />
    </div>
  );
}

function TopicRow({ topic: t, today, onStudy }: { topic: ProfileTopic; today: LocalDate; onStudy: () => void }) {
  const p = t.personal;
  return (
    <li className="ktopic">
      <div className="body">
        <div className="row" style={{ gap: 8 }}>
          <span className="name">{t.name}</span>
          <EvidenceBadge status={t.status} />
        </div>
        {t.subtopics.length > 0 && <span className="subs">{t.subtopics.join(' · ')}</span>}
        {t.status === 'suggested' && t.description && <span className="subs">{t.description}</span>}
        <span className="meta">
          {t.week !== null && <span>Week {t.week}</span>}
          {t.scheduledOn && <span>{formatDate(t.scheduledOn, today)}</span>}
          <span>From: {t.evidence.map((e) => e.sourceTitle).join('; ')}</span>
        </span>
        {t.conflict && (
          <span className="conflict-note">
            <AlertTriangle size={13} aria-hidden /> {t.conflict}
          </span>
        )}
        {p && (
          <span className="meta">
            <StatusBadge status={p.status} />
            <span>{pluralize(p.reviewCount, 'review')}</span>
            {p.lastRating && (
              <span>
                Last: <RatingBadge rating={p.lastRating} />
              </span>
            )}
            <span>Next {formatDate(p.nextReviewOn, today)}</span>
          </span>
        )}
      </div>
      <div className="actions">
        {p ? (
          <Link to={`/topics/${p.recallTopicId}`} className="btn btn-ghost btn-sm" aria-label={`Open ${t.name} in your reviews`}>
            Open
          </Link>
        ) : (
          <button type="button" className="btn btn-secondary btn-sm" onClick={onStudy} aria-label={`Start studying ${t.name}`}>
            <Play size={14} aria-hidden /> Start studying
          </button>
        )}
      </div>
    </li>
  );
}

