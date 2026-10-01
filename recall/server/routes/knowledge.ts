import express, { Router } from 'express';
import { z } from 'zod';
import {
  assistantRequestSchema,
  catalogCourseInputSchema,
  confirmExtractionSchema,
  departmentInputSchema,
  importUrlSchema,
  saveResourceSchema,
  studentCourseInputSchema,
  studyTopicSchema,
  universityInputSchema,
  uploadDocumentTypeSchema,
} from '../../shared/knowledgeApi.js';
import { answer } from '../knowledge/assistant.js';
import { createCatalogCourse, createDepartment, createUniversity, enrollStudent, requireStudentCourse, unlinkStudentCourse } from '../knowledge/courses.js';
import { deleteSavedSource, discoverResources, saveResource, suggestTopics } from '../knowledge/discovery.js';
import { confirmDocument, deleteDocument, getDocument, importFromUrl, uploadDocument } from '../knowledge/documents.js';
import { MAX_UPLOAD_BYTES } from '../knowledge/parsers.js';
import { buildProfile } from '../knowledge/profile.js';
import { recommend } from '../knowledge/recommendations.js';
import * as repo from '../knowledge/repository.js';
import { studyTopic } from '../knowledge/study.js';
import type { AppContext } from '../lib/context.js';
import { AppError, badRequest, notFound } from '../lib/errors.js';
import { parse, parseId } from '../lib/validate.js';
import { currentUser } from '../middleware/auth.js';

const searchQuery = z.string().trim().max(100).default('');

/** Course knowledge routes. Mounted behind requireAuth; every call is scoped to the current user. */
export function knowledgeRoutes(ctx: AppContext): Router {
  const router = Router();

  // ----- Catalog (global) -----
  router.get('/catalog/universities', (req, res) => {
    res.json({ universities: repo.searchUniversities(ctx.db, parse(searchQuery, req.query.q)) });
  });
  router.post('/catalog/universities', (req, res) => {
    res.status(201).json({ university: createUniversity(ctx, currentUser(req).id, parse(universityInputSchema, req.body)) });
  });
  router.get('/catalog/universities/:id/departments', (req, res) => {
    const id = parseId(req.params.id, 'That university');
    if (!repo.getUniversityRow(ctx.db, id)) throw notFound('That university');
    res.json({ departments: repo.listDepartments(ctx.db, id) });
  });
  router.post('/catalog/universities/:id/departments', (req, res) => {
    const id = parseId(req.params.id, 'That university');
    res.status(201).json({ department: createDepartment(ctx, currentUser(req).id, id, parse(departmentInputSchema, req.body)) });
  });
  router.get('/catalog/courses', (req, res) => {
    const q = parse(searchQuery, req.query.q);
    const universityId = req.query.universityId ? parseId(req.query.universityId, 'That university') : undefined;
    res.json({ courses: q || universityId ? repo.searchCourses(ctx.db, q, universityId) : [] });
  });
  router.post('/catalog/courses', (req, res) => {
    res.status(201).json({ course: createCatalogCourse(ctx, currentUser(req).id, parse(catalogCourseInputSchema, req.body)) });
  });

  // ----- The student's courses -----
  router.get('/knowledge/student-courses', (req, res) => {
    res.json({ studentCourses: repo.listStudentCourses(ctx.db, currentUser(req).id) });
  });
  router.post('/knowledge/student-courses', (req, res) => {
    res.status(201).json({ studentCourse: enrollStudent(ctx, currentUser(req).id, parse(studentCourseInputSchema, req.body)) });
  });
  router.get('/knowledge/student-courses/by-course/:courseId', (req, res) => {
    const sc = repo.getStudentCourseByRecallCourse(ctx.db, currentUser(req).id, parseId(req.params.courseId, 'That course'));
    res.json({ studentCourse: sc ?? null });
  });
  router.delete('/knowledge/student-courses/:id', (req, res) => {
    unlinkStudentCourse(ctx, currentUser(req).id, parseId(req.params.id, 'That course'));
    res.status(204).end();
  });
  router.get('/knowledge/student-courses/:id/profile', (req, res) => {
    const user = currentUser(req);
    res.json(buildProfile(ctx, user.id, parseId(req.params.id, 'That course'), user.timezone));
  });
  router.get('/knowledge/student-courses/:id/recommendations', (req, res) => {
    const user = currentUser(req);
    const id = parseId(req.params.id, 'That course');
    requireStudentCourse(ctx, user.id, id);
    res.json({ recommendations: recommend(ctx, user, { studentCourseId: id }) });
  });
  router.get('/recommendations', (req, res) => {
    res.json({ recommendations: recommend(ctx, currentUser(req), { limit: 6 }) });
  });

  // ----- Documents -----
  router.post(
    '/knowledge/student-courses/:id/documents',
    express.raw({ type: 'application/octet-stream', limit: MAX_UPLOAD_BYTES }),
    async (req, res) => {
      const user = currentUser(req);
      const id = parseId(req.params.id, 'That course');
      if (!Buffer.isBuffer(req.body) || req.body.length === 0) throw badRequest('Choose a file to upload.');
      let filename = 'document';
      try {
        filename = decodeURIComponent(String(req.headers['x-filename'] ?? 'document'));
      } catch {
        /* keep the default */
      }
      filename = filename.replace(/[\\/]/g, '_').replace(/[\u0000-\u001f]/g, '').slice(0, 200) || 'document';
      const documentType = parse(uploadDocumentTypeSchema, req.query.type ?? 'other');
      res.status(202).json({ document: await uploadDocument(ctx, user.id, id, { filename, data: req.body, documentType }) });
    },
  );
  router.post('/knowledge/student-courses/:id/import-url', async (req, res) => {
    const { url } = parse(importUrlSchema, req.body);
    res.status(202).json({ document: await importFromUrl(ctx, currentUser(req).id, parseId(req.params.id, 'That course'), url) });
  });
  router.get('/knowledge/documents/:id', (req, res) => {
    res.json({ document: getDocument(ctx, currentUser(req).id, parseId(req.params.id, 'That document')) });
  });
  router.post('/knowledge/documents/:id/confirm', (req, res) => {
    const doc = confirmDocument(ctx, currentUser(req).id, parseId(req.params.id, 'That document'), parse(confirmExtractionSchema, req.body));
    res.json({ document: doc });
  });
  router.delete('/knowledge/documents/:id', (req, res) => {
    deleteDocument(ctx, currentUser(req).id, parseId(req.params.id, 'That document'));
    res.status(204).end();
  });

  // ----- Resources & suggestions -----
  router.get('/knowledge/student-courses/:id/discover', async (req, res) => {
    const topic = parse(z.string().trim().max(120).optional(), req.query.topic);
    res.json(await discoverResources(ctx, currentUser(req).id, parseId(req.params.id, 'That course'), topic));
  });
  router.post('/knowledge/student-courses/:id/resources', (req, res) => {
    const source = saveResource(ctx, currentUser(req).id, parseId(req.params.id, 'That course'), parse(saveResourceSchema, req.body));
    res.status(201).json({ source });
  });
  router.delete('/knowledge/sources/:id', (req, res) => {
    deleteSavedSource(ctx, currentUser(req).id, parseId(req.params.id, 'That resource'));
    res.status(204).end();
  });
  router.post('/knowledge/student-courses/:id/suggestions', async (req, res) => {
    res.json(await suggestTopics(ctx, currentUser(req), parseId(req.params.id, 'That course')));
  });

  // ----- Studying -----
  router.post('/knowledge/student-courses/:id/study', (req, res) => {
    const topic = studyTopic(ctx, currentUser(req), parseId(req.params.id, 'That course'), parse(studyTopicSchema, req.body));
    res.status(201).json({ topic });
  });

  // ----- Assistant (Server-Sent Events) -----
  router.post('/knowledge/student-courses/:id/assistant', async (req, res) => {
    const user = currentUser(req);
    const id = parseId(req.params.id, 'That course');
    const { messages } = parse(assistantRequestSchema, req.body);
    const stream = answer(ctx, user, id, messages);
    // Run the generator to its first event before switching to SSE, so setup errors become normal JSON errors.
    const first = await stream.next();
    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
    const send = (event: unknown) => res.write(`data: ${JSON.stringify(event)}\n\n`);
    let closed = false;
    req.on('close', () => (closed = true));
    try {
      if (!first.done) send(first.value);
      for await (const event of stream) {
        if (closed) break;
        send(event);
      }
      send({ type: 'done' });
    } catch (err) {
      const message = err instanceof AppError || (err instanceof Error && 'retryable' in err) ? (err as Error).message : 'The assistant stopped unexpectedly. Please try again.';
      if (!(err instanceof AppError)) console.error('[recall] Assistant stream failed:', err);
      send({ type: 'error', message });
    }
    res.end();
  });

  return router;
}
