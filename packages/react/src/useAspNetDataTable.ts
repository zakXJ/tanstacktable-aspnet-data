import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MutableRefObject } from 'react'
import { getCoreRowModel, useReactTable } from '@tanstack/react-table'
import type {
  ColumnDef,
  ColumnFiltersState,
  PaginationState,
  SortingState,
  Table,
  Updater,
} from '@tanstack/react-table'
import { createAspNetDataAdapter, createMemoryCache, decodeTableState, encodeTableState } from 'tanstack-aspnet-data'
import type { BuildQueryOptions, DataCache, FilterOperator, MemoryCacheOptions, SelectorMapper, UrlSyncOptions } from 'tanstack-aspnet-data'

export interface UseAspNetDataTableOptions<TData> {
  /** Endpoint bound to DevExtreme.AspNet.Data's `DataSourceLoadOptions`. */
  endpoint: string
  columns: ColumnDef<TData, any>[]
  method?: 'GET' | 'POST'
  headers?: Record<string, string>
  fetchImpl?: typeof fetch
  /**
   * Operator for plain string column filters (defaults to `'contains'`).
   * Numbers, booleans and dates always compare with `'='`.
   */
  textFilterOperator?: FilterOperator
  /** Translates TanStack column ids into server-side selectors. */
  mapSelector?: SelectorMapper
  /** Fields matched by the global filter (OR-combined). */
  globalFilterFields?: string[]
  /** Full-control escape hatch for column filters. */
  resolveColumnFilter?: BuildQueryOptions['resolveColumnFilter']
  initialPagination?: PaginationState
  initialSorting?: SortingState
  initialColumnFilters?: ColumnFiltersState
  initialGlobalFilter?: any
  /** Set to `false` to pause fetching (defaults to `true`). */
  enabled?: boolean
  /** Reset to page 0 when sorting or filters change (defaults to `true`). */
  resetPageIndexOnChange?: boolean
  /**
   * Deep-links the table state into the URL. Pass `true` for defaults
   * (`replaceState`) or an object to configure `mode`/`prefix`. Disabled by
   * default — set to `false` (or omit) to keep the URL untouched.
   */
  syncUrl?: boolean | UrlSyncOptions
  /**
   * Debounce (ms) applied to global-filter changes before the request is sent.
   * `0` (default) disables it. Keeps the search input responsive while
   * avoiding one request per keystroke.
   */
  globalFilterDebounceMs?: number
  /**
   * Debounce (ms) applied to column-filter changes. `0` (default) disables it.
   */
  columnFilterDebounceMs?: number
  /**
   * Enable response caching and request deduplication.
   * Pass `true` for default in-memory cache, an object for options, or a custom `DataCache` instance.
   * `false` (default) disables caching.
   */
  cache?: boolean | MemoryCacheOptions | DataCache
}

export interface UseAspNetDataTableResult<TData> {
  table: Table<TData>
  rows: TData[]
  totalCount: number | undefined
  pageCount: number
  isFetching: boolean
  isError: boolean
  error: unknown
  refetch: () => void
}

function applyUpdater<T>(updater: Updater<T>, old: T): T {
  return typeof updater === 'function' ? (updater as (old: T) => T)(old) : updater
}

/**
 * Server-side TanStack Table for ASP.NET Core endpoints powered by
 * DevExtreme.AspNet.Data.
 *
 * The hook owns pagination/sorting/filter state, keeps TanStack in manual
 * server-side mode, fetches pages with request cancellation, derives
 * `pageCount` from `totalCount` and resets to page 0 when sorting or filters
 * change.
 */
export function useAspNetDataTable<TData>(
  options: UseAspNetDataTableOptions<TData>,
): UseAspNetDataTableResult<TData> {
  const {
    endpoint,
    method = 'GET',
    enabled = true,
    resetPageIndexOnChange = true,
    syncUrl = false,
    globalFilterDebounceMs = 0,
    columnFilterDebounceMs = 0,
    cache = false,
  } = options

  const urlSync: UrlSyncOptions | null = useMemo(
    () => (typeof syncUrl === 'object' ? syncUrl : syncUrl ? {} : null),
    [syncUrl],
  )
  const urlOptions: UrlSyncOptions | null = useMemo(
    () => (urlSync ? { defaultPageSize: options.initialPagination?.pageSize ?? 25, ...urlSync } : null),
    [urlSync, options.initialPagination?.pageSize],
  )

  const optionsRef = useRef(options)
  optionsRef.current = options

  const globalFilterTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const columnFilterTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  // Create or use provided cache instance
  const cacheInstance = useMemo<DataCache | undefined>(() => {
    if (!cache) return undefined
    if (typeof cache === 'object' && 'get' in cache && 'set' in cache) {
      return cache as DataCache
    }
    return createMemoryCache(typeof cache === 'object' ? cache : {})
  }, [cache])

  function debounced(
    timer: MutableRefObject<ReturnType<typeof setTimeout> | undefined>,
    ms: number | undefined,
    action: () => void,
  ) {
    if (ms && ms > 0) {
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(action, ms)
    } else {
      action()
    }
  }

  const initialFromUrl =
    urlOptions && typeof window !== 'undefined'
      ? decodeTableState(window.location.search, urlOptions)
      : {}

  const [pagination, setPagination] = useState<PaginationState>(
    () => ({
      pageIndex: initialFromUrl.pagination?.pageIndex ?? options.initialPagination?.pageIndex ?? 0,
      pageSize: initialFromUrl.pagination?.pageSize ?? options.initialPagination?.pageSize ?? 25,
    }),
  )
  const [sorting, setSorting] = useState<SortingState>(
    () => (initialFromUrl.sorting ? ([...initialFromUrl.sorting] as SortingState) : (options.initialSorting ?? [])),
  )
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>(
    () => (initialFromUrl.columnFilters ? ([...initialFromUrl.columnFilters] as ColumnFiltersState) : (options.initialColumnFilters ?? [])),
  )
  const [globalFilter, setGlobalFilter] = useState<any>(
    () => (initialFromUrl.globalFilter !== undefined ? initialFromUrl.globalFilter : options.initialGlobalFilter ?? ''),
  )

  const [rows, setRows] = useState<TData[]>([])
  const [totalCount, setTotalCount] = useState<number>()
  const [isFetching, setIsFetching] = useState(false)
  const [isError, setIsError] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [nonce, setNonce] = useState(0)

  // The serialized state is the single fetch trigger: any change to
  // pagination/sorting/filters produces a new key and re-runs the effect.
  const requestKey = JSON.stringify({ pagination, sorting, columnFilters, globalFilter })

  useEffect(() => {
    if (!enabled) {
      setIsFetching(false)
      return
    }

    const controller = new AbortController()
    setIsFetching(true)
    setIsError(false)
    setError(null)

    const current = optionsRef.current
    const adapter = createAspNetDataAdapter({
      endpoint,
      method,
      headers: current.headers,
      fetchImpl: current.fetchImpl,
      buildQuery: {
        textFilterOperator: current.textFilterOperator,
        mapSelector: current.mapSelector,
        globalFilterFields: current.globalFilterFields,
        resolveColumnFilter: current.resolveColumnFilter,
      },
      cache: cacheInstance,
    })
    adapter<TData>(
      { pagination, sorting, columnFilters, globalFilter },
      controller.signal,
    )
      .then((result) => {
        if (controller.signal.aborted) return
        setRows(result.data)
        setTotalCount(result.totalCount)
        setIsFetching(false)
      })
      .catch((cause) => {
        if (controller.signal.aborted || (cause as Error)?.name === 'AbortError') return
        setIsFetching(false)
        setIsError(true)
        setError(cause)
      })

    return () => controller.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endpoint, method, enabled, requestKey, nonce])

  // Reflect the current state into the URL when syncUrl is enabled. replaceState
  // (default) avoids polluting history; popstate below re-syncs on back/forward.
  useEffect(() => {
    if (!urlOptions || typeof window === 'undefined') return
    const params = encodeTableState({ pagination, sorting, columnFilters, globalFilter }, urlOptions)
    const qs = params.toString()
    const url = window.location.pathname + (qs ? `?${qs}` : '') + window.location.hash
    if (urlOptions.mode === 'push') window.history.pushState(null, '', url)
    else window.history.replaceState(null, '', url)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestKey, nonce, urlOptions])

  useEffect(() => {
    if (!urlOptions || typeof window === 'undefined') return
    const onPop = () => {
      const next = decodeTableState(window.location.search, urlOptions)
      if (next.pagination) {
        setPagination({
          pageIndex: next.pagination.pageIndex ?? 0,
          pageSize: next.pagination.pageSize ?? 25,
        })
      }
      if (next.sorting) setSorting([...next.sorting] as SortingState)
      if (next.columnFilters) setColumnFilters([...next.columnFilters] as ColumnFiltersState)
      if (next.globalFilter !== undefined) setGlobalFilter(next.globalFilter)
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [urlSync])

  useEffect(() => {
    return () => {
      if (globalFilterTimer.current) clearTimeout(globalFilterTimer.current)
      if (columnFilterTimer.current) clearTimeout(columnFilterTimer.current)
    }
  }, [])

  const refetch = useCallback(() => setNonce((value) => value + 1), [])

  const onPaginationChange = useCallback((updater: Updater<PaginationState>) => {
    setPagination((old) => applyUpdater(updater, old))
  }, [])

  const resetPageIndex = useCallback(() => {
    if (!resetPageIndexOnChange) return
    setPagination((page) => (page.pageIndex === 0 ? page : { ...page, pageIndex: 0 }))
  }, [resetPageIndexOnChange])

  const onSortingChange = useCallback(
    (updater: Updater<SortingState>) => {
      setSorting((old) => applyUpdater(updater, old))
      resetPageIndex()
    },
    [resetPageIndex],
  )

  const onColumnFiltersChange = useCallback(
    (updater: Updater<ColumnFiltersState>) => {
      debounced(columnFilterTimer, columnFilterDebounceMs, () => {
        setColumnFilters((old) => applyUpdater(updater, old))
        resetPageIndex()
      })
    },
    [resetPageIndex, columnFilterDebounceMs],
  )

  const onGlobalFilterChange = useCallback(
    (updater: Updater<any>) => {
      debounced(globalFilterTimer, globalFilterDebounceMs, () => {
        setGlobalFilter((old: any) => applyUpdater(updater, old))
        resetPageIndex()
      })
    },
    [resetPageIndex, globalFilterDebounceMs],
  )

  const pageCount = useMemo(() => {
    const pageSize = pagination.pageSize
    if (!pageSize || pageSize <= 0) return 1
    if (totalCount === undefined) return -1
    return Math.max(1, Math.ceil(totalCount / pageSize))
  }, [totalCount, pagination.pageSize])

  const table = useReactTable({
    data: rows,
    columns: options.columns,
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
    manualSorting: true,
    manualFiltering: true,
    pageCount,
    state: { pagination, sorting, columnFilters, globalFilter },
    onPaginationChange,
    onSortingChange,
    onColumnFiltersChange,
    onGlobalFilterChange,
  })

  return { table, rows, totalCount, pageCount, isFetching, isError, error, refetch }
}

export type { BuildQueryOptions, FilterOperator, SelectorMapper }