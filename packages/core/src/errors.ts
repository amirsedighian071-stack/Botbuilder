export type ErrorCode =
  | 'BAD_REQUEST'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'UPSTREAM_ERROR'
  | 'NOT_CONFIGURED'
  | 'VALIDATION'
  | 'INTERNAL';

const STATUS: Record<ErrorCode, number> = {
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  UPSTREAM_ERROR: 502,
  NOT_CONFIGURED: 503,
  VALIDATION: 422,
  INTERNAL: 500,
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: unknown;
  readonly expose: boolean;

  constructor(code: ErrorCode, message: string, options: { details?: unknown; expose?: boolean } = {}) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = STATUS[code];
    this.details = options.details;
    this.expose = options.expose ?? this.status < 500;
  }

  toJSON(): { error: { code: ErrorCode; message: string; details?: unknown } } {
    return {
      error: {
        code: this.code,
        message: this.expose ? this.message : 'Internal server error',
        ...(this.expose && this.details !== undefined ? { details: this.details } : {}),
      },
    };
  }
}

export const badRequest = (message: string, details?: unknown) =>
  new AppError('BAD_REQUEST', message, { details });
export const unauthorized = (message = 'Authentication required') =>
  new AppError('UNAUTHORIZED', message);
export const forbidden = (message = 'Access denied') => new AppError('FORBIDDEN', message);
export const notFound = (message = 'Resource not found') => new AppError('NOT_FOUND', message);
export const conflict = (message: string) => new AppError('CONFLICT', message);
export const rateLimited = (message = 'Too many requests', details?: unknown) =>
  new AppError('RATE_LIMITED', message, { details });
export const notConfigured = (message: string) => new AppError('NOT_CONFIGURED', message);
export const upstreamError = (message: string, details?: unknown) =>
  new AppError('UPSTREAM_ERROR', message, { details });
export const validationError = (message: string, details?: unknown) =>
  new AppError('VALIDATION', message, { details });

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

export function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error);
  } catch {
    return 'Unknown error';
  }
}
