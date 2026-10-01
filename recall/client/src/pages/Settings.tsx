import { useMemo, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, BellOff, Database, Globe, LogOut, Trash2, User as UserIcon } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { api, errorMessage, fieldErrors } from '../api/client';
import { keys, useDashboard, useLoadDemo, useRemoveDemo, useUpdateSettings, fetchReminderDigest } from '../api/hooks';
import { useAuth, useUser } from '../auth/AuthContext';
import { Field, FormError } from '../components/Field';
import { ConfirmDialog } from '../components/Modal';
import { useToast } from '../components/Toast';
import { browserTimeZone } from '../lib/format';
import { notificationSupport, requestNotificationPermission, showNotification, type ReminderSupport } from '../lib/reminders';

export function SettingsPage() {
  return (
    <div className="page page-narrow">
      <div className="page-header">
        <div className="titles">
          <h1>Settings</h1>
        </div>
      </div>
      <ProfileSettings />
      <ReminderSettings />
      <DemoSettings />
      <AccountSettings />
    </div>
  );
}

function timeZones(current: string): string[] {
  let zones: string[] = [];
  try {
    zones = Intl.supportedValuesOf('timeZone');
  } catch {
    zones = [];
  }
  return [...new Set([current, browserTimeZone(), 'UTC', ...zones])].sort();
}

function ProfileSettings() {
  const user = useUser();
  const update = useUpdateSettings();
  const toast = useToast();
  const [name, setName] = useState(user.name);
  const [timezone, setTimezone] = useState(user.timezone);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const zones = useMemo(() => timeZones(user.timezone), [user.timezone]);
  const detected = browserTimeZone();

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setErrors({ name: 'Name is required.' });
    setErrors({});
    setFormError(null);
    try {
      await update.mutateAsync({ name, timezone });
      toast('Profile saved');
    } catch (err) {
      const f = fieldErrors(err);
      if (Object.keys(f).length) setErrors(f);
      else setFormError(errorMessage(err));
    }
  }

  return (
    <section className="card" aria-labelledby="profile-title">
      <h2 id="profile-title" className="row" style={{ marginBottom: 16 }}>
        <UserIcon size={18} aria-hidden /> Profile
      </h2>
      <form className="stack-lg" onSubmit={submit} noValidate>
        <FormError message={formError} />
        <div className="form-row">
          <Field label="Name" error={errors.name}>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} autoComplete="name" />
          </Field>
          <Field label="Email" hint="Your email can't be changed yet.">
            <input className="input" value={user.email} readOnly />
          </Field>
        </div>
        <Field
          label="Time zone"
          error={errors.timezone}
          hint={
            <span className="row" style={{ gap: 6 }}>
              <Globe size={13} aria-hidden /> Reviews are due at midnight in this time zone.
              {timezone !== detected && (
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setTimezone(detected)}>
                  Use this device's ({detected})
                </button>
              )}
            </span>
          }
        >
          <select className="select" value={timezone} onChange={(e) => setTimezone(e.target.value)}>
            {zones.map((z) => (
              <option key={z} value={z}>
                {z.replaceAll('_', ' ')}
              </option>
            ))}
          </select>
        </Field>
        <div className="form-actions">
          <button type="submit" className="btn btn-primary" disabled={update.isPending}>
            {update.isPending && <span className="spinner" aria-hidden />} Save profile
          </button>
        </div>
      </form>
    </section>
  );
}

function ReminderSettings() {
  const user = useUser();
  const update = useUpdateSettings();
  const toast = useToast();
  const [permission, setPermission] = useState<ReminderSupport>(notificationSupport());
  const [time, setTime] = useState(user.reminderTime);

  async function toggle(enabled: boolean) {
    if (enabled && permission === 'default') setPermission(await requestNotificationPermission());
    update.mutate(
      { reminderEnabled: enabled },
      { onSuccess: () => toast(enabled ? 'Daily reminder on' : 'Daily reminder off'), onError: (err) => toast(errorMessage(err), 'error') },
    );
  }

  async function saveTime() {
    if (time === user.reminderTime || !/^\d{2}:\d{2}$/.test(time)) return;
    update.mutate({ reminderTime: time }, { onSuccess: () => toast('Reminder time saved'), onError: (err) => toast(errorMessage(err), 'error') });
  }

  async function test() {
    let p = permission;
    if (p === 'default') {
      p = await requestNotificationPermission();
      setPermission(p);
    }
    if (p !== 'granted') return;
    try {
      const digest = await fetchReminderDigest();
      showNotification('Recall reminder (test)', digest.message);
    } catch (err) {
      toast(errorMessage(err), 'error');
    }
  }

  return (
    <section className="card stack-lg" aria-labelledby="reminders-title">
      <h2 id="reminders-title" className="row">
        <Bell size={18} aria-hidden /> Daily reminder
      </h2>
      <label className="switch">
        <input type="checkbox" checked={user.reminderEnabled} onChange={(e) => void toggle(e.target.checked)} disabled={update.isPending} />
        Remind me when I have reviews due
      </label>
      <div className="form-row" style={{ alignItems: 'end' }}>
        <Field label="Reminder time" hint={`In your time zone (${user.timezone.replaceAll('_', ' ')}).`}>
          <input className="input" type="time" value={time} onChange={(e) => setTime(e.target.value)} onBlur={() => void saveTime()} disabled={!user.reminderEnabled} />
        </Field>
        <div>
          <button type="button" className="btn btn-secondary" onClick={() => void test()} disabled={permission === 'unsupported' || permission === 'denied'}>
            Send a test notification
          </button>
        </div>
      </div>

      {permission === 'unsupported' && (
        <div className="alert alert-warning">
          <BellOff size={18} aria-hidden />
          <div className="alert-body">This browser doesn't support notifications. The Today screen will still show what's due.</div>
        </div>
      )}
      {permission === 'denied' && (
        <div className="alert alert-warning">
          <BellOff size={18} aria-hidden />
          <div className="alert-body">Notifications are blocked for this site. Allow them in your browser's site settings to get reminders.</div>
        </div>
      )}
      <div className="alert">
        <Bell size={18} aria-hidden />
        <div className="alert-body">
          <p>
            <strong>How reminders work:</strong> your browser shows the reminder while Recall is open in a tab (it can be in the
            background). Reminders when the browser is closed need push notifications, which this deployment doesn't have
            set up yet.
          </p>
        </div>
      </div>
    </section>
  );
}

function DemoSettings() {
  const dashboard = useDashboard();
  const load = useLoadDemo();
  const remove = useRemoveDemo();
  const toast = useToast();
  const hasDemo = dashboard.data?.hasDemoData ?? false;
  return (
    <section className="card stack" aria-labelledby="demo-title">
      <h2 id="demo-title" className="row">
        <Database size={18} aria-hidden /> Demo data
      </h2>
      <p className="muted">
        Sample courses (COMP 1805, COMP 1406, STAT 2507) with topics, questions and a short review history, so you can try every
        screen. Demo courses are labelled "Demo" and can be removed at any time without touching your own data.
      </p>
      <div className="row">
        {hasDemo ? (
          <button
            type="button"
            className="btn btn-secondary"
            disabled={remove.isPending}
            onClick={() =>
              remove.mutate(undefined, { onSuccess: () => toast('Demo data removed'), onError: (err) => toast(errorMessage(err), 'error') })
            }
          >
            {remove.isPending && <span className="spinner" aria-hidden />} Remove demo data
          </button>
        ) : (
          <button
            type="button"
            className="btn btn-secondary"
            disabled={load.isPending || dashboard.isPending}
            onClick={() =>
              load.mutate(undefined, { onSuccess: () => toast('Demo data loaded'), onError: (err) => toast(errorMessage(err), 'error') })
            }
          >
            {load.isPending && <span className="spinner" aria-hidden />} Load demo data
          </button>
        )}
      </div>
    </section>
  );
}

function AccountSettings() {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  async function deleteAccount() {
    setBusy(true);
    try {
      await api.del('/account');
      qc.removeQueries({ predicate: (q) => q.queryKey[0] !== keys.me[0] });
      qc.setQueryData(keys.me, null);
      navigate('/register', { replace: true });
    } catch (err) {
      toast(errorMessage(err), 'error');
      setBusy(false);
      setConfirming(false);
    }
  }

  return (
    <section className="card stack" aria-labelledby="account-title">
      <h2 id="account-title">Account</h2>
      <div className="row">
        <button type="button" className="btn btn-secondary" onClick={() => void logout()}>
          <LogOut size={16} aria-hidden /> Log out
        </button>
        <button type="button" className="btn btn-danger-ghost" onClick={() => setConfirming(true)}>
          <Trash2 size={16} aria-hidden /> Delete account
        </button>
      </div>
      <ConfirmDialog
        open={confirming}
        title="Delete your account?"
        message="This permanently deletes your account, courses, topics, questions and review history. This can't be undone."
        confirmLabel="Delete everything"
        busy={busy}
        onClose={() => setConfirming(false)}
        onConfirm={() => void deleteAccount()}
      />
    </section>
  );
}
