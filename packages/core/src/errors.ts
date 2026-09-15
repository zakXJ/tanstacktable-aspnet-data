/**
 * Error thrown by the adapter for transport or payload problems.
 * Abort errors are never wrapped: they propagate untouched so callers can
 * detect cancellation via `error.name === 'AbortError'`.
 */
export class AspNetDataError extends Error {
  readonly status?: number

  constructor(message: string, status?: number) {
    super(message)
    this.name = 'AspNetDataError'
    this.status = status
  }
}
