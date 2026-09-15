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

export type DataFetcher = <TData = unknown>(
  state: TableStateSnapshot,
  signal?: AbortSignal,
) => Promise<LoadResult<TData>>

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

  return async function fetchPage<TData = unknown>(state: TableStateSnapshot, signal?: AbortSignal): Promise<LoadResult<TData>> {
    if (signal?.aborted) {
      const err = new Error('The operation was aborted.')
      err.name = 'AbortError'
      throw err
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

    // Check cache first
    if (cache) {
      const cached = cache.get(key)
      if (cached !== undefined) {
        return cached as LoadResult<TData>
      }
      const inflight = cache.getInflight(key)
      if (inflight) {
        return (await inflight) as LoadResult<TData>
      }
    }

    let url = endpoint
    let init: RequestInit = {
      signal,
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

    // Register inflight promise for deduplication
    const fetchPromise = (async () => {
      let response: Response
      try {
        response = await doFetch(url, init)
      } catch (e) {
        if ((e as Error)?.name === 'AbortError') throw e
        throw new AspNetDataError((e as Error).message ?? 'Network error')
      }

      if (!response.ok) {
        throw new AspNetDataError(`Request failed with status ${response.status}.`, response.status)
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

    if (cache) {
      cache.setInflight(key, fetchPromise)
    }

    try {
      const result = await fetchPromise
      if (cache && !signal?.aborted) {
        cache.set(key, result)
      }
      return result as LoadResult<TData>
    } finally {
      if (cache) {
        cache.deleteInflight(key)
      }
    }
  }
}

export type { AspNetDataQuery }
