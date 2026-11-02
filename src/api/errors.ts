import { ApiError, type ApiErrorCode } from './types';

const KNOWN_CODES: readonly ApiErrorCode[] = [
  'validation',
  'not_found',
  'database',
  'io',
  'migration',
  'unavailable',
  'internal',
];

/**
 * Normalize anything thrown while talking to the backend into an ApiError.
 * The Rust side rejects with `{ code, message }`; the message is already user-safe.
 */
export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;

  if (typeof error === 'object' && error !== null) {
    const { code, message } = error as { code?: unknown; message?: unknown };
    if (typeof message === 'string') {
      const known = KNOWN_CODES.find((candidate) => candidate === code);
      return new ApiError(known ?? 'unknown', message);
    }
  }
  if (typeof error === 'string') return new ApiError('unknown', error);
  return new ApiError('unknown', 'An unexpected error occurred.');
}

/** Text suitable for showing directly in the UI. */
export function errorMessage(error: unknown): string {
  return toApiError(error).message;
}
