import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, BookOpen, Building2, CalendarRange, ChevronRight, FileUp, GraduationCap, Plus, Search, Sparkles } from 'lucide-react';
import { termForDate, TERMS, type Term } from '@shared/knowledge';
import type { CatalogCourse, Department, DocumentInfo, StudentCourse, University } from '@shared/knowledgeApi';
import { errorMessage, fieldErrors } from '../api/client';
import {
  createCatalogCourse,
  createDepartment,
  createUniversity,
  listDepartments,
  searchCatalogCourses,
  searchUniversities,
  uploadDocument,
  useEnroll,
} from '../api/knowledge';
import { useToday } from '../auth/AuthContext';
import { Field, FormError } from '../components/Field';
import { Spinner } from '../components/States';

const STEPS = ['School', 'Department', 'Course', 'Semester', 'Syllabus'];

function useDebounced<T>(value: T, ms = 250): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** Runs a search whenever the (debounced) query changes, ignoring out-of-order responses. */
function useSearch<T>(query: string, fn: (q: string) => Promise<T[]>, enabled = true) {
  const q = useDebounced(query);
  const [state, setState] = useState<{ loading: boolean; results: T[]; error: unknown }>({ loading: false, results: [], error: null });
  const latest = useRef(0);
  useEffect(() => {
    if (!enabled) return;
    const id = ++latest.current;
    setState((s) => ({ ...s, loading: true }));
    fn(q)
      .then((results) => id === latest.current && setState({ loading: false, results, error: null }))
      .catch((error) => id === latest.current && setState({ loading: false, results: [], error }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, enabled]);
  return state;
}

export function ConnectCoursePage() {
  const navigate = useNavigate();
  const today = useToday();
  const [params] = useSearchParams();
  const [step, setStep] = useState(0);
  const [university, setUniversity] = useState<University | null>(null);
  const [department, setDepartment] = useState<Department | null>(null);
  const [course, setCourse] = useState<CatalogCourse | null>(null);
  const current = termForDate(today);
  const [term, setTerm] = useState<Term>(current.term);
  const [year, setYear] = useState(current.year);
  const [enrolled, setEnrolled] = useState<StudentCourse | null>(null);
  const [quickPicked, setQuickPicked] = useState(false);
  const enroll = useEnroll();
  const [error, setError] = useState<string | null>(null);

  const pickCourse = (c: CatalogCourse) => {
    setUniversity({ id: c.university.id, name: c.university.name, city: null, region: null, country: null, website: null, verified: true });
    setDepartment({ id: c.department.id, universityId: c.university.id, name: c.department.name, verified: true });
    setCourse(c);
    setQuickPicked(true);
    setStep(3);
  };

  async function confirmSemester() {
    if (!course) return;
    setError(null);
    try {
      setEnrolled(await enroll.mutateAsync({ catalogCourseId: course.id, term, year }));
      setStep(4);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <div className="page">
      <div className="wizard">
        <div className="page-header">
          <div className="titles">
            <nav className="breadcrumb" aria-label="Breadcrumb">
              <Link to="/courses">Courses</Link> <ChevronRight size={14} aria-hidden /> <span>Add from your school</span>
            </nav>
            <h1>Add a course from your school</h1>
            <p className="muted">Recall builds a profile of your course from your syllabus and other sources — and tells you how sure it is.</p>
          </div>
        </div>
        <ol className="steps" aria-label={`Step ${step + 1} of ${STEPS.length}: ${STEPS[step]}`}>
          {STEPS.map((s, i) => (
            <li key={s} className={i <= step ? 'done' : ''} aria-hidden />
          ))}
        </ol>

        {step === 0 && (
          <SchoolStep
            initialCode={params.get('code') ?? ''}
            onSchool={(u) => {
              setUniversity(u);
              setDepartment(null);
              setCourse(null);
              setStep(1);
            }}
            onCourse={pickCourse}
          />
        )}
        {step === 1 && university && (
          <DepartmentStep university={university} onBack={() => setStep(0)} onPick={(d) => (setDepartment(d), setStep(2))} />
        )}
        {step === 2 && university && department && (
          <CourseStep university={university} department={department} onBack={() => setStep(1)} onPick={(c) => (setCourse(c), setQuickPicked(false), setStep(3))} />
        )}
        {step === 3 && course && (
          <section className="card stack-lg" aria-labelledby="sem-title">
            <StepTitle icon={<CalendarRange size={20} />} id="sem-title" title="Which semester?" sub={`${course.code} — ${course.title} · ${course.university.name}`} />
            <div className="form-row">
              <Field label="Term">
                <select className="select" value={term} onChange={(e) => setTerm(e.target.value as Term)}>
                  {TERMS.map((t) => (
                    <option key={t} value={t}>
                      {t[0].toUpperCase() + t.slice(1)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Year">
                <input className="input" type="number" min={2000} max={2100} value={year} onChange={(e) => setYear(Number(e.target.value))} />
              </Field>
            </div>
            <FormError message={error} />
            <div className="form-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setStep(quickPicked ? 0 : 2)}>
                <ArrowLeft size={16} aria-hidden /> Back
              </button>
              <button type="button" className="btn btn-primary" onClick={() => void confirmSemester()} disabled={enroll.isPending || !year}>
                {enroll.isPending && <span className="spinner" aria-hidden />} Continue <ArrowRight size={16} aria-hidden />
              </button>
            </div>
          </section>
        )}
        {step === 4 && enrolled && (
          <SyllabusStep
            sc={enrolled}
            onDone={(doc) => navigate(`/courses/${enrolled.recallCourseId}?tab=knowledge${doc ? `&review=${doc.id}` : ''}`)}
          />
        )}
      </div>
    </div>
  );
}

function StepTitle({ icon, id, title, sub }: { icon: React.ReactNode; id: string; title: string; sub?: string }) {
  return (
    <div className="row" style={{ alignItems: 'flex-start', flexWrap: 'nowrap' }}>
      <span className="insight info" style={{ padding: 0, border: 0 }}>
        <span className="ic" aria-hidden>
          {icon}
        </span>
      </span>
      <div>
        <h2 id={id}>{title}</h2>
        {sub && <p className="subtle">{sub}</p>}
      </div>
    </div>
  );
}

function SchoolStep({ initialCode, onSchool, onCourse }: { initialCode: string; onSchool: (u: University) => void; onCourse: (c: CatalogCourse) => void }) {
  const [q, setQ] = useState('');
  const [code, setCode] = useState(initialCode);
  const unis = useSearch(q, searchUniversities);
  const courses = useSearch(code, (c) => searchCatalogCourses(c), code.trim().length >= 2);
  const [adding, setAdding] = useState(false);

  return (
    <>
      <section className="card stack-lg" aria-labelledby="school-title">
        <StepTitle icon={<Building2 size={20} />} id="school-title" title="Where do you study?" />
        <Field label="Search for your university or college">
          <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. Carleton" autoFocus />
        </Field>
        <div className="choice-list" aria-live="polite">
          {unis.loading && unis.results.length === 0 && <Spinner label="Searching" />}
          {unis.results.map((u) => (
            <button key={u.id} type="button" className="choice" onClick={() => onSchool(u)}>
              <GraduationCap size={20} aria-hidden />
              <span className="grow">
                <strong>{u.name}</strong>
                <span>{[u.city, u.region, u.country].filter(Boolean).join(', ') || 'Location not set'}</span>
              </span>
              {!u.verified && <span className="badge ev-unconfirmed">Added by a student</span>}
              <ChevronRight size={18} aria-hidden />
            </button>
          ))}
          {!unis.loading && unis.results.length === 0 && q.trim() && <p className="muted">No schools match “{q}”.</p>}
        </div>
        {!adding ? (
          <button type="button" className="btn btn-ghost btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => setAdding(true)}>
            <Plus size={15} aria-hidden /> Can't find it? Add your school
          </button>
        ) : (
          <AddUniversity initialName={q} onAdded={onSchool} onCancel={() => setAdding(false)} />
        )}
      </section>

      <section className="card stack" aria-labelledby="code-title">
        <h2 id="code-title" className="row">
          <Search size={18} aria-hidden /> Or find your course by code
        </h2>
        <Field label="Course code">
          <input className="input" value={code} onChange={(e) => setCode(e.target.value)} placeholder="e.g. COMP 1805" />
        </Field>
        <div className="choice-list" aria-live="polite">
          {courses.results.map((c) => (
            <button key={c.id} type="button" className="choice" onClick={() => onCourse(c)}>
              <BookOpen size={20} aria-hidden />
              <span className="grow">
                <strong>
                  {c.code} — {c.title}
                </strong>
                <span>
                  {c.university.name} · {c.department.name}
                </span>
              </span>
              <ChevronRight size={18} aria-hidden />
            </button>
          ))}
          {!courses.loading && code.trim().length >= 2 && courses.results.length === 0 && (
            <p className="muted">No courses match “{code}”. Choose your school above to add it.</p>
          )}
        </div>
      </section>
    </>
  );
}

function AddUniversity({ initialName, onAdded, onCancel }: { initialName: string; onAdded: (u: University) => void; onCancel: () => void }) {
  const [name, setName] = useState(initialName);
  const [city, setCity] = useState('');
  const [country, setCountry] = useState('');
  const [website, setWebsite] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onAdded(await createUniversity({ name, city, country, website }));
    } catch (err) {
      const f = fieldErrors(err);
      if (Object.keys(f).length) setErrors(f);
      else setError(errorMessage(err));
      setBusy(false);
    }
  }
  return (
    <form className="question-draft" onSubmit={submit} noValidate>
      <p className="subtle">Schools you add are marked “Added by a student” until verified.</p>
      <FormError message={error} />
      <Field label="School name" error={errors.name}>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={160} />
      </Field>
      <div className="form-row">
        <Field label="City" optional>
          <input className="input" value={city} onChange={(e) => setCity(e.target.value)} maxLength={80} />
        </Field>
        <Field label="Country" optional>
          <input className="input" value={country} onChange={(e) => setCountry(e.target.value)} maxLength={80} />
        </Field>
      </div>
      <Field label="Website" optional error={errors.website} hint="Used to recognise official pages, e.g. https://carleton.ca">
        <input className="input" value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://" />
      </Field>
      <div className="form-actions">
        <button type="button" className="btn btn-ghost" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="btn btn-primary" disabled={busy}>
          Add school
        </button>
      </div>
    </form>
  );
}

function DepartmentStep({ university, onBack, onPick }: { university: University; onBack: () => void; onPick: (d: Department) => void }) {
  const [departments, setDepartments] = useState<Department[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    listDepartments(university.id).then(setDepartments).catch(setError);
  }, [university.id]);
  async function add(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try {
      onPick(await createDepartment(university.id, name));
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }
  return (
    <section className="card stack-lg" aria-labelledby="dept-title">
      <StepTitle icon={<Building2 size={20} />} id="dept-title" title="What are you studying?" sub={university.name} />
      {departments === null && !error && <Spinner />}
      <FormError message={error ? errorMessage(error) : null} />
      <div className="choice-list">
        {departments?.map((d) => (
          <button key={d.id} type="button" className="choice" onClick={() => onPick(d)}>
            <span className="grow">
              <strong>{d.name}</strong>
            </span>
            {!d.verified && <span className="badge ev-unconfirmed">Added by a student</span>}
            <ChevronRight size={18} aria-hidden />
          </button>
        ))}
      </div>
      <form className="row" onSubmit={add} noValidate>
        <label className="visually-hidden" htmlFor="new-dept">
          Add a department
        </label>
        <input id="new-dept" className="input" style={{ flex: '1 1 220px' }} value={name} onChange={(e) => setName(e.target.value)} placeholder="Not listed? Type your department" />
        <button type="submit" className="btn btn-secondary" disabled={busy || !name.trim()}>
          <Plus size={16} aria-hidden /> Add
        </button>
      </form>
      <div>
        <button type="button" className="btn btn-ghost" onClick={onBack}>
          <ArrowLeft size={16} aria-hidden /> Back
        </button>
      </div>
    </section>
  );
}

function CourseStep({ university, department, onBack, onPick }: { university: University; department: Department; onBack: () => void; onPick: (c: CatalogCourse) => void }) {
  const [q, setQ] = useState('');
  const results = useSearch(q, (x) => searchCatalogCourses(x, university.id));
  const inDept = useMemo(() => results.results.filter((c) => c.department.id === department.id || q.trim()), [results.results, department.id, q]);
  const [code, setCode] = useState('');
  const [title, setTitle] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  async function add(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      onPick(await createCatalogCourse({ universityId: university.id, departmentId: department.id, code, title }));
    } catch (err) {
      setErrors({ ...fieldErrors(err), _: errorMessage(err) });
      setBusy(false);
    }
  }
  return (
    <section className="card stack-lg" aria-labelledby="course-title">
      <StepTitle icon={<BookOpen size={20} />} id="course-title" title="What course are you taking?" sub={`${university.name} · ${department.name}`} />
      <Field label="Search by course code or title">
        <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. COMP 1805" autoFocus />
      </Field>
      <div className="choice-list" aria-live="polite">
        {inDept.map((c) => (
          <button key={c.id} type="button" className="choice" onClick={() => onPick(c)}>
            <span className="grow">
              <strong>
                {c.code} — {c.title}
              </strong>
              <span>
                {c.department.name}
                {!c.verified && ' · added by a student'}
              </span>
            </span>
            <ChevronRight size={18} aria-hidden />
          </button>
        ))}
        {!results.loading && inDept.length === 0 && <p className="muted">No matching courses yet — add yours below.</p>}
      </div>
      <form className="question-draft" onSubmit={add} noValidate>
        <strong>Add a course</strong>
        <div className="form-row">
          <Field label="Course code" error={errors.code}>
            <input className="input" value={code} onChange={(e) => setCode(e.target.value)} placeholder="COMP 1805" maxLength={20} />
          </Field>
          <Field label="Course title" error={errors.title}>
            <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
          </Field>
        </div>
        {errors._ && !errors.code && !errors.title && <FormError message={errors._} />}
        <div className="form-actions">
          <button type="submit" className="btn btn-secondary" disabled={busy || !code.trim() || !title.trim()}>
            <Plus size={16} aria-hidden /> Add course
          </button>
        </div>
      </form>
      <div>
        <button type="button" className="btn btn-ghost" onClick={onBack}>
          <ArrowLeft size={16} aria-hidden /> Back
        </button>
      </div>
    </section>
  );
}

function SyllabusStep({ sc, onDone }: { sc: StudentCourse; onDone: (doc: DocumentInfo | null) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function upload() {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      onDone(await uploadDocument(sc.id, file, 'syllabus'));
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }
  return (
    <section className="card stack-lg" aria-labelledby="syl-title">
      <StepTitle icon={<FileUp size={20} />} id="syl-title" title="Do you have your syllabus?" sub={`${sc.course.code} · ${sc.version.label}`} />
      <p className="muted">
        Your current syllabus is the most reliable source for what your course covers. Recall reads it, shows you what it found, and only
        uses what you confirm. It stays private to you.
      </p>
      <Field label="Syllabus file" hint="PDF, Word (.docx) or text file, up to 10 MB. Images and scanned PDFs need the AI reader.">
        <input className="input" type="file" accept=".pdf,.docx,.txt,.md,image/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      </Field>
      <FormError message={error} />
      <div className="form-actions">
        <button type="button" className="btn btn-ghost" onClick={() => onDone(null)} disabled={busy}>
          Skip for now
        </button>
        <button type="button" className="btn btn-primary" onClick={() => void upload()} disabled={!file || busy}>
          {busy ? <span className="spinner" aria-hidden /> : <Sparkles size={16} aria-hidden />} Build my course profile
        </button>
      </div>
    </section>
  );
}
