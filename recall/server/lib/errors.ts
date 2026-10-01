/** Errors whose message is safe to show to the user. Anything else becomes a generic 500. */
export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields?: Record<string, string>,
  ) {
    super(message);
  }
}

export const badRequest = (message: string, fields?: Record<string, string>) =>
  new AppError(400, 'bad_request', message, fields);
export const unauthorized = (message = 'Please log in to continue.') => new AppError(401, 'unauthorized', message);
export const forbidden = (message = 'You do not have permission to do that.') =>
  new AppError(403, 'forbidden', message);
export const notFound = (what = 'That item') => new AppError(404, 'not_found', `${what} could not be found.`);
export const conflict = (message: string, fields?: Record<string, string>) =>
  new AppError(409, 'conflict', message, fields);
export const tooManyRequests = (message: string) => new AppError(429, 'rate_limited', message);

/** True when a SQLite error is a UNIQUE constraint violation. */
export function isUniqueViolation(err: unknown): boolean {
  return err instanceof Error && /UNIQUE constraint failed/i.test(err.message);
}
