import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { ColumnDef } from '@tanstack/react-table'
import { useAspNetDataTableState } from '../src/useAspNetDataTableState'
import { useCacheInstance } from '../src/internal'
import type { ProductRow } from './setup'

const columns: ColumnDef<ProductRow>[] = [
  { accessorKey: 'name', header: 'Name' },
  { accessorKey: 'manufacturer', header: 'Manufacturer' },
]

describe('useAspNetDataTableState', () => {
  it('exposes default pagination, empty filters and a stable requestKey', () => {
    const { result } = renderHook(() => useAspNetDataTableState())
    const first = result.current

    expect(first.pagination).toEqual({ pageIndex: 0, pageSize: 25 })
    expect(first.sorting).toEqual([])
    expect(first.columnFilters).toEqual([])
    expect(first.globalFilter).toBe('')
    expect(first.nonce).toBe(0)
    expect(typeof first.requestKey).toBe('string')
    expect(first.requestKey).toBe(result.current.requestKey)
    expect(columns).toHaveLength(2)
  })

  it('updates state through TanStack-style handlers and changes requestKey', () => {
    const { result } = renderHook(() => useAspNetDataTableState())
    const before = result.current.requestKey

    act(() => result.current.onSortingChange([{ id: 'name', desc: true }]))

    expect(result.current.sorting).toEqual([{ id: 'name', desc: true }])
    expect(result.current.requestKey).not.toBe(before)
  })

  it('resets pageIndex when sorting changes', () => {
    const { result } = renderHook(() => useAspNetDataTableState())

    act(() => result.current.onPaginationChange({ pageIndex: 3, pageSize: 25 }))
    expect(result.current.pagination.pageIndex).toBe(3)

    act(() => result.current.onSortingChange([{ id: 'name', desc: true }]))
    expect(result.current.pagination.pageIndex).toBe(0)
  })

  it('bumps nonce on refetch()', () => {
    const { result } = renderHook(() => useAspNetDataTableState())

    act(() => result.current.refetch())

    expect(result.current.nonce).toBe(1)
  })

  it('applies function updaters', () => {
    const { result } = renderHook(() => useAspNetDataTableState())

    act(() => result.current.onGlobalFilterChange((old: unknown) => `${old ?? ''}pump`))

    expect(result.current.globalFilter).toBe('pump')
  })

  it('derives a request key for bigint filters without crashing', () => {
    const { result } = renderHook(() => useAspNetDataTableState())
    act(() => result.current.onGlobalFilterChange(42n))
    expect(result.current.requestKey).toContain('$bigint')
  })
})

describe('useCacheInstance', () => {
  it('tolerates nullish cache values without crashing', () => {
    const { result: rNull } = renderHook(() => useCacheInstance(null as any))
    expect(rNull.current).toBeUndefined()

    const { result: rUndef } = renderHook(() => useCacheInstance(undefined))
    expect(rUndef.current).toBeUndefined()

    const { result: rFalse } = renderHook(() => useCacheInstance(false))
    expect(rFalse.current).toBeUndefined()
  })

  it('creates a memory cache for true and option objects', () => {
    const { result: rTrue } = renderHook(() => useCacheInstance(true))
    expect(rTrue.current).toBeDefined()

    const { result: rOpts } = renderHook(() => useCacheInstance({ ttlMs: 1000 }))
    expect(rOpts.current).toBeDefined()
    expect(rOpts.current).not.toBe(rTrue.current)
  })
})
