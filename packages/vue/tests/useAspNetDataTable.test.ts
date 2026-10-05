import { defineComponent, h, reactive } from 'vue'
import { render, waitFor } from '@testing-library/vue'
import { describe, expect, it, vi } from 'vitest'
import { http, HttpResponse } from 'msw'
import type { ColumnDef } from '@tanstack/vue-table'
import { useAspNetDataTable } from '../src/useAspNetDataTable'
import { products, requests, server } from './setup'
import type { ProductRow } from './setup'

const columns: ColumnDef<ProductRow>[] = [
  { accessorKey: 'name', header: 'Name' },
  { accessorKey: 'manufacturer', header: 'Manufacturer' },
]

const endpoint = 'http://test.local/api/products'

type Result = ReturnType<typeof useAspNetDataTable<ProductRow>>

function mountTable() {
  let result!: Result
  const Host = defineComponent({
    setup() {
      result = useAspNetDataTable<ProductRow>({
        endpoint,
        columns,
        globalFilterFields: ['name', 'manufacturer'],
      })
      return () => h('div')
    },
  })
  render(Host)
  return () => result
}

describe('useAspNetDataTable (vue)', () => {
  it('preserves unrelated URL state and resets from popstate', async () => {
    window.history.replaceState(null, '', '/?tab=details')
    let result!: Result
    const Host = defineComponent({
      setup() {
        result = useAspNetDataTable<ProductRow>({ endpoint, columns, syncUrl: true })
        return () => h('div')
      },
    })
    render(Host)
    await waitFor(() => expect(result.rows.value.length).toBeGreaterThan(0))
    result.table.setGlobalFilter('pump')
    await waitFor(() => expect(new URLSearchParams(window.location.search).get('q')).toBe('"pump"'))
    expect(new URLSearchParams(window.location.search).get('tab')).toBe('details')

    window.history.replaceState(null, '', '/?tab=details')
    window.dispatchEvent(new PopStateEvent('popstate'))
    await waitFor(() => expect(result.table.getState().globalFilter).toBe(''))
    expect(new URLSearchParams(window.location.search).get('tab')).toBe('details')
  })

  it('fetches the initial page and exposes server state', async () => {
    const getResult = mountTable()

    await waitFor(() => expect(getResult().rows.value.length).toBe(products.length))

    expect(getResult().rows.value).toEqual(products)
    expect(getResult().totalCount.value).toBe(123)
    expect(getResult().pageCount.value).toBe(Math.ceil(123 / 25))
    expect(getResult().isFetching.value).toBe(false)
    expect(requests[0]!.searchParams.get('skip')).toBe('0')
    expect(requests[0]!.searchParams.get('take')).toBe('25')
  })

  it('feeds the server pageCount into the table so next-page navigation works', async () => {
    const getResult = mountTable()
    await waitFor(() => expect(getResult().rows.value.length).toBe(products.length))

    await waitFor(() => expect(getResult().table.getPageCount()).toBe(Math.ceil(123 / 25)))
    expect(getResult().table.getCanNextPage()).toBe(true)
    expect(getResult().table.getCanPreviousPage()).toBe(false)

    getResult().table.setPagination({ pageIndex: 4, pageSize: 25 })

    await waitFor(() => expect(getResult().table.getCanNextPage()).toBe(false))
    expect(getResult().table.getCanPreviousPage()).toBe(true)
  })

  it('refetches with pagination changes', async () => {
    const getResult = mountTable()
    await waitFor(() => expect(getResult().rows.value.length).toBeGreaterThan(0))

    getResult().table.setPagination({ pageIndex: 3, pageSize: 25 })

    await waitFor(() => expect(requests.at(-1)!.searchParams.get('skip')).toBe('75'))
  })

  it('resets pageIndex and refetches when sorting changes', async () => {
    const getResult = mountTable()
    await waitFor(() => expect(getResult().rows.value.length).toBeGreaterThan(0))

    getResult().table.setPagination({ pageIndex: 2, pageSize: 25 })
    await waitFor(() => expect(requests.at(-1)!.searchParams.get('skip')).toBe('50'))

    getResult().table.setSorting([{ id: 'name', desc: true }])

    await waitFor(() =>
      expect(requests.at(-1)!.searchParams.get('sort')).toBe('[{"selector":"name","desc":true}]'),
    )
    expect(getResult().table.getState().pagination.pageIndex).toBe(0)
  })

  it('serializes column filters and global filter together', async () => {
    const getResult = mountTable()
    await waitFor(() => expect(getResult().rows.value.length).toBeGreaterThan(0))

    getResult().table.getColumn('manufacturer')!.setFilterValue('Medtronic')
    await waitFor(() =>
      expect(requests.at(-1)!.searchParams.get('filter')).toBe(
        '["manufacturer","contains","Medtronic"]',
      ),
    )

    getResult().table.setGlobalFilter('pump')
    await waitFor(() =>
      expect(requests.at(-1)!.searchParams.get('filter')).toBe(
        '[[["name","contains","pump"],"or",["manufacturer","contains","pump"]],"and",["manufacturer","contains","Medtronic"]]',
      ),
    )
  })

  it('exposes transport errors through isError/error', async () => {
    server.use(http.get(endpoint, () => new HttpResponse(null, { status: 500 })))
    const getResult = mountTable()

    await waitFor(() => expect(getResult().isError.value).toBe(true))
    expect(getResult().error.value).toMatchObject({ name: 'AspNetDataError', status: 500 })
    expect(getResult().isFetching.value).toBe(false)
  })

  it('supports enabled=false to pause fetching', async () => {
    let result!: Result
    const Host = defineComponent({
      setup() {
        result = useAspNetDataTable<ProductRow>({ endpoint, columns, enabled: false })
        return () => h('div')
      },
    })
    render(Host)

    await waitFor(() => expect(requests.length).toBe(0))
    expect(result.rows.value).toEqual([])
  })

  it('aborts an active request when enabled becomes false', async () => {
    let result!: Result
    let aborted = false
    const options = reactive({
      endpoint,
      columns,
      enabled: true,
      fetchImpl: (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            aborted = true
            const error = new Error('aborted')
            error.name = 'AbortError'
            reject(error)
          })
        }),
    })
    const Host = defineComponent({
      setup() {
        result = useAspNetDataTable<ProductRow>(options)
        return () => h('div')
      },
    })
    render(Host)
    await waitFor(() => expect(result.isFetching.value).toBe(true))

    options.enabled = false

    await waitFor(() => expect(aborted).toBe(true))
    expect(result.isFetching.value).toBe(false)
    expect(result.rows.value).toEqual([])
  })

  it('coalesces rapid global filter changes into a single request', async () => {
    let result!: Result
    const Host = defineComponent({
      setup() {
        result = useAspNetDataTable<ProductRow>({
          endpoint,
          columns,
          globalFilterFields: ['name', 'manufacturer'],
          globalFilterDebounceMs: 200,
        })
        return () => h('div')
      },
    })
    render(Host)

    await waitFor(() => expect(result.rows.value.length).toBeGreaterThan(0))
    const before = requests.length

    vi.useFakeTimers()
    result.table.setGlobalFilter('a')
    result.table.setGlobalFilter('ab')
    vi.advanceTimersByTime(200)
    vi.useRealTimers()

    await waitFor(() => expect(requests.length).toBe(before + 1))
    expect(requests.at(-1)!.searchParams.get('filter')).toBe(
      '[["name","contains","ab"],"or",["manufacturer","contains","ab"]]',
    )
  })

  describe('cache', () => {
    it('forces a network request when refetch is called', async () => {
      let result!: Result
      const Host = defineComponent({
        setup() {
          result = useAspNetDataTable<ProductRow>({ endpoint, columns, cache: true })
          return () => h('div')
        },
      })
      render(Host)
      await waitFor(() => expect(result.rows.value.length).toBeGreaterThan(0))
      const before = requests.length

      result.refetch()

      await waitFor(() => expect(requests.length).toBe(before + 1))
    })

    it('serves cached responses and deduplicates in-flight requests', async () => {
      let result!: Result
      const Host = defineComponent({
        setup() {
          result = useAspNetDataTable<ProductRow>({
            endpoint,
            columns,
            cache: true,
          })
          return () => h('div')
        },
      })
      render(Host)

      await waitFor(() => expect(result.rows.value.length).toBeGreaterThan(0))
      expect(requests.length).toBe(1)

      // Navigate to page 2
      result.table.setPagination({ pageIndex: 1, pageSize: 25 })
      await waitFor(() => expect(requests.length).toBe(2))

      // Go back to page 1 (should hit cache)
      result.table.setPagination({ pageIndex: 0, pageSize: 25 })
      await waitFor(() => expect(requests.length).toBe(2)) // no new request

      // Go to page 2 again (should hit cache)
      result.table.setPagination({ pageIndex: 1, pageSize: 25 })
      await waitFor(() => expect(requests.length).toBe(2)) // no new request
    })

    it('deduplicates simultaneous identical requests', async () => {
      let result!: Result
      const Host = defineComponent({
        setup() {
          result = useAspNetDataTable<ProductRow>({
            endpoint,
            columns,
            cache: true,
          })
          return () => h('div')
        },
      })
      render(Host)

      await waitFor(() => expect(result.rows.value.length).toBeGreaterThan(0))
      const before = requests.length

      // Fire two rapid identical page changes (should dedupe)
      result.table.setPagination({ pageIndex: 1, pageSize: 25 })
      result.table.setPagination({ pageIndex: 1, pageSize: 25 })
      await waitFor(() => expect(requests.length).toBe(before + 1))
    })
  })
})
