import { useState } from 'react';
import { ChevronDown, ChevronUp, Wand2 } from 'lucide-react';
import type { QuestionDraft } from '@shared/api';
import { errorMessage } from '../api/client';
import { useDraftQuestions, useFeatures } from '../api/hooks';
import { Field, FormError } from './Field';

interface Props {
  courseId: number | '';
  title: string;
  description: string;
  topicId?: number;
  label?: string;
  onDrafts: (drafts: QuestionDraft[]) => void;
}

/**
 * "Generate questions" control. Renders nothing when the server can't generate,
 * so the student never sees a button that can't work.
 */
export function GenerateQuestions({ courseId, title, description, topicId, label = 'Generate questions', onDrafts }: Props) {
  const features = useFeatures();
  const draft = useDraftQuestions();
  const [notes, setNotes] = useState('');
  const [showNotes, setShowNotes] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!features.data?.questionGeneration) return null;

  const missing = courseId === '' ? 'Choose a course first.' : !title.trim() ? 'Enter the topic first.' : null;

  function generate() {
    if (missing) return setError(missing);
    setError(null);
    draft.mutate(
      { courseId: courseId as number, title, description, notes, topicId, count: 5 },
      { onSuccess: onDrafts, onError: (err) => setError(errorMessage(err)) },
    );
  }

  return (
    <div className="generate-box">
      <div className="spread" style={{ flexWrap: 'wrap' }}>
        <p className="subtle" style={{ flex: '1 1 260px' }}>
          Recall can write questions that make you explain, apply and compare — not just repeat. Check them before you save.
        </p>
        <button type="button" className="btn btn-secondary" onClick={generate} disabled={draft.isPending}>
          {draft.isPending ? <span className="spinner" aria-hidden /> : <Wand2 size={16} aria-hidden />}
          {draft.isPending ? 'Writing questions…' : label}
        </button>
      </div>
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowNotes((v) => !v)} aria-expanded={showNotes}>
        {showNotes ? <ChevronUp size={15} aria-hidden /> : <ChevronDown size={15} aria-hidden />} Add notes for better questions
      </button>
      {showNotes && (
        <Field label="Your notes" optional hint="Paste lecture notes or a textbook excerpt. Used only to write questions — not saved.">
          <textarea className="textarea" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={8000} />
        </Field>
      )}
      <FormError message={error} />
      <span className="visually-hidden" role="status">
        {draft.isPending ? 'Writing questions' : ''}
      </span>
    </div>
  );
}
