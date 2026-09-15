import { computed, watch } from 'vue'
import { useQuery } from '@tanstack/vue-query'
import { createAspNetDataAdapter, createMemoryCache } from 'tanstack-aspnet-data'
import type { BuildQueryOptions, DataCache, FilterOperator, LoadResult, MemoryCacheOptions, SelectorMapper } from 'tanstack-aspnet-data'
import { useAspNetDataTableState, type UrlSyncOptions } from './useAspNetDataTableState'

export interface UseAspNetDataQueryOptions<TData> {
  /** Endpoint bound to DevExtreme.AspNet.Data's `DataSourceLoadOptions`. */
  endpoint: string
  columns: import('@tanstack/vue-table').ColumnDef<TData, any>[]
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
  initialPagination?: import('@tanstack/vue-table').PaginationState
  initialSorting?: import('@tanstack/vue-table').SortingState
  initialColumnFilters?: import('@tanstack/vue-table').ColumnFiltersState
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
   * Options passed to the underlying `useQuery` from `@tanstack/vue-query`.
   * Useful for `staleTime`, `gcTime`, `retry`, etc.
   */
  staleTime?: number
  gcTime?: number
  retry?: number | boolean
  enabled?: boolean
}

export interface UseAspNetDataQueryResult<TData> {
  table: import('@tanstack/vue-table').Table<TData>
  rows: import('vue').Ref<TData[]>
  totalCount: import('vue').Ref<number | undefined>
  pageCount: import('vue').Ref<number>
  isFetching: import('vue').Ref<boolean>
  isLoading: import('vue').Ref<boolean>
  isError: import('vue').Ref<boolean>
  error: import('vue').Ref<Error | null>
  refetch: () => Promise<void>
  isStale: import('vue').Ref<boolean>
}

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
  } = options

  // Create or use provided cache instance — computed so it reacts if `cache` option changes
  const cacheInstance = computed<DataCache | undefined>(() => {
    if (!cache) return undefined
    if (typeof cache === 'object' && 'get' in cache && 'set' in cache) {
      return cache as DataCache
    }
    return createMemoryCache(typeof cache === 'object' ? cache : {})
  })

  const state = useAspNetDataTableState<any>({
    columns: options.columns,
    method,
    headers: options.headers,
    fetchImpl: options.fetchImpl,
    textFilterOperator: options.textFilterOperator,
    mapSelector: options.mapSelector,
    globalFilterFields: options.globalFilterFields,
    resolveColumnFilter: options.resolveColumnFilter,
    initialPagination: options.initialPagination,
    initialSorting: options.initialSorting,
    initialColumnFilters: options.initialColumnFilters,
    initialGlobalFilter: options.initialGlobalFilter,
    resetPageIndexOnChange: options.resetPageIndexOnChange,
    syncUrl: options.syncUrl,
    globalFilterDebounceMs: options.globalFilterDebounceMs,
    columnFilterDebounceMs: options.columnFilterDebounceMs,
  })

  const { table } = state

  // Build cache key for queryKey
  const requestKey = computed(() =>
    JSON.stringify({
      pagination: state.pagination.value,
      sorting: state.sorting.value,
      columnFilters: state.columnFilters.value,
      globalFilter: state.globalFilter.value,
    }),
  )

  const queryKey = computed(() => ['aspnet-data', options.endpoint, requestKey.value, state.nonce.value])

  const { data, isFetching, isLoading, isError, error, refetch, isStale } = useQuery<LoadResult<TData>, Error, LoadResult<TData>, (string | number)[]>({
    queryKey,
    queryFn: async ({ signal }) => {
      const adapter = createAspNetDataAdapter({
        endpoint,
        method,
        headers: options.headers,
        fetchImpl: options.fetchImpl,
        buildQuery: {
          textFilterOperator: options.textFilterOperator,
          mapSelector: options.mapSelector,
          globalFilterFields: options.globalFilterFields,
          resolveColumnFilter: options.resolveColumnFilter,
        },
        cache: cacheInstance.value,
      })
      return adapter(
        { pagination: state.pagination.value, sorting: state.sorting.value, columnFilters: state.columnFilters.value, globalFilter: state.globalFilter.value },
        signal,
      )
    },
    staleTime,
    gcTime,
    retry: retry ?? false,
    enabled: enabled ?? true,
  })

  // Sync query result into state so state.table shows correct data and state.pageCount stays in sync
  watch(
    data,
    (val) => {
      if (val) {
        state.rows.value = val.data as any[]
        state.totalCount.value = val.totalCount
      } else {
        state.rows.value = []
        state.totalCount.value = undefined
      }
    },
    { immediate: true },
  )

  const pageCount = computed(() => {
    const pageSize = state.pagination.value.pageSize
    if (!pageSize || pageSize <= 0) return 1
    if (data.value?.totalCount === undefined) return -1
    return Math.max(1, Math.ceil(data.value.totalCount / pageSize))
  })

  return {
    table: state.table,
    rows: computed<TData[]>(() => data.value?.data ?? []),
    totalCount: computed(() => data.value?.totalCount),
    pageCount,
    isFetching,
    isLoading,
    isError,
    error,
    refetch: async () => { await refetch(); },
    isStale,
  }
}

export type { BuildQueryOptions, FilterOperator, SelectorMapper } from 'tanstack-aspnet-data'
