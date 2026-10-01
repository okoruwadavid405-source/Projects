import { useRef, useState, type FormEvent } from 'react';
import { Bot, Send, Square } from 'lucide-react';
import type { StudentCourse } from '@shared/knowledgeApi';
import { errorMessage } from '../../api/client';
import { useFeatures } from '../../api/hooks';
import { streamAssistant, type AssistantEvent } from '../../api/knowledge';
import { FormError } from '../Field';
import { EmptyState } from '../States';

interface Turn {
  role: 'user' | 'assistant';
  content: string;
  citations?: { tag: string; title: string; url: string | null }[];
}

const STARTERS = ['What should I review today?', 'What did I struggle with last week?', 'Quiz me on sets', 'Explain functions like I’m new to discrete math'];

/** Course-aware assistant: answers are grounded in the course evidence and the student's own records. */
export function AssistantPanel({ sc }: { sc: StudentCourse }) {
  const features = useFeatures().data;
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  if (features && !features.assistant) {
    return (
      <div className="card">
        <EmptyState icon={<Bot size={26} />} title="The study assistant isn't set up">
          It needs an Anthropic API key on the server. Everything else — your course profile, recommendations and reviews — works without it.
        </EmptyState>
      </div>
    );
  }

  async function send(text: string) {
    const content = text.trim();
    if (!content || busy) return;
    setError(null);
    const history: Turn[] = [...turns, { role: 'user', content }];
    setTurns([...history, { role: 'assistant', content: '' }]);
    setInput('');
    setBusy(true);
    abort.current = new AbortController();
    const onEvent = (e: AssistantEvent) => {
      setTurns((ts) => {
        const copy = [...ts];
        const last = { ...copy[copy.length - 1] };
        if (e.type === 'text') last.content += e.text;
        if (e.type === 'citations') last.citations = e.citations;
        if (e.type === 'error') setError(e.message);
        copy[copy.length - 1] = last;
        return copy;
      });
    };
    try {
      await streamAssistant(sc.id, history.map(({ role, content: c }) => ({ role, content: c })).slice(-20), onEvent, abort.current.signal);
    } catch (err) {
      setError(errorMessage(err));
      setTurns((ts) => (ts[ts.length - 1]?.content ? ts : ts.slice(0, -1)));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card chat" aria-labelledby="ask-title">
      <div>
        <h2 id="ask-title" className="row">
          <Bot size={18} aria-hidden /> Ask about {sc.course.code}
        </h2>
        <p className="subtle">Answers use your course profile, your uploaded material and your review history — and say when Recall doesn't know.</p>
      </div>
      <div className="chat-log" aria-live="polite">
        {turns.length === 0 && (
          <div className="prompt-chips">
            {STARTERS.map((s) => (
              <button key={s} type="button" className="chip-link" onClick={() => void send(s)}>
                {s}
              </button>
            ))}
          </div>
        )}
        {turns.map((t, i) => {
          const used = t.citations?.filter((c) => t.content.includes(`[${c.tag}]`)) ?? [];
          return (
            <div key={i} className={`msg ${t.role}`}>
              {t.content || (busy && i === turns.length - 1 ? <span className="spinner" aria-label="Thinking" /> : '')}
              {used.length > 0 && (
                <div className="cites">
                  {used.map((c) =>
                    c.url ? (
                      <a key={c.tag} href={c.url} target="_blank" rel="noopener noreferrer">
                        [{c.tag}] {c.title}
                      </a>
                    ) : (
                      <span key={c.tag}>
                        [{c.tag}] {c.title}
                      </span>
                    ),
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <FormError message={error} />
      <form
        className="chat-input"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          void send(input);
        }}
      >
        <label htmlFor="ask-input" className="visually-hidden">
          Your question
        </label>
        <textarea
          id="ask-input"
          className="textarea"
          rows={2}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void send(input);
            }
          }}
          placeholder="Ask a question, or say “quiz me on…”"
          maxLength={8000}
        />
        {busy ? (
          <button type="button" className="btn btn-secondary" onClick={() => abort.current?.abort()} aria-label="Stop">
            <Square size={16} aria-hidden />
          </button>
        ) : (
          <button type="submit" className="btn btn-primary" disabled={!input.trim()} aria-label="Send">
            <Send size={16} aria-hidden />
          </button>
        )}
      </form>
    </section>
  );
}
