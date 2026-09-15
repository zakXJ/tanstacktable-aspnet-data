import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { http, HttpResponse } from 'msw'
import type { ColumnDef } from '@tanstack/react-table'
import { useAspNetDataTable } from '../src/useAspNetDataTable'
import { products, requests, server } from './setup'
import type { ProductRow } from './setup'

const columns: ColumnDef<ProductRow>[] = [
  { accessorKey: 'name', header: 'Name' },
  { accessorKey: 'manufacturer', header: 'Manufacturer' },
]

const endpoint = 'http://test.local/api/products'

function renderTable() {
  return renderHook(() =>
    useAspNetDataTable<ProductRow>({
      endpoint,
      columns,
      globalFilterFields: ['name', 'manufacturer'],
    }),
  )
}

describe('useAspNetDataTable', () => {
  it('fetches the initial page and exposes server state', async () => {
    const { result } = renderTable()

    await waitFor(() => expect(result.current.rows.length).toBe(products.length))

    expect(result.current.rows).toEqual(products)
    expect(result.current.totalCount).toBe(123)
    expect(result.current.pageCount).toBe(Math.ceil(123 / 25))
    expect(result.current.isFetching).toBe(false)
    expect(result.current.isError).toBe(false)
    expect(requests[0]!.searchParams.get('skip')).toBe('0')
    expect(requests[0]!.searchParams.get('take')).toBe('25')
    expect(requests[0]!.searchParams.get('requireTotalCount')).toBe('true')
  })

  it('refetches with pagination changes', async () => {
    const { result } = renderTable()
    await waitFor(() => expect(result.current.rows.length).toBeGreaterThan(0))

    act(() => result.current.table.setPagination({ pageIndex: 3, pageSize: 25 }))

    await waitFor(() => expect(requests.at(-1)!.searchParams.get('skip')).toBe('75'))
  })

  it('resets pageIndex and refetches when sorting changes', async () => {
    const { result } = renderTable()
    await waitFor(() => expect(result.current.rows.length).toBeGreaterThan(0))

    act(() => result.current.table.setPagination({ pageIndex: 2, pageSize: 25 }))
    await waitFor(() => expect(requests.at(-1)!.searchParams.get('skip')).toBe('50'))

    act(() => result.current.table.setSorting([{ id: 'name', desc: true }]))

    await waitFor(() =>
      expect(requests.at(-1)!.searchParams.get('sort')).toBe('[{"selector":"name","desc":true}]'),
    )
    expect(result.current.table.getState().pagination.pageIndex).toBe(0)
  })

  it('serializes column filters and global filter together', async () => {
    const { result } = renderTable()
    await waitFor(() => expect(result.current.rows.length).toBeGreaterThan(0))

    act(() => result.current.table.getColumn('manufacturer')!.setFilterValue('Medtronic'))
    await waitFor(() =>
      expect(requests.at(-1)!.searchParams.get('filter')).toBe(
        '["manufacturer","contains","Medtronic"]',
      ),
    )

    act(() => result.current.table.setGlobalFilter('pump'))
    await waitFor(() =>
      expect(requests.at(-1)!.searchParams.get('filter')).toBe(
        '[[["name","contains","pump"],"or",["manufacturer","contains","pump"]],"and",["manufacturer","contains","Medtronic"]]',
      ),
    )
  })

  it('exposes transport errors through isError/error', async () => {
    server.use(http.get(endpoint, () => new HttpResponse(null, { status: 500 })))
    const { result } = renderTable()

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.error).toMatchObject({ name: 'AspNetDataError', status: 500 })
    expect(result.current.isFetching).toBe(false)
  })

  it('recovers after an error once the endpoint works again', async () => {
    server.use(http.get(endpoint, () => new HttpResponse(null, { status: 500 })))
    const { result } = renderTable()
    await waitFor(() => expect(result.current.isError).toBe(true))

    server.use(
      http.get(endpoint, () => HttpResponse.json({ data: products, totalCount: 123 })),
    )
    act(() => result.current.refetch())

    await waitFor(() => {
      expect(result.current.isError).toBe(false)
      expect(result.current.totalCount).toBe(123)
    })
  })

  it('supports enabled=false to pause fetching', async () => {
    const { result } = renderHook(() =>
      useAspNetDataTable<ProductRow>({ endpoint, columns, enabled: false }),
    )
    await waitFor(() => expect(requests.length).toBe(0))
    expect(result.current.rows).toEqual([])
  })

  describe('syncUrl', () => {
    beforeEach(() => {
      window.history.replaceState(null, '', '/')
    })

    it('initializes state from the URL when enabled', async () => {
      window.history.replaceState(null, '', '/?page=3&q=abc')
      const { result } = renderHook(() =>
        useAspNetDataTable<ProductRow>({ endpoint, columns, syncUrl: true }),
      )
      await waitFor(() => expect(result.current.rows.length).toBeGreaterThan(0))
      expect(result.current.table.getState().pagination.pageIndex).toBe(2)
      expect(result.current.table.getState().globalFilter).toBe('abc')
    })

    it('writes state changes back to the URL', async () => {
      const { result } = renderHook(() =>
        useAspNetDataTable<ProductRow>({ endpoint, columns, syncUrl: true }),
      )
      await waitFor(() => expect(result.current.rows.length).toBeGreaterThan(0))
      act(() => result.current.table.setGlobalFilter('pump'))
      await waitFor(() => expect(new URLSearchParams(window.location.search).get('q')).toBe('"pump"'))
    })

    it('leaves the URL untouched when disabled', async () => {
      window.history.replaceState(null, '', '/?page=2')
      const { result } = renderHook(() =>
        useAspNetDataTable<ProductRow>({ endpoint, columns, syncUrl: false }),
      )
      await waitFor(() => expect(result.current.rows.length).toBeGreaterThan(0))
      act(() => result.current.table.setGlobalFilter('zzz'))
      await waitFor(() => expect(window.location.search).not.toContain('q=zzz'))
      // Without syncUrl the URL is never read, so the default page 0 stands.
      expect(result.current.table.getState().pagination.pageIndex).toBe(0)
    })
  })

  describe('debounce', () => {
    it('coalesces rapid global filter changes into a single request', async () => {
      const { result } = renderHook(() =>
        useAspNetDataTable<ProductRow>({
          endpoint,
          columns,
          globalFilterFields: ['name', 'manufacturer'],
          globalFilterDebounceMs: 200,
        }),
      )
      await waitFor(() => expect(result.current.rows.length).toBeGreaterThan(0))
      const before = requests.length

      vi.useFakeTimers()
      act(() => {
        result.current.table.setGlobalFilter('a')
        result.current.table.setGlobalFilter('ab')
      })
      // Still pending: no request should have fired yet.
      expect(requests.length).toBe(before)

      act(() => {
        vi.advanceTimersByTime(200)
      })
      vi.useRealTimers()

      // Exactly one coalesced request after the quiet period.
      await waitFor(() => expect(requests.length).toBe(before + 1))
      expect(requests.at(-1)!.searchParams.get('filter')).toBe(
        '[["name","contains","ab"],"or",["manufacturer","contains","ab"]]',
      )
    })

    it('coalesces rapid column filter changes into a single request', async () => {
      const { result } = renderHook(() =>
        useAspNetDataTable<ProductRow>({
          endpoint,
          columns,
          columnFilterDebounceMs: 200,
        }),
      )
      await waitFor(() => expect(result.current.rows.length).toBeGreaterThan(0))
      const before = requests.length

      vi.useFakeTimers()
      act(() => {
        result.current.table.getColumn('manufacturer')!.setFilterValue('M')
        result.current.table.getColumn('manufacturer')!.setFilterValue('Me')
      })
      expect(requests.length).toBe(before)

      act(() => {
        vi.advanceTimersByTime(200)
      })
      vi.useRealTimers()

      await waitFor(() => expect(requests.length).toBe(before + 1))
      expect(requests.at(-1)!.searchParams.get('filter')).toBe('["manufacturer","contains","Me"]')
    })

    it('fires immediately when debounce is disabled (0)', async () => {
      const { result } = renderHook(() =>
        useAspNetDataTable<ProductRow>({
          endpoint,
          columns,
          globalFilterFields: ['name'],
          globalFilterDebounceMs: 0,
        }),
      )
      await waitFor(() => expect(result.current.rows.length).toBeGreaterThan(0))
      const before = requests.length

      act(() => {
        result.current.table.setGlobalFilter('now')
      })
      await waitFor(() => expect(requests.length).toBe(before + 1))
    })
  })

  describe('cache', () => {
    it('serves cached responses and deduplicates in-flight requests', async () => {
      const { result, rerender } = renderHook(
        ({ cache }) =>
          useAspNetDataTable<ProductRow>({
            endpoint,
            columns,
            cache,
          }),
        { initialProps: { cache: true } },
      )
      await waitFor(() => expect(result.current.rows.length).toBeGreaterThan(0))
      expect(requests.length).toBe(1)

      // Navigate to page 2
      act(() => result.current.table.setPagination({ pageIndex: 1, pageSize: 25 }))
      await waitFor(() => expect(requests.length).toBe(2))

      // Go back to page 1 (should hit cache)
      act(() => result.current.table.setPagination({ pageIndex: 0, pageSize: 25 }))
      await waitFor(() => expect(requests.length).toBe(2)) // no new request

      // Go to page 2 again (should hit cache)
      act(() => result.current.table.setPagination({ pageIndex: 1, pageSize: 25 }))
      await waitFor(() => expect(requests.length).toBe(2)) // no new request
    })

    it('deduplicates simultaneous identical requests', async () => {
      const { result } = renderHook(() =>
        useAspNetDataTable<ProductRow>({
          endpoint,
          columns,
          cache: true,
        }),
      )
      await waitFor(() => expect(result.current.rows.length).toBeGreaterThan(0))
      const before = requests.length

      // Fire two rapid identical page changes (should dedupe)
      act(() => {
        result.current.table.setPagination({ pageIndex: 1, pageSize: 25 })
        result.current.table.setPagination({ pageIndex: 1, pageSize: 25 })
      })
      await waitFor(() => expect(requests.length).toBe(before + 1))
    })
  })
})
