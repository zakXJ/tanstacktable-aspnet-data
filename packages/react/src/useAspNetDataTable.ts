import { useEffect, useRef, useState } from 'react'
import type {
  ColumnDef,
  ColumnFiltersState,
  PaginationState,
  SortingState,
  Table,
} from '@tanstack/react-table'
import { createAspNetDataAdapter } from 'tanstack-aspnet-data'
import type { BuildQueryOptions, DataCache, FilterOperator, MemoryCacheOptions, SelectorMapper, UrlSyncOptions } from 'tanstack-aspnet-data'
import { useAspNetDataTableState } from './useAspNetDataTableState'
import { useAspNetTable, useCacheInstance } from './internal'

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

/**
 * Server-side TanStack Table for ASP.NET Core endpoints powered by
 * DevExtreme.AspNet.Data.
 *
 * Table state (pagination/sorting/filters, URL sync, debounce) is owned by
 * `useAspNetDataTableState`; this hook adds manual fetching with request
 * cancellation on top of it.
 */
export function useAspNetDataTable<TData>(
  options: UseAspNetDataTableOptions<TData>,
): UseAspNetDataTableResult<TData> {
  const {
    endpoint,
    method = 'GET',
    enabled = true,
    cache = false,
  } = options

  const [rows, setRows] = useState<TData[]>([])
  const [totalCount, setTotalCount] = useState<number>()
  const [isFetching, setIsFetching] = useState(false)
  const [isError, setIsError] = useState(false)
  const [error, setError] = useState<unknown>(null)

  const tableState = useAspNetDataTableState({
    initialPagination: options.initialPagination,
    initialSorting: options.initialSorting,
    initialColumnFilters: options.initialColumnFilters,
    initialGlobalFilter: options.initialGlobalFilter,
    resetPageIndexOnChange: options.resetPageIndexOnChange,
    syncUrl: options.syncUrl,
    globalFilterDebounceMs: options.globalFilterDebounceMs,
    columnFilterDebounceMs: options.columnFilterDebounceMs,
  })

  const optionsRef = useRef(options)
  optionsRef.current = options

  // Create or use provided cache instance
  const cacheInstance = useCacheInstance(cache)

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
      {
        pagination: tableState.pagination,
        sorting: tableState.sorting,
        columnFilters: tableState.columnFilters,
        globalFilter: tableState.globalFilter,
      },
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
  }, [endpoint, method, enabled, tableState.requestKey, tableState.nonce])

  const { table, pageCount } = useAspNetTable({
    columns: options.columns,
    data: rows,
    totalCount,
    state: tableState,
  })

  return { table, rows, totalCount, pageCount, isFetching, isError, error, refetch: tableState.refetch }
}

export type { BuildQueryOptions, FilterOperator, SelectorMapper }
