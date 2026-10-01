import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle } from 'lucide-react';
import { diffDays, type LocalDate } from '@shared/dates';
import { STATUS_META } from '@shared/knowledge';
import type { ProfileTopic, StudentCourse } from '@shared/knowledgeApi';
import { errorMessage } from '../../api/client';
import { useFeatures } from '../../api/hooks';
import { studyTopic, useKnowledgeMutation } from '../../api/knowledge';
import { useToday } from '../../auth/AuthContext';
import { UNDERSTANDING_LABELS } from '../../lib/format';
import { Field, FormError } from '../Field';
import { Modal } from '../Modal';
import { useToast } from '../Toast';
import { EvidenceBadge } from './EvidenceBadge';

/** Adds a course topic to the student's reviews (the bridge into the spaced-repetition engine). */
export function StudyModal({ topic, sc, onClose }: { topic: ProfileTopic | null; sc: StudentCourse; onClose: () => void }) {
  const today = useToday();
  const navigate = useNavigate();
  const toast = useToast();
  const canGenerate = useFeatures().data?.questionGeneration ?? false;
  const [learnedOn, setLearnedOn] = useState<string>(today);
  const [understanding, setUnderstanding] = useState(3);
  const [generate, setGenerate] = useState(true);
  const [allow, setAllow] = useState(false);
  const unconfirmed = topic ? topic.status !== 'confirmed' && topic.status !== 'your_materials' : false;

  useEffect(() => {
    if (!topic) return;
    // Default "learned on" to the class date when it has passed.
    setLearnedOn(topic.scheduledOn && diffDays(topic.scheduledOn, today) <= 0 ? topic.scheduledOn : today);
    setAllow(false);
    setUnderstanding(3);
  }, [topic, today]);

  const study = useKnowledgeMutation(() =>
    studyTopic(sc.id, { topicKey: topic!.key, learnedOn, understanding, generateQuestions: generate && canGenerate, allowUnconfirmed: allow }),
  );

  return (
    <Modal open={topic !== null} title={topic ? `Start studying ${topic.name}` : 'Start studying'} onClose={onClose}>
      {topic && (
        <form
          className="stack-lg"
          onSubmit={(e) => {
            e.preventDefault();
            study.mutate(undefined, {
              onSuccess: (t) => {
                toast(`${t.title} added to your reviews`);
                onClose();
                navigate(`/topics/${t.id}`);
              },
            });
          }}
          noValidate
        >
          <div className="row">
            <EvidenceBadge status={topic.status} />
            <span className="subtle">{topic.evidence.map((e) => e.sourceTitle).join(' · ')}</span>
          </div>
          {topic.subtopics.length > 0 && <p className="muted">Covers: {topic.subtopics.join(', ')}</p>}
          {unconfirmed && (
            <div className="alert alert-warning">
              <AlertTriangle size={18} aria-hidden />
              <div className="alert-body">
                <p>
                  <strong>{STATUS_META[topic.status].label}:</strong> {STATUS_META[topic.status].explanation}
                </p>
                <label className="switch" style={{ marginTop: 8 }}>
                  <input type="checkbox" checked={allow} onChange={(e) => setAllow(e.target.checked)} />
                  Study it anyway as general practice
                </label>
              </div>
            </div>
          )}
          <div className="form-row">
            <Field label="When did you learn it?">
              <input className="input" type="date" value={learnedOn} max={today} onChange={(e) => setLearnedOn(e.target.value as LocalDate)} />
            </Field>
            <Field label="How well do you understand it?">
              <select className="select" value={understanding} onChange={(e) => setUnderstanding(Number(e.target.value))}>
                {UNDERSTANDING_LABELS.map((l, i) => (
                  <option key={l} value={i + 1}>
                    {i + 1} — {l}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          {canGenerate && (
            <label className="switch">
              <input type="checkbox" checked={generate} onChange={(e) => setGenerate(e.target.checked)} />
              Write recall questions from my course material
            </label>
          )}
          <FormError message={study.error ? errorMessage(study.error) : null} />
          <div className="form-actions">
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={study.isPending || (unconfirmed && !allow)}>
              {study.isPending && <span className="spinner" aria-hidden />} Add to my reviews
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
