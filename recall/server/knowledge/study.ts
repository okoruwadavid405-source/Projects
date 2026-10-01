/** Moving a course topic into the student's reviews (the bridge between course knowledge and the memory system). */
import type { z } from 'zod';
import { STATUS_META } from '../../shared/knowledge.js';
import type { studyTopicSchema } from '../../shared/knowledgeApi.js';
import type { TopicDetail, User } from '../../shared/api.js';
import type { AppContext } from '../lib/context.js';
import { conflict, notFound } from '../lib/errors.js';
import { createTopic } from '../services/topics.js';
import { buildProfile } from './profile.js';

export function studyTopic(ctx: AppContext, user: User, studentCourseId: number, input: z.output<typeof studyTopicSchema>): TopicDetail {
  const profile = buildProfile(ctx, user.id, studentCourseId, user.timezone);
  const topic = profile.topics.find((t) => t.key === input.topicKey);
  if (!topic) throw notFound('That topic');
  if (topic.personal) throw conflict(`“${topic.name}” is already in your reviews.`);
  if (topic.status !== 'confirmed' && topic.status !== 'your_materials' && !input.allowUnconfirmed) {
    throw conflict(
      `“${topic.name}” isn't confirmed for your ${profile.studentCourse.version.label} course (${STATUS_META[topic.status].label}). Confirm that you want to study it anyway as general practice.`,
    );
  }
  const description = [topic.description, topic.subtopics.length ? `Covers: ${topic.subtopics.join(', ')}.` : null].filter(Boolean).join(' ') || null;
  return createTopic(
    ctx,
    user.id,
    user.timezone,
    {
      courseId: profile.studentCourse.recallCourseId,
      title: topic.name.slice(0, 120),
      description: description?.slice(0, 2000) ?? null,
      learnedOn: input.learnedOn,
      understanding: input.understanding,
      questions: [],
    },
    { knowledgeKey: topic.key, autoGenerate: input.generateQuestions },
  );
}
