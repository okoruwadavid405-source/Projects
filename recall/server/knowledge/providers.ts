/**
 * Adapters for everything outside the app. Each is an interface so a provider
 * (AI, search, embeddings) can be swapped without touching the rest of the code.
 * A null provider means the capability is off, and the UI says so.
 */
import type { TermRef } from '../../shared/knowledge.js';
import type { DocumentType } from '../../shared/knowledge.js';
import type { Extraction } from '../../shared/knowledgeApi.js';

export type DocumentInput =
  | { kind: 'text'; filename: string; text: string }
  | { kind: 'file'; filename: string; mediaType: 'application/pdf' | 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp'; data: Buffer };

export interface ExtractionHints {
  university: string;
  courseCode: string;
  courseTitle: string;
  studentTerm: TermRef;
  documentType: DocumentType;
  /** Topic names already known for this course; the extractor should reuse them for the same concept. */
  knownTopicNames: string[];
}

export interface TopicSuggestionRequest {
  university: string;
  courseCode: string;
  courseTitle: string;
  termLabel: string;
  knownTopics: { name: string; statusLabel: string }[];
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

/** Language-model capabilities used by the course knowledge system. */
export interface AIProvider {
  extractCourseInfo(input: DocumentInput, hints: ExtractionHints): Promise<Extraction>;
  suggestTopics(request: TopicSuggestionRequest): Promise<{ name: string; reason: string }[]>;
  streamAnswer(request: { system: string; messages: ChatMessage[] }): AsyncIterable<string>;
}

export interface RawWebResult {
  title: string;
  url: string;
  pageAge: string | null;
}

export interface FetchedPage {
  url: string;
  title: string | null;
  /** Plain text of the page, or null when the page is a PDF (see `pdf`). */
  text: string | null;
  pdf: Buffer | null;
}

export interface WebSearchProvider {
  search(query: string): Promise<RawWebResult[]>;
  fetchPage(url: string): Promise<FetchedPage>;
}

/**
 * Extension point for semantic retrieval. No implementation ships with Recall
 * (Anthropic has no embeddings endpoint); retrieval uses SQLite full-text search
 * (BM25) until one is configured.
 */
export interface EmbeddingProvider {
  embed(texts: string[]): Promise<number[][]>;
}

export interface KnowledgeProviders {
  ai: AIProvider | null;
  web: WebSearchProvider | null;
  embeddings: EmbeddingProvider | null;
}

export const NO_PROVIDERS: KnowledgeProviders = { ai: null, web: null, embeddings: null };

/** A failure whose message is safe to show the student. */
export class ProviderError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
  }
}
