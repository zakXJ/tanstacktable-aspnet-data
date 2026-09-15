import { describe, expect, it, vi } from 'vitest'
import { createMemoryCache } from '../src/cache'
import type { LoadResult } from '../src/types'

function createResult(data: unknown[] = []): LoadResult {
  return { data, totalCount: data.length }
}

describe('createMemoryCache', () => {
  it('stores and retrieves a value', () => {
    const cache = createMemoryCache()
    const result = createResult([{ id: 1 }])
    cache.set('key1', result)
    expect(cache.get('key1')).toEqual(result)
  })

  it('returns undefined for missing keys', () => {
    const cache = createMemoryCache()
    expect(cache.get('missing')).toBeUndefined()
  })

  it('overwrites existing values', () => {
    const cache = createMemoryCache()
    cache.set('key', createResult([{ id: 1 }]))
    cache.set('key', createResult([{ id: 2 }]))
    expect(cache.get('key')?.data).toEqual([{ id: 2 }])
  })

  it('expires entries after ttlMs', () => {
    const cache = createMemoryCache({ ttlMs: 100 })
    cache.set('key', createResult([{ id: 1 }]))
    expect(cache.get('key')).toBeDefined()
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        expect(cache.get('key')).toBeUndefined()
        resolve()
      }, 150)
    })
  })

  it('deduplicates inflight requests', async () => {
    const cache = createMemoryCache()
    let callCount = 0
    const promise = (async () => {
      callCount++
      return createResult([{ id: callCount }])
    })()
    cache.setInflight('key', promise)
    const result1 = await cache.getInflight('key')!
    const result2 = await cache.getInflight('key')!
    expect(result1).toBe(result2)
    expect(callCount).toBe(1)
  })

  it('clears inflight after completion', async () => {
    const cache = createMemoryCache()
    const promise = Promise.resolve(createResult([{ id: 1 }]))
    cache.setInflight('key', promise)
    await promise
    cache.deleteInflight('key')
    expect(cache.getInflight('key')).toBeUndefined()
  })

  it('respects limit by evicting oldest entries', () => {
    const cache = createMemoryCache({ limit: 2 })
    cache.set('a', createResult([1]))
    cache.set('b', createResult([2]))
    cache.set('c', createResult([3]))
    expect(cache.get('a')).toBeUndefined()
    expect(cache.get('b')).toBeDefined()
    expect(cache.get('c')).toBeDefined()
  })
})