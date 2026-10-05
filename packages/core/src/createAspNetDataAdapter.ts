import { AspNetDataError } from './errors'
import { buildQuery } from './buildQuery'
import { parseLoadResult } from './parseResponse'
import { queryToSearchParams } from './toQueryString'
import type { AspNetDataQuery, BuildQueryOptions, LoadResult, TableStateSnapshot } from './types'
import type { DataCache } from './cache'

export interface AspNetDataAdapterOptions {
  /** Endpoint bound to DevExtreme.AspNet.Data's `DataSourceLoadOptions`. */
  endpoint: string
  /**
   * `'GET'` (default) sends the query as URL search params. `'POST'` sends it
   * as an `application/x-www-form-urlencoded` body — the same keys, parsed by
   * the same model binder, without URL length limits.
   */
  method?: 'GET' | 'POST'
  /** Custom fetch implementation (defaults to global `fetch`). */
  fetchImpl?: typeof fetch
  /** Extra headers merged into every request. */
  headers?: Record<string, string>
  /** Options forwarded to `buildQuery`. */
  buildQuery?: BuildQueryOptions
  /**
   * Optional cache instance for response caching and request deduplication.
   * When provided, identical queries are served from cache and simultaneous
   * identical requests are deduplicated.
   */
  cache?: DataCache
}

export interface DataFetchOptions {
  /** `reload` bypasses cached and in-flight values, then refreshes the cache. */
  cacheMode?: 'default' | 'reload'
}

export type DataFetcher = <TData = unknown>(
  state: TableStateSnapshot,
  signal?: AbortSignal,
  fetchOptions?: DataFetchOptions,
) => Promise<LoadResult<TData>>

function abortError(): Error {
  const error = new Error('The operation was aborted.')
  error.name = 'AbortError'
  return error
}

function waitForConsumer<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise
  if (signal.aborted) return Promise.reject(abortError())

  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      cleanup()
      reject(abortError())
    }
    const cleanup = () => signal.removeEventListener('abort', onAbort)
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(
      (value) => {
        cleanup()
        resolve(value)
      },
      (error) => {
        cleanup()
        reject(error)
      },
    )
  })
}

/**
 * Creates a reusable function that converts a TanStack Table state snapshot
 * into a DevExtreme.AspNet.Data request and returns a normalized `LoadResult`.
 */
export function createAspNetDataAdapter(options: AspNetDataAdapterOptions): DataFetcher {
  const { endpoint, headers, cache } = options
  if (typeof endpoint !== 'string' || endpoint.trim() === '') {
    throw new AspNetDataError('Invalid endpoint: must be a non-empty string')
  }
  const rawMethod = options.method ?? 'GET'
  const method = typeof rawMethod === 'string' ? rawMethod.toUpperCase() : 'GET'
  if (method !== 'GET' && method !== 'POST') {
    throw new AspNetDataError(`Invalid method: ${String(rawMethod)} (expected GET or POST)`)
  }
  if (headers !== undefined && (headers === null || typeof headers !== 'object' || Array.isArray(headers))) {
    throw new AspNetDataError('Invalid headers: must be a plain object')
  }

  const doFetch =
    options.fetchImpl ??
    ((input: RequestInfo | URL, init?: RequestInit) => {
      const f = (globalThis as unknown as { fetch?: typeof fetch }).fetch
      if (typeof f !== 'function') throw new AspNetDataError('fetch is not available in this environment')
      return f(input, init)
    })

  function makeCacheKey(query: AspNetDataQuery, headerKey: string): string {
    return `${endpoint}|${method}|${headerKey}|${queryToSearchParams(query).toString()}`
  }

  return async function fetchPage<TData = unknown>(
    state: TableStateSnapshot,
    signal?: AbortSignal,
    fetchOptions: DataFetchOptions = {},
  ): Promise<LoadResult<TData>> {
    if (signal?.aborted) {
      throw abortError()
    }

    let query: AspNetDataQuery
    try {
      query = buildQuery(state, options.buildQuery)
    } catch (e) {
      throw new AspNetDataError((e as Error).message)
    }

    let headerKey = ''
    if (headers) {
      try {
        const sorted = Object.keys(headers)
          .sort()
          .reduce<Record<string, string>>((acc, k) => {
            acc[k] = headers[k]!
            return acc
          }, {})
        headerKey = JSON.stringify(sorted)
      } catch {
        headerKey = String(headers)
      }
    }
    const key = makeCacheKey(query, headerKey)

    const reload = fetchOptions.cacheMode === 'reload'

    // Check cache first. A reload deliberately starts a new request and
    // supersedes any identical request already registered as in-flight.
    if (cache && !reload) {
      const cached = cache.get(key)
      if (cached !== undefined) {
        return cached as LoadResult<TData>
      }
      const inflight = cache.getInflight(key)
      if (inflight) {
        return (await waitForConsumer(inflight, signal)) as LoadResult<TData>
      }
    }

    let url = endpoint
    let init: RequestInit = {
      // A cached request can have multiple consumers. No individual signal
      // owns the shared network request; each consumer cancels only its wait.
      signal: cache ? undefined : signal,
      headers: { Accept: 'application/json', ...headers },
    }

    let searchParams: URLSearchParams
    try {
      searchParams = queryToSearchParams(query)
    } catch (e) {
      throw new AspNetDataError((e as Error).message)
    }

    if (method === 'POST') {
      init = {
        ...init,
        method: 'POST',
        headers: { ...init.headers, 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
        body: searchParams.toString(),
      }
    } else {
      const search = searchParams.toString()
      if (search) {
        const hashIndex = url.indexOf('#')
        if (hashIndex !== -1) {
          const base = url.slice(0, hashIndex)
          const hash = url.slice(hashIndex)
          url = base + (base.includes('?') ? '&' : '?') + search + hash
        } else {
          url += (url.includes('?') ? '&' : '?') + search
        }
      }
    }

    const networkPromise = (async () => {
      let response: Response
      try {
        response = await doFetch(url, init)
      } catch (e) {
        if ((e as Error)?.name === 'AbortError') throw e
        throw new AspNetDataError((e as Error).message ?? 'Network error')
      }

      if (!response.ok) {
        // Surface the server's own explanation (validation problems, selector
        // errors) instead of a bare status. Truncated so a huge HTML error page
        // can't flood logs or the UI.
        const body = (await response.text().catch(() => '')).trim().slice(0, 2000)
        const detail = body ? `: ${body}` : '.'
        throw new AspNetDataError(`Request failed with status ${response.status}${detail}`, response.status, body || undefined)
      }

      let payload: unknown
      try {
        payload = await response.json()
      } catch {
        throw new AspNetDataError('Invalid response: payload is not valid JSON.', response.status)
      }

      try {
        return parseLoadResult(payload)
      } catch (e) {
        if (e instanceof AspNetDataError && e.status === undefined) {
          throw new AspNetDataError(e.message, response.status)
        }
        throw e
      }
    })()

    if (!cache) return networkPromise as Promise<LoadResult<TData>>

    let sharedPromise: Promise<LoadResult>
    sharedPromise = networkPromise
      .then((result) => {
        // A reload may have superseded this request. Only the current promise
        // is allowed to update the cached value.
        if (cache.getInflight(key) === sharedPromise) cache.set(key, result)
        return result
      })
      .finally(() => {
        if (cache.getInflight(key) === sharedPromise) cache.deleteInflight(key)
      })
    cache.setInflight(key, sharedPromise)
    return (await waitForConsumer(sharedPromise, signal)) as LoadResult<TData>
  }
}

export type { AspNetDataQuery }
