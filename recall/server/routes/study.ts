import { Router } from 'express';
import { z } from 'zod';
import {
  courseInputSchema,
  questionDraftRequestSchema,
  questionInputSchema,
  reviewSubmitSchema,
  settingsSchema,
  topicCreateSchema,
  topicUpdateSchema,
} from '../../shared/validation.js';
import type { AppContext } from '../lib/context.js';
import { nowIso } from '../lib/time.js';
import { parse, parseId } from '../lib/validate.js';
import { clearSessionCookie, currentUser } from '../middleware/auth.js';
import { deleteUser, findUserById, toPublicUser, updateUserSettings } from '../repositories/users.js';
import * as courses from '../services/courses.js';
import { loadDemoData, removeDemoData } from '../services/demo.js';
import { draftQuestions } from '../services/questionFlow.js';
import { getReviewQueue, getReviewSession, submitReview } from '../services/reviews.js';
import { getDashboard, getProgress, getReminderDigest, getUpcoming } from '../services/stats.js';
import * as topics from '../services/topics.js';

/** All routes here sit behind `requireAuth`, and every service call is scoped to the current user's id. */
export function studyRoutes(ctx: AppContext): Router {
  const router = Router();

  // Courses
  router.get('/courses', (req, res) => {
    const user = currentUser(req);
    res.json({ courses: courses.listCourses(ctx, user.id, user.timezone) });
  });
  router.post('/courses', (req, res) => {
    const user = currentUser(req);
    res.status(201).json({ course: courses.createCourse(ctx, user.id, user.timezone, parse(courseInputSchema, req.body)) });
  });
  router.get('/courses/:id', (req, res) => {
    const user = currentUser(req);
    const id = parseId(req.params.id, 'That course');
    res.json({
      course: courses.getCourse(ctx, user.id, user.timezone, id),
      topics: topics.listTopics(ctx, user.id, user.timezone, id),
    });
  });
  router.put('/courses/:id', (req, res) => {
    const user = currentUser(req);
    const id = parseId(req.params.id, 'That course');
    res.json({ course: courses.updateCourse(ctx, user.id, user.timezone, id, parse(courseInputSchema, req.body)) });
  });
  router.delete('/courses/:id', (req, res) => {
    courses.deleteCourse(ctx, currentUser(req).id, parseId(req.params.id, 'That course'));
    res.status(204).end();
  });

  // Topics
  router.get('/topics', (req, res) => {
    const user = currentUser(req);
    res.json({ topics: topics.listTopics(ctx, user.id, user.timezone) });
  });
  router.post('/topics', (req, res) => {
    const user = currentUser(req);
    res.status(201).json({ topic: topics.createTopic(ctx, user.id, user.timezone, parse(topicCreateSchema, req.body)) });
  });
  router.get('/topics/:id', (req, res) => {
    const user = currentUser(req);
    res.json({ topic: topics.getTopicDetail(ctx, user.id, user.timezone, parseId(req.params.id, 'That topic')) });
  });
  router.patch('/topics/:id', (req, res) => {
    const user = currentUser(req);
    const id = parseId(req.params.id, 'That topic');
    res.json({ topic: topics.updateTopic(ctx, user.id, user.timezone, id, parse(topicUpdateSchema, req.body)) });
  });
  router.delete('/topics/:id', (req, res) => {
    topics.deleteTopic(ctx, currentUser(req).id, parseId(req.params.id, 'That topic'));
    res.status(204).end();
  });

  // Questions
  router.post('/topics/:id/questions', (req, res) => {
    const user = currentUser(req);
    const topicId = parseId(req.params.id, 'That topic');
    res.status(201).json({ question: topics.addQuestion(ctx, user.id, topicId, parse(questionInputSchema, req.body)) });
  });
  router.put('/questions/:id', (req, res) => {
    const user = currentUser(req);
    const id = parseId(req.params.id, 'That question');
    res.json({ question: topics.editQuestion(ctx, user.id, id, parse(questionInputSchema, req.body)) });
  });
  router.delete('/questions/:id', (req, res) => {
    topics.removeQuestion(ctx, currentUser(req).id, parseId(req.params.id, 'That question'));
    res.status(204).end();
  });

  router.post('/question-drafts', async (req, res) => {
    const drafts = await draftQuestions(ctx, currentUser(req).id, parse(questionDraftRequestSchema, req.body));
    res.json({ drafts });
  });
  router.get('/features', (_req, res) => {
    res.json({ questionGeneration: ctx.questionGenerator !== null });
  });

  // Reviews
  router.get('/review/queue', (req, res) => {
    const user = currentUser(req);
    res.json({ topics: getReviewQueue(ctx, user.id, user.timezone) });
  });
  router.get('/topics/:id/review-session', (req, res) => {
    const user = currentUser(req);
    res.json(getReviewSession(ctx, user.id, user.timezone, parseId(req.params.id, 'That topic')));
  });
  router.post('/topics/:id/reviews', (req, res) => {
    const user = currentUser(req);
    const id = parseId(req.params.id, 'That topic');
    res.status(201).json(submitReview(ctx, user.id, user.timezone, id, parse(reviewSubmitSchema, req.body)));
  });

  // Overview
  router.get('/dashboard', (req, res) => res.json(getDashboard(ctx, currentUser(req))));
  router.get('/upcoming', (req, res) => {
    const days = parse(z.coerce.number().int().min(7).max(120).default(42), req.query.days);
    res.json(getUpcoming(ctx, currentUser(req), days));
  });
  router.get('/progress', (req, res) => res.json(getProgress(ctx, currentUser(req))));
  router.get('/reminders/digest', (req, res) => res.json(getReminderDigest(ctx, currentUser(req))));

  // Settings & account
  router.patch('/settings', (req, res) => {
    const user = currentUser(req);
    updateUserSettings(ctx.db, user.id, parse(settingsSchema, req.body), nowIso(ctx));
    res.json({ user: toPublicUser(findUserById(ctx.db, user.id)!) });
  });
  router.delete('/account', (req, res) => {
    deleteUser(ctx.db, currentUser(req).id);
    clearSessionCookie(ctx, res);
    res.status(204).end();
  });

  // Demo data
  router.post('/demo', (req, res) => {
    const user = currentUser(req);
    loadDemoData(ctx, user.id, user.timezone);
    res.status(201).json({ ok: true });
  });
  router.delete('/demo', (req, res) => {
    res.json({ removed: removeDemoData(ctx, currentUser(req).id) });
  });

  return router;
}
