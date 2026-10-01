import { useEffect, useState } from 'react';
import { AlertTriangle, Bot, Plus, ScanSearch, Trash2 } from 'lucide-react';
import { termLabel, TERMS, UPLOAD_TYPES, type DocumentType, type Term } from '@shared/knowledge';
import type { DocumentInfo, StudentCourse } from '@shared/knowledgeApi';
import { errorMessage } from '../../api/client';
import { confirmDocument, deleteDocument, getDocument, uploadDocument, useKnowledgeMutation } from '../../api/knowledge';
import { useFeatures } from '../../api/hooks';
import { Field, FormError } from '../Field';
import { Modal } from '../Modal';
import { Spinner } from '../States';
import { useToast } from '../Toast';

export function UploadModal({ open, sc, onClose, onUploaded }: { open: boolean; sc: StudentCourse; onClose: () => void; onUploaded: (doc: DocumentInfo) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [type, setType] = useState<DocumentType>('syllabus');
  const [error, setError] = useState<string | null>(null);
  const features = useFeatures().data;
  const upload = useKnowledgeMutation(() => uploadDocument(sc.id, file!, type));
  useEffect(() => {
    if (open) {
      setFile(null);
      setError(null);
    }
  }, [open]);
  return (
    <Modal open={open} title="Upload course material" onClose={onClose}>
      <form
        className="stack-lg"
        onSubmit={(e) => {
          e.preventDefault();
          if (!file) return setError('Choose a file to upload.');
          upload.mutate(undefined, { onSuccess: (doc) => onUploaded(doc), onError: (err) => setError(errorMessage(err)) });
        }}
        noValidate
      >
        <p className="muted">
          Your files stay private to you. Recall reads them, shows you what it found, and uses only what you confirm. Your notes are also used to
          answer your questions and write better review questions.
        </p>
        <Field label="What is it?">
          <select className="select" value={type} onChange={(e) => setType(e.target.value as DocumentType)}>
            {UPLOAD_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </Field>
        <Field
          label="File"
          hint={`PDF, Word (.docx) or text, up to 10 MB.${features?.documentAI ? ' Images and scanned PDFs are read with AI.' : ' Images and scanned PDFs need the AI reader, which isn’t set up.'}`}
        >
          <input className="input" type="file" accept=".pdf,.docx,.txt,.md,image/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </Field>
        <FormError message={error} />
        <div className="form-actions">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={upload.isPending}>
            {upload.isPending && <span className="spinner" aria-hidden />} Upload
          </button>
        </div>
      </form>
    </Modal>
  );
}

interface DraftTopic {
  include: boolean;
  name: string;
  subtopics: string;
  week: number | null;
  date: string | null;
  description: string | null;
}

/** Step 9–10 of the syllabus flow: show what was extracted and save only what the student approves. */
export function ReviewModal({ docId, sc, onClose }: { docId: number | null; sc: StudentCourse; onClose: () => void }) {
  const [doc, setDoc] = useState<DocumentInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [topics, setTopics] = useState<DraftTopic[]>([]);
  const [term, setTerm] = useState<Term | ''>('');
  const [year, setYear] = useState<number | ''>('');
  const [instructor, setInstructor] = useState('');
  const [includeAssessments, setIncludeAssessments] = useState(true);
  const toast = useToast();

  useEffect(() => {
    if (docId === null) return;
    setDoc(null);
    setError(null);
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const load = () =>
      getDocument(docId)
        .then((d) => {
          if (cancelled) return;
          setDoc(d);
          if (d.status === 'processing') timer = setTimeout(load, 2000);
          else if (d.extraction) {
            const x = d.extraction;
            setTopics(x.topics.map((t) => ({ include: true, name: t.name, subtopics: t.subtopics.join(', '), week: t.week, date: t.date, description: t.description })));
            setTerm(x.term ?? (d.documentType === 'syllabus' ? sc.version.term : ''));
            setYear(x.year ?? (d.documentType === 'syllabus' ? sc.version.year : ''));
            setInstructor(x.instructor ?? '');
          }
        })
        .catch((err) => !cancelled && setError(errorMessage(err)));
    load();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [docId, sc.version.term, sc.version.year]);

  const confirm = useKnowledgeMutation(() =>
    confirmDocument(doc!.id, {
      term: term || null,
      year: year === '' ? null : year,
      instructor: instructor || null,
      topics: topics
        .filter((t) => t.include && t.name.trim())
        .map((t) => ({ name: t.name, description: t.description, week: t.week, date: t.date, subtopics: t.subtopics.split(',').map((s) => s.trim()).filter(Boolean) })),
      assessments: includeAssessments ? (doc!.extraction?.assessments ?? []) : [],
    }),
  );
  const discard = useKnowledgeMutation(() => deleteDocument(doc!.id));
  const update = (i: number, patch: Partial<DraftTopic>) => setTopics((ts) => ts.map((t, j) => (i === j ? { ...t, ...patch } : t)));
  const isCurrent = term === sc.version.term && year === sc.version.year;
  const x = doc?.extraction;

  return (
    <Modal open={docId !== null} title="Review what Recall found" onClose={onClose}>
      {!doc && !error && <Spinner label="Loading" />}
      <FormError message={error} />
      {doc?.status === 'processing' && (
        <div className="generating-note" role="status">
          <span className="spinner" aria-hidden /> Reading {doc.filename}… this can take a minute.
        </div>
      )}
      {doc?.status === 'failed' && <FormError message={doc.error ?? 'This document could not be read.'} />}
      {doc?.status === 'confirmed' && <p className="muted">This document has already been saved.</p>}
      {doc?.status === 'needs_review' && x && (
        <div className="stack-lg">
          <div className="alert alert-info">
            {doc.extractor === 'ai' ? <Bot size={18} aria-hidden /> : <ScanSearch size={18} aria-hidden />}
            <div className="alert-body">
              <p>
                <strong>{doc.filename}</strong> — read by {doc.extractor === 'ai' ? 'AI' : 'pattern matching'}. Nothing is saved until you confirm.
                Untick anything that's wrong.
              </p>
              {doc.error && <p>{doc.error}</p>}
            </div>
          </div>
          {doc.warnings.map((w) => (
            <div key={w} className="alert alert-warning" role="alert">
              <AlertTriangle size={18} aria-hidden />
              <div className="alert-body">{w}</div>
            </div>
          ))}
          <dl className="kv">
            <div>
              <dt>Course in document</dt>
              <dd>{[x.courseCode, x.courseTitle].filter(Boolean).join(' — ') || 'Not stated'}</dd>
            </div>
            <div>
              <dt>Learning objectives</dt>
              <dd>{x.learningObjectives.length}</dd>
            </div>
            <div>
              <dt>Assessments</dt>
              <dd>{x.assessments.length}</dd>
            </div>
          </dl>
          <div className="form-row">
            <Field label="Term this document describes" hint={term && year ? (isCurrent ? 'Your current term — topics will be marked Confirmed.' : `Saved as ${termLabel({ term: term as Term, year: Number(year) })} material — shown as Past versions.`) : 'Leave blank if the document has no term (e.g. general notes).'}>
              <select className="select" value={term} onChange={(e) => setTerm(e.target.value as Term | '')}>
                <option value="">Not stated</option>
                {TERMS.map((t) => (
                  <option key={t} value={t}>
                    {t[0].toUpperCase() + t.slice(1)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Year">
              <input className="input" type="number" value={year} onChange={(e) => setYear(e.target.value ? Number(e.target.value) : '')} />
            </Field>
          </div>
          <Field label="Instructor" optional>
            <input className="input" value={instructor} onChange={(e) => setInstructor(e.target.value)} maxLength={160} />
          </Field>
          <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
            <legend style={{ fontWeight: 650, marginBottom: 6 }}>Topics ({topics.filter((t) => t.include).length} selected)</legend>
            {topics.length === 0 && <p className="muted">No topics were found. Add them yourself, or save the document so it can be searched.</p>}
            {topics.map((t, i) => (
              <div key={i} className="extract-row">
                <input type="checkbox" checked={t.include} onChange={(e) => update(i, { include: e.target.checked })} aria-label={`Include ${t.name}`} />
                <div className="stack" style={{ gap: 6 }}>
                  <div className="row" style={{ flexWrap: 'nowrap' }}>
                    <input className="input" value={t.name} onChange={(e) => update(i, { name: e.target.value })} aria-label="Topic name" maxLength={200} />
                    {t.week !== null && <span className="badge nowrap">Week {t.week}</span>}
                    {t.date && <span className="badge nowrap">{t.date}</span>}
                  </div>
                  <input className="input" value={t.subtopics} onChange={(e) => update(i, { subtopics: e.target.value })} placeholder="Subtopics, separated by commas" aria-label={`Subtopics of ${t.name}`} />
                </div>
              </div>
            ))}
            <button type="button" className="btn btn-ghost btn-sm" style={{ marginTop: 8 }} onClick={() => setTopics((ts) => [...ts, { include: true, name: '', subtopics: '', week: null, date: null, description: null }])}>
              <Plus size={15} aria-hidden /> Add a topic
            </button>
          </fieldset>
          {x.assessments.length > 0 && (
            <label className="switch">
              <input type="checkbox" checked={includeAssessments} onChange={(e) => setIncludeAssessments(e.target.checked)} />
              Save assessments: {x.assessments.map((a) => `${a.name}${a.date ? ` (${a.date})` : ''}`).join(', ')}
            </label>
          )}
          <FormError message={confirm.error ? errorMessage(confirm.error) : null} />
          <div className="form-actions">
            <button
              type="button"
              className="btn btn-danger-ghost"
              onClick={() => discard.mutate(undefined, { onSuccess: () => (toast('Document discarded'), onClose()) })}
              disabled={discard.isPending}
            >
              <Trash2 size={16} aria-hidden /> Discard
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={confirm.isPending}
              onClick={() => confirm.mutate(undefined, { onSuccess: () => (toast('Saved to your course profile'), onClose()) })}
            >
              {confirm.isPending && <span className="spinner" aria-hidden />} Confirm and save
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
