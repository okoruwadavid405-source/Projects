import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { registerSchema } from '@shared/validation';
import { errorMessage, fieldErrors } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { BrandMark } from '../components/Brand';
import { Field, FormError } from '../components/Field';

function AuthLayout({ title, subtitle, children }: { title: string; subtitle: ReactNode; children: ReactNode }) {
  return (
    <div className="auth-page">
      <aside className="auth-aside" aria-hidden>
        <div className="brand" style={{ color: '#fff' }}>
          <BrandMark /> Recall
        </div>
        <div className="stack-lg">
          <h2>Stop forgetting what you already learned.</h2>
          <p style={{ opacity: 0.9, maxWidth: 420 }}>
            Recall schedules every topic for review right before you'd forget it — then adapts to how well you actually
            remember.
          </p>
          <div className="loop">
            {['Learn', 'Schedule', 'Recall', 'Rate', 'Adapt', 'Repeat'].map((s) => (
              <span key={s}>{s}</span>
            ))}
          </div>
        </div>
        <p style={{ opacity: 0.75, fontSize: '0.85rem' }}>Spaced repetition, built for students with real course loads.</p>
      </aside>
      <main className="auth-main" id="main">
        <div className="auth-card">
          <div className="brand" style={{ padding: 0 }}>
            <BrandMark /> Recall
          </div>
          <div className="stack" style={{ gap: 6 }}>
            <h1>{title}</h1>
            <p className="muted">{subtitle}</p>
          </div>
          {children}
        </div>
      </main>
    </div>
  );
}

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const from = (useLocation().state as { from?: string } | null)?.from ?? '/';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!email.trim() || !password) return setError('Enter your email and password.');
    setBusy(true);
    setError(null);
    try {
      await login(email, password);
      navigate(from, { replace: true });
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <AuthLayout
      title="Welcome back"
      subtitle={
        <>
          New to Recall? <Link to="/register">Create an account</Link>
        </>
      }
    >
      <form className="stack-lg" onSubmit={submit} noValidate>
        <FormError message={error} />
        <Field label="Email">
          <input className="input" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
        </Field>
        <Field label="Password">
          <input className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <button type="submit" className="btn btn-primary btn-lg btn-block" disabled={busy}>
          {busy && <span className="spinner" aria-hidden />} Log in
        </button>
      </form>
    </AuthLayout>
  );
}

export function RegisterPage() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    const parsed = registerSchema.safeParse({ name, email, password });
    if (!parsed.success) {
      const errs: Record<string, string> = {};
      for (const issue of parsed.error.issues) errs[String(issue.path[0])] ??= issue.message;
      return setErrors(errs);
    }
    setErrors({});
    setBusy(true);
    try {
      await register(name, email, password);
      navigate('/', { replace: true });
    } catch (err) {
      const f = fieldErrors(err);
      if (Object.keys(f).length) setErrors(f);
      else setFormError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <AuthLayout
      title="Create your account"
      subtitle={
        <>
          Already have one? <Link to="/login">Log in</Link>
        </>
      }
    >
      <form className="stack-lg" onSubmit={submit} noValidate>
        <FormError message={formError} />
        <Field label="Name" error={errors.name}>
          <input className="input" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} autoFocus maxLength={80} />
        </Field>
        <Field label="Email" error={errors.email}>
          <input className="input" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Password" error={errors.password} hint="At least 8 characters.">
          <input className="input" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <button type="submit" className="btn btn-primary btn-lg btn-block" disabled={busy}>
          {busy && <span className="spinner" aria-hidden />} Create account
        </button>
      </form>
    </AuthLayout>
  );
}
