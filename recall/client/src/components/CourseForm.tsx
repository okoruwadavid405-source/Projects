import { useState, type FormEvent } from 'react';
import { Check } from 'lucide-react';
import type { Course } from '@shared/api';
import { COURSE_COLORS, courseInputSchema, type CourseColor } from '@shared/validation';
import { errorMessage, fieldErrors } from '../api/client';
import { useCreateCourse, useUpdateCourse } from '../api/hooks';
import { Field, FormError } from './Field';
import { Modal } from './Modal';
import { useToast } from './Toast';

interface Props {
  open: boolean;
  course?: Course;
  onClose: () => void;
  onSaved?: (course: Course) => void;
}

export function CourseFormModal({ open, course, onClose, onSaved }: Props) {
  return (
    <Modal open={open} title={course ? 'Edit course' : 'New course'} onClose={onClose}>
      {/* Remount on open so the form always starts from the course's current values. */}
      {open && <CourseForm course={course} onDone={onClose} onSaved={onSaved} />}
    </Modal>
  );
}

function CourseForm({ course, onDone, onSaved }: { course?: Course; onDone: () => void; onSaved?: (c: Course) => void }) {
  const [code, setCode] = useState(course?.code ?? '');
  const [name, setName] = useState(course?.name ?? '');
  const [professor, setProfessor] = useState(course?.professor ?? '');
  const [color, setColor] = useState<CourseColor>(course?.color ?? 'indigo');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const create = useCreateCourse();
  const update = useUpdateCourse();
  const toast = useToast();
  const busy = create.isPending || update.isPending;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    const input = { code, name, professor, color };
    const parsed = courseInputSchema.safeParse(input);
    if (!parsed.success) {
      const errs: Record<string, string> = {};
      for (const issue of parsed.error.issues) errs[String(issue.path[0])] ??= issue.message;
      setErrors(errs);
      return;
    }
    setErrors({});
    try {
      const saved = course ? await update.mutateAsync({ id: course.id, ...input }) : await create.mutateAsync(input);
      toast(course ? 'Course updated' : `${saved.code} added`);
      onSaved?.(saved);
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
      <div className="form-row">
        <Field label="Course code" error={errors.code} hint="e.g. COMP 1805">
          <input className="input" value={code} onChange={(e) => setCode(e.target.value)} maxLength={20} autoFocus autoComplete="off" />
        </Field>
        <Field label="Professor" optional error={errors.professor}>
          <input className="input" value={professor} onChange={(e) => setProfessor(e.target.value)} maxLength={80} autoComplete="off" />
        </Field>
      </div>
      <Field label="Course name" error={errors.name} hint="e.g. Discrete Mathematics">
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} autoComplete="off" />
      </Field>
      <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="field" style={{ fontWeight: 600, fontSize: '0.9rem', marginBottom: 8 }}>
          Colour
        </legend>
        <div className="color-picker">
          {COURSE_COLORS.map((c) => (
            <label key={c} className={`c-${c}`} title={c}>
              <input type="radio" name="color" value={c} checked={color === c} onChange={() => setColor(c)} aria-label={c} />
              {color === c && <Check size={16} aria-hidden />}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="form-actions">
        <button type="button" className="btn btn-secondary" onClick={onDone} disabled={busy}>
          Cancel
        </button>
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy && <span className="spinner" aria-hidden />}
          {course ? 'Save changes' : 'Create course'}
        </button>
      </div>
    </form>
  );
}
