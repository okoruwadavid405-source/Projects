import type { NextFunction, Request, Response } from 'express';
import type { ApiErrorBody } from '../../shared/api.js';
import { AppError } from '../lib/errors.js';

export function notFoundHandler(_req: Request, res: Response) {
  const body: ApiErrorBody = { error: { code: 'not_found', message: 'That page or resource does not exist.' } };
  res.status(404).json(body);
}

/** Converts every error into a safe JSON response. Raw database/internal errors are logged, never sent. */
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  let body: ApiErrorBody;
  let status: number;
  if (err instanceof AppError) {
    status = err.status;
    body = { error: { code: err.code, message: err.message, ...(err.fields ? { fields: err.fields } : {}) } };
  } else if (isBodyParserError(err)) {
    status = err.status;
    body = {
      error: {
        code: 'bad_request',
        message: err.type === 'entity.too.large' ? 'That request is too large.' : 'The request body is not valid JSON.',
      },
    };
  } else {
    console.error('[recall] Unhandled error:', err);
    status = 500;
    body = { error: { code: 'internal', message: 'Something went wrong on our side. Please try again.' } };
  }
  res.status(status).json(body);
}

function isBodyParserError(err: unknown): err is { status: number; type: string } {
  return typeof err === 'object' && err !== null && 'type' in err && 'status' in err && typeof err.status === 'number' && err.status < 500;
}
