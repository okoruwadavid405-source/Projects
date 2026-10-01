import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApp } from '../server/app.js';
import { openDatabase } from '../server/db/connection.js';
import type { AppContext } from '../server/lib/context.js';
import type { QuestionGenerator } from '../server/services/questionGenerator.js';

export interface TestServer {
  ctx: AppContext;
  url: string;
  setNow(iso: string): void;
  close(): Promise<void>;
}

export async function startServer(nowIso = '2026-10-01T15:00:00Z', questionGenerator: QuestionGenerator | null = null): Promise<TestServer> {
  let now = new Date(nowIso);
  const ctx: AppContext = { db: openDatabase(':memory:'), clock: { now: () => now }, secureCookies: false, questionGenerator };
  const server: Server = await new Promise((resolve) => {
    const s = createApp(ctx).listen(0, () => resolve(s));
  });
  const { port } = server.address() as AddressInfo;
  return {
    ctx,
    url: `http://127.0.0.1:${port}`,
    setNow: (iso) => (now = new Date(iso)),
    close: () => new Promise((resolve) => server.close(() => (ctx.db.close(), resolve()))),
  };
}

/** A minimal cookie-keeping API client, one per simulated user. */
export class Client {
  cookie = '';
  constructor(private readonly base: string) {}

  async request(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
    const res = await fetch(`${this.base}/api${path}`, {
      method,
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(this.cookie ? { Cookie: this.cookie } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) {
      const pair = setCookie.split(';')[0];
      this.cookie = pair.endsWith('=') ? '' : pair;
    }
    const text = await res.text();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const json: any = text ? JSON.parse(text) : undefined;
    return { status: res.status, body: json, headers: res.headers };
  }

  get = (p: string) => this.request('GET', p);
  post = (p: string, b?: unknown) => this.request('POST', p, b ?? {});
  put = (p: string, b: unknown) => this.request('PUT', p, b);
  patch = (p: string, b: unknown) => this.request('PATCH', p, b);
  del = (p: string) => this.request('DELETE', p);

  async register(name: string, email: string, timezone = 'America/Toronto') {
    const res = await this.post('/auth/register', { name, email, password: 'correct horse battery', timezone });
    if (res.status !== 201) throw new Error(`register failed: ${JSON.stringify(res.body)}`);
    return res.body.user;
  }
}
