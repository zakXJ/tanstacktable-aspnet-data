/**
 * Error thrown by the adapter for transport or payload problems.
 * Abort errors are never wrapped: they propagate untouched so callers can
 * detect cancellation via `error.name === 'AbortError'`.
 */
export class AspNetDataError extends Error {
  readonly status?: number
  /** Raw response body, truncated, when the server sent one with a failed status. */
  readonly body?: string

  constructor(message: string, status?: number, body?: string) {
    super(message)
    this.name = 'AspNetDataError'
    this.status = status
    this.body = body
  }
}
