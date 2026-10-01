import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { TopicDetail } from '@shared/api';
import type {
  CatalogCourse,
  ConfirmExtractionInput,
  CourseProfile,
  Department,
  Discovery,
  DocumentInfo,
  Recommendation,
  SourceSummary,
  StudentCourse,
  University,
} from '@shared/knowledgeApi';
import type { DocumentType, Term } from '@shared/knowledge';
import { api, ApiError } from './client';
import { invalidateStudy } from './hooks';

export const kkeys = {
  profile: (id: number) => ['knowledge-profile', id] as const,
  link: (courseId: number) => ['knowledge-link', courseId] as const,
  recs: (id?: number) => ['recommendations', id ?? 'all'] as const,
};

export const searchUniversities = (q: string) =>
  api.get<{ universities: University[] }>(`/catalog/universities?q=${encodeURIComponent(q)}`).then((r) => r.universities);
export const listDepartments = (universityId: number) =>
  api.get<{ departments: Department[] }>(`/catalog/universities/${universityId}/departments`).then((r) => r.departments);
export const searchCatalogCourses = (q: string, universityId?: number) =>
  api
    .get<{ courses: CatalogCourse[] }>(`/catalog/courses?q=${encodeURIComponent(q)}${universityId ? `&universityId=${universityId}` : ''}`)
    .then((r) => r.courses);
export const createUniversity = (input: { name: string; city?: string; country?: string; website?: string }) =>
  api.post<{ university: University }>('/catalog/universities', input).then((r) => r.university);
export const createDepartment = (universityId: number, name: string) =>
  api.post<{ department: Department }>(`/catalog/universities/${universityId}/departments`, { name }).then((r) => r.department);
export const createCatalogCourse = (input: { universityId: number; departmentId: number; code: string; title: string }) =>
  api.post<{ course: CatalogCourse }>('/catalog/courses', input).then((r) => r.course);

export function useEnroll() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { catalogCourseId: number; term: Term; year: number }) =>
      api.post<{ studentCourse: StudentCourse }>('/knowledge/student-courses', input).then((r) => r.studentCourse),
    onSuccess: () => void invalidateStudy(qc),
  });
}

export const useCourseLink = (recallCourseId: number) =>
  useQuery({
    queryKey: kkeys.link(recallCourseId),
    queryFn: () => api.get<{ studentCourse: StudentCourse | null }>(`/knowledge/student-courses/by-course/${recallCourseId}`).then((r) => r.studentCourse),
  });

export const useProfile = (studentCourseId: number | undefined) =>
  useQuery({
    queryKey: kkeys.profile(studentCourseId ?? 0),
    enabled: studentCourseId !== undefined,
    queryFn: () => api.get<CourseProfile>(`/knowledge/student-courses/${studentCourseId}/profile`),
    // Keep polling while a document is being analysed in the background.
    refetchInterval: (q) => (q.state.data?.documents.some((d) => d.status === 'processing') ? 2500 : false),
  });

export const useRecommendations = (studentCourseId?: number) =>
  useQuery({
    queryKey: kkeys.recs(studentCourseId),
    queryFn: () =>
      api
        .get<{ recommendations: Recommendation[] }>(studentCourseId ? `/knowledge/student-courses/${studentCourseId}/recommendations` : '/recommendations')
        .then((r) => r.recommendations),
  });

/** Upload raw file bytes (the API accepts application/octet-stream). */
export async function uploadDocument(studentCourseId: number, file: File, type: DocumentType): Promise<DocumentInfo> {
  let res: Response;
  try {
    res = await fetch(`/api/knowledge/student-courses/${studentCourseId}/documents?type=${type}`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/octet-stream', 'X-Filename': encodeURIComponent(file.name) },
      body: file,
    });
  } catch {
    throw new ApiError(0, 'network', "Can't reach Recall right now. Check your connection and try again.");
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, data?.error?.code ?? 'error', data?.error?.message ?? 'Upload failed. Please try again.', data?.error?.fields);
  return data.document as DocumentInfo;
}

export function useKnowledgeMutation<TVars, TResult>(fn: (vars: TVars) => Promise<TResult>) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: () => void invalidateStudy(qc) });
}

export const confirmDocument = (id: number, input: ConfirmExtractionInput) =>
  api.post<{ document: DocumentInfo }>(`/knowledge/documents/${id}/confirm`, input).then((r) => r.document);
export const deleteDocument = (id: number) => api.del(`/knowledge/documents/${id}`);
export const getDocument = (id: number) => api.get<{ document: DocumentInfo }>(`/knowledge/documents/${id}`).then((r) => r.document);
export const importUrl = (studentCourseId: number, url: string) =>
  api.post<{ document: DocumentInfo }>(`/knowledge/student-courses/${studentCourseId}/import-url`, { url }).then((r) => r.document);
export const discover = (studentCourseId: number, topic?: string) =>
  api.get<Discovery>(`/knowledge/student-courses/${studentCourseId}/discover${topic ? `?topic=${encodeURIComponent(topic)}` : ''}`);
export const saveResource = (studentCourseId: number, input: { url: string; title: string }) =>
  api.post<{ source: SourceSummary }>(`/knowledge/student-courses/${studentCourseId}/resources`, input).then((r) => r.source);
export const deleteSource = (id: number) => api.del(`/knowledge/sources/${id}`);
export const requestSuggestions = (studentCourseId: number) => api.post<{ added: number }>(`/knowledge/student-courses/${studentCourseId}/suggestions`);
export const studyTopic = (
  studentCourseId: number,
  input: { topicKey: string; learnedOn: string; understanding: number; generateQuestions: boolean; allowUnconfirmed: boolean },
) => api.post<{ topic: TopicDetail }>(`/knowledge/student-courses/${studentCourseId}/study`, input).then((r) => r.topic);
export const unlinkCourse = (studentCourseId: number) => api.del(`/knowledge/student-courses/${studentCourseId}`);

export type AssistantEvent =
  | { type: 'citations'; citations: { tag: string; title: string; url: string | null }[] }
  | { type: 'text'; text: string }
  | { type: 'done' }
  | { type: 'error'; message: string };

/** Stream an assistant answer (Server-Sent Events over a POST response). */
export async function streamAssistant(
  studentCourseId: number,
  messages: { role: 'user' | 'assistant'; content: string }[],
  onEvent: (e: AssistantEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`/api/knowledge/student-courses/${studentCourseId}/assistant`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages }),
      signal,
    });
  } catch (err) {
    if ((err as Error).name === 'AbortError') return;
    throw new ApiError(0, 'network', "Can't reach Recall right now. Check your connection and try again.");
  }
  if (!res.ok || !res.body) {
    const data = await res.json().catch(() => null);
    throw new ApiError(res.status, data?.error?.code ?? 'error', data?.error?.message ?? 'The assistant is unavailable right now.');
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buffer.indexOf('\n\n')) !== -1) {
      const raw = buffer.slice(0, idx).replace(/^data: /, '');
      buffer = buffer.slice(idx + 2);
      if (raw) onEvent(JSON.parse(raw) as AssistantEvent);
    }
  }
}
