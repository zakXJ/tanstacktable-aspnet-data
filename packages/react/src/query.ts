import { useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import type {
  ColumnDef,
  ColumnFiltersState,
  PaginationState,
  SortingState,
  Table,
} from '@tanstack/react-table'
import { createAspNetDataAdapter, createAspNetDataRequestKey } from 'tanstack-aspnet-data'
import type { BuildQueryOptions, DataCache, FilterOperator, LoadResult, MemoryCacheOptions, SelectorMapper, UrlSyncOptions } from 'tanstack-aspnet-data'
import { useAspNetDataTableState } from './useAspNetDataTableState'
import { useAspNetTable, useCacheInstance } from './internal'

export interface UseAspNetDataQueryOptions<TData> {
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
   * Optional cache instance for response caching and request deduplication.
   * When provided, identical queries are served from cache and simultaneous
   * identical requests are deduplicated.
   */
  cache?: boolean | MemoryCacheOptions | DataCache
  /**
   * Options passed to the underlying `useQuery` from `@tanstack/react-query`.
   * Useful for `staleTime`, `gcTime`, `retry`, etc.
   */
  staleTime?: number
  gcTime?: number
  retry?: number | boolean
  enabled?: boolean
  placeholderData?: LoadResult<TData>
  select?: (data: LoadResult<TData>) => LoadResult<TData>
  /** Additional cache partition, such as a user or tenant id. */
  queryKeyScope?: unknown
}

export interface UseAspNetDataQueryResult<TData> {
  table: Table<TData>
  rows: TData[]
  totalCount: number | undefined
  pageCount: number
  isFetching: boolean
  isLoading: boolean
  isError: boolean
  error: Error | null
  refetch: () => Promise<void>
  isStale: boolean
}

/**
 * Server-side TanStack Table for ASP.NET Core endpoints, with fetching
 * delegated to TanStack Query.
 *
 * Table state (pagination/sorting/filters, URL sync, debounce) is owned by
 * `useAspNetDataTableState`; this hook adds the `useQuery` fetch layer on
 * top of it. Import from `@tanstack-aspnet-data/react/query` so that
 * `@tanstack/react-query` stays an optional peer.
 */
export function useAspNetDataQuery<TData>(
  options: UseAspNetDataQueryOptions<TData>,
): UseAspNetDataQueryResult<TData> {
  const {
    endpoint,
    method = 'GET',
    cache = false,
    staleTime,
    gcTime,
    retry,
    enabled,
    placeholderData,
    select,
    columns,
    headers,
    fetchImpl,
    textFilterOperator,
    mapSelector,
    globalFilterFields,
    resolveColumnFilter,
  } = options

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

  // Create or use provided cache instance
  const cacheInstance = useCacheInstance(cache)
  const reloadNextRef = useRef(false)
  const requestIdentity = createAspNetDataRequestKey({
    endpoint,
    method,
    headers,
    state: {
      pagination: tableState.pagination,
      sorting: tableState.sorting,
      columnFilters: tableState.columnFilters,
      globalFilter: tableState.globalFilter,
    },
    buildQuery: { textFilterOperator, mapSelector, globalFilterFields, resolveColumnFilter },
    queryKeyScope: options.queryKeyScope,
  })

  const { data, isFetching: queryIsFetching, isLoading, isError: queryIsError, error: queryError, refetch: queryRefetch, isStale } = useQuery({
    queryKey: ['aspnet-data', requestIdentity],
    queryFn: async ({ signal }) => {
      const adapter = createAspNetDataAdapter({
        endpoint,
        method,
        headers,
        fetchImpl,
        buildQuery: {
          textFilterOperator,
          mapSelector,
          globalFilterFields,
          resolveColumnFilter,
        },
        cache: cacheInstance,
      })
      const cacheMode = reloadNextRef.current ? 'reload' : 'default'
      reloadNextRef.current = false
      return adapter(
        {
          pagination: tableState.pagination,
          sorting: tableState.sorting,
          columnFilters: tableState.columnFilters,
          globalFilter: tableState.globalFilter,
        },
        signal,
        { cacheMode },
      )
    },
    staleTime,
    gcTime,
    retry: retry ?? false,
    enabled: enabled ?? true,
    placeholderData,
    select,
  })

  const { table, pageCount } = useAspNetTable({
    columns,
    data: (data?.data as TData[]) ?? [],
    totalCount: data?.totalCount,
    state: tableState,
  })

  return {
    table,
    rows: (data?.data as TData[]) ?? [],
    totalCount: data?.totalCount,
    pageCount,
    isFetching: queryIsFetching,
    isLoading,
    isError: queryIsError,
    error: queryIsError ? (queryError as Error) : null,
    refetch: async () => {
      reloadNextRef.current = true
      await queryRefetch()
    },
    isStale,
  }
}

export type { BuildQueryOptions, FilterOperator, SelectorMapper } from 'tanstack-aspnet-data'
