import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type {
  Course,
  Dashboard,
  Progress,
  Question,
  ReminderDigest,
  ReviewResult,
  ReviewSession,
  TopicDetail,
  TopicSummary,
  Upcoming,
  User,
} from '@shared/api';
import type { CourseInput, QuestionInput, ReviewSubmitInput, SettingsInput, TopicCreateInput, TopicUpdateInput } from '@shared/validation';
import { api } from './client';

export const keys = {
  me: ['me'] as const,
  dashboard: ['dashboard'] as const,
  courses: ['courses'] as const,
  course: (id: number) => ['course', id] as const,
  topics: ['topics'] as const,
  topic: (id: number) => ['topic', id] as const,
  queue: ['queue'] as const,
  upcoming: (days: number) => ['upcoming', days] as const,
  progress: ['progress'] as const,
};

/** Study data is small and interrelated, so any change simply refreshes everything except the session. */
export function invalidateStudy(qc: QueryClient) {
  return qc.invalidateQueries({ predicate: (q) => q.queryKey[0] !== 'me' });
}

function useStudyMutation<TVars, TResult>(fn: (vars: TVars) => Promise<TResult>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    // Not awaited: callers can navigate away (e.g. after a delete) without waiting for refetches.
    onSuccess: () => {
      void invalidateStudy(qc);
    },
  });
}

// Queries
export const useDashboard = () => useQuery({ queryKey: keys.dashboard, queryFn: () => api.get<Dashboard>('/dashboard') });
export const useCourses = () =>
  useQuery({ queryKey: keys.courses, queryFn: () => api.get<{ courses: Course[] }>('/courses').then((r) => r.courses) });
export const useCourse = (id: number) =>
  useQuery({ queryKey: keys.course(id), queryFn: () => api.get<{ course: Course; topics: TopicSummary[] }>(`/courses/${id}`) });
export const useTopic = (id: number) =>
  useQuery({ queryKey: keys.topic(id), queryFn: () => api.get<{ topic: TopicDetail }>(`/topics/${id}`).then((r) => r.topic) });
export const useUpcoming = (days: number) =>
  useQuery({ queryKey: keys.upcoming(days), queryFn: () => api.get<Upcoming>(`/upcoming?days=${days}`) });
export const useProgress = () => useQuery({ queryKey: keys.progress, queryFn: () => api.get<Progress>('/progress') });

export const fetchQueue = () => api.get<{ topics: TopicSummary[] }>('/review/queue').then((r) => r.topics);
export const fetchReviewSession = (topicId: number) => api.get<ReviewSession>(`/topics/${topicId}/review-session`);
export const fetchReminderDigest = () => api.get<ReminderDigest>('/reminders/digest');

// Mutations
export const useCreateCourse = () => useStudyMutation((input: CourseInput) => api.post<{ course: Course }>('/courses', input).then((r) => r.course));
export const useUpdateCourse = () =>
  useStudyMutation(({ id, ...input }: CourseInput & { id: number }) => api.put<{ course: Course }>(`/courses/${id}`, input).then((r) => r.course));
export const useDeleteCourse = () => useStudyMutation((id: number) => api.del(`/courses/${id}`));

export const useCreateTopic = () =>
  useStudyMutation((input: TopicCreateInput) => api.post<{ topic: TopicDetail }>('/topics', input).then((r) => r.topic));
export const useUpdateTopic = () =>
  useStudyMutation(({ id, ...input }: TopicUpdateInput & { id: number }) =>
    api.patch<{ topic: TopicDetail }>(`/topics/${id}`, input).then((r) => r.topic),
  );
export const useDeleteTopic = () => useStudyMutation((id: number) => api.del(`/topics/${id}`));

export const useAddQuestion = () =>
  useStudyMutation(({ topicId, ...input }: QuestionInput & { topicId: number }) =>
    api.post<{ question: Question }>(`/topics/${topicId}/questions`, input).then((r) => r.question),
  );
export const useUpdateQuestion = () =>
  useStudyMutation(({ id, ...input }: QuestionInput & { id: number }) =>
    api.put<{ question: Question }>(`/questions/${id}`, input).then((r) => r.question),
  );
export const useDeleteQuestion = () => useStudyMutation((id: number) => api.del(`/questions/${id}`));

export const useSubmitReview = () =>
  useStudyMutation(({ topicId, ...input }: ReviewSubmitInput & { topicId: number }) =>
    api.post<ReviewResult>(`/topics/${topicId}/reviews`, input),
  );

export const useLoadDemo = () => useStudyMutation(() => api.post('/demo'));
export const useRemoveDemo = () => useStudyMutation(() => api.del<{ removed: number }>('/demo'));

export function useUpdateSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SettingsInput) => api.patch<{ user: User }>('/settings', input).then((r) => r.user),
    onSuccess: (user) => {
      qc.setQueryData(keys.me, user);
      void invalidateStudy(qc);
    },
  });
}
