import { useState, type FormEvent } from 'react';
import { BookmarkPlus, ExternalLink, FileSearch, Globe, Link2, Search } from 'lucide-react';
import type { Discovery, DocumentInfo, StudentCourse } from '@shared/knowledgeApi';
import { errorMessage } from '../../api/client';
import { useFeatures } from '../../api/hooks';
import { discover, importUrl, saveResource, useKnowledgeMutation } from '../../api/knowledge';
import { Field, FormError } from '../Field';
import { useToast } from '../Toast';

/** Find public resources (ranked by rule), save links, or read a page's topics for review. */
export function ResourcesPanel({ sc, onImported }: { sc: StudentCourse; onImported: (doc: DocumentInfo) => void }) {
  const features = useFeatures().data;
  const toast = useToast();
  const [topic, setTopic] = useState('');
  const [found, setFound] = useState<Discovery | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const save = useKnowledgeMutation((v: { url: string; title: string }) => saveResource(sc.id, v));
  const read = useKnowledgeMutation((u: string) => importUrl(sc.id, u));

  async function search(e: FormEvent) {
    e.preventDefault();
    setSearching(true);
    setError(null);
    try {
      setFound(await discover(sc.id, topic || undefined));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSearching(false);
    }
  }

  return (
    <section className="card stack-lg" aria-labelledby="res-title">
      <h2 id="res-title" className="row">
        <Globe size={18} aria-hidden /> Find course resources
      </h2>
      {features?.webSearch ? (
        <form className="stack" onSubmit={search} noValidate>
          <Field label="Topic (optional)" hint={`Searches for “${sc.course.university.name} ${sc.course.code} …”. Official pages are ranked first; nothing is trusted automatically.`}>
            <input className="input" value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="e.g. mathematical induction — or leave blank for the course outline" />
          </Field>
          <div>
            <button type="submit" className="btn btn-secondary" disabled={searching}>
              {searching ? <span className="spinner" aria-hidden /> : <Search size={16} aria-hidden />} Search the web
            </button>
          </div>
        </form>
      ) : (
        <p className="muted">Web search isn't set up on this server. You can still save links and upload documents.</p>
      )}
      <FormError message={error} />
      {found && (
        <div className="stack">
          <p className="subtle">Results for {found.query}</p>
          {found.results.length === 0 && <p className="muted">No results found.</p>}
          <ul>
            {found.results.map((r) => (
              <li key={r.url} className="ktopic">
                <div className="body">
                  <a className="name" href={r.url} target="_blank" rel="noopener noreferrer">
                    {r.title} <ExternalLink size={13} aria-hidden style={{ display: 'inline' }} />
                  </a>
                  <div className="meta">
                    <span className={`badge ${r.origin === 'official' ? 'ev-confirmed' : r.origin === 'public' ? 'ev-your_materials' : 'ev-public'}`}>{r.tierLabel}</span>
                    <span>{new URL(r.url).hostname}</span>
                  </div>
                </div>
                <div className="actions">
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => save.mutate({ url: r.url, title: r.title }, { onSuccess: () => toast('Link saved'), onError: (e) => toast(errorMessage(e), 'error') })}>
                    <BookmarkPlus size={15} aria-hidden /> Save
                  </button>
                  {features?.documentAI && (
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      disabled={read.isPending}
                      onClick={() => read.mutate(r.url, { onSuccess: onImported, onError: (e) => toast(errorMessage(e), 'error') })}
                    >
                      <FileSearch size={15} aria-hidden /> Read topics
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
      <form
        className="question-draft"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate(
            { url, title: title || url },
            { onSuccess: () => (toast('Link saved'), setUrl(''), setTitle('')), onError: (err) => toast(errorMessage(err), 'error') },
          );
        }}
        noValidate
      >
        <strong className="row">
          <Link2 size={16} aria-hidden /> Add a link yourself
        </strong>
        <div className="form-row">
          <Field label="Web address">
            <input className="input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" />
          </Field>
          <Field label="Title" optional>
            <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={300} />
          </Field>
        </div>
        <div className="form-actions">
          <button type="submit" className="btn btn-secondary btn-sm" disabled={!url.trim() || save.isPending}>
            Save link
          </button>
        </div>
      </form>
    </section>
  );
}
