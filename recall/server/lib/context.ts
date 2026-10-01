import type { Database } from '../db/connection.js';
import type { KnowledgeProviders } from '../knowledge/providers.js';
import type { QuestionGenerator } from '../services/questionGenerator.js';

export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };

/** Dependencies shared by routes and services; injected so tests can swap the database and clock. */
export interface AppContext {
  db: Database;
  clock: Clock;
  secureCookies: boolean;
  /** Null when the server has no Anthropic credentials — question generation is then unavailable. */
  questionGenerator: QuestionGenerator | null;
  /** AI, web search and embedding adapters for the course knowledge system (each null when not configured). */
  knowledge: KnowledgeProviders;
}
