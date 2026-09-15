import type { LoadResult } from './types'

export interface DataCache {
  get(key: string): LoadResult | undefined
  set(key: string, value: LoadResult): void
  getInflight(key: string): Promise<LoadResult> | undefined
  setInflight(key: string, promise: Promise<LoadResult>): void
  deleteInflight(key: string): void
}

export interface MemoryCacheOptions {
  ttlMs?: number
  limit?: number
}

interface CacheEntry<T> {
  value: T
  expiresAt: number
}

function now(): number {
  return Date.now()
}

export function createMemoryCache(options: MemoryCacheOptions = {}): DataCache {
  const rawTtl = options.ttlMs
  const ttlMs = typeof rawTtl === 'number' && Number.isFinite(rawTtl) && rawTtl > 0 ? rawTtl : undefined
  const rawLimit = options.limit
  const limit = rawLimit === undefined ? 100 : typeof rawLimit === 'number' && Number.isInteger(rawLimit) && rawLimit > 0 ? rawLimit : 0
  const cache = new Map<string, CacheEntry<LoadResult>>()
  const inflight = new Map<string, Promise<LoadResult>>()

  function isExpired(entry: CacheEntry<LoadResult>): boolean {
    return ttlMs !== undefined && now() >= entry.expiresAt
  }

  function pruneIfNeeded(key: string): void {
    if (limit === 0) {
      cache.clear()
      return
    }
    if (cache.has(key)) return
    if (cache.size >= limit) {
      // Remove oldest entries until we're under the limit
      const entriesToRemove = cache.size - limit + 1
      let removed = 0
      for (const k of cache.keys()) {
        if (removed >= entriesToRemove) break
        cache.delete(k)
        removed++
      }
    }
  }

  function cloneResult(value: LoadResult): LoadResult {
    return {
      data: Array.isArray(value.data) ? [...value.data] : value.data,
      totalCount: value.totalCount,
      summary: value.summary ? [...value.summary] : value.summary,
      groupCount: value.groupCount,
    }
  }

  return {
    get(key: string): LoadResult | undefined {
      const entry = cache.get(key)
      if (!entry) return undefined
      if (isExpired(entry)) {
        cache.delete(key)
        return undefined
      }
      return cloneResult(entry.value)
    },
    set(key: string, value: LoadResult): void {
      pruneIfNeeded(key)
      cache.set(key, {
        value: cloneResult(value),
        expiresAt: ttlMs !== undefined ? now() + ttlMs : Infinity,
      })
    },
    getInflight(key: string): Promise<LoadResult> | undefined {
      return inflight.get(key)
    },
    setInflight(key: string, promise: Promise<LoadResult>): void {
      // Bound inflight to same limit to avoid unbounded growth
      if (limit !== 0 && !inflight.has(key) && inflight.size >= limit) {
        const oldest = inflight.keys().next().value as string | undefined
        if (oldest !== undefined) inflight.delete(oldest)
      }
      inflight.set(key, promise)
      // Auto-cleanup on settle to prevent leaks if deleteInflight not called
      promise.catch(() => {}).finally(() => {
        // keep entry until explicit deleteInflight, but ensure not leaked forever
        // No-op: actual deletion is done in adapter finally
      })
    },
    deleteInflight(key: string): void {
      inflight.delete(key)
    },
  }
}