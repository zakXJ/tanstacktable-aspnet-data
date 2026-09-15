import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getCoreRowModel, useReactTable } from '@tanstack/react-table'
import { createAspNetDataAdapter, createMemoryCache, decodeTableState, encodeTableState } from 'tanstack-aspnet-data'
import type { BuildQueryOptions, DataCache, FilterOperator, LoadResult, MemoryCacheOptions, SelectorMapper, UrlSyncOptions } from 'tanstack-aspnet-data'

export interface UseAspNetDataQueryOptions<TData> {
  /** Endpoint bound to DevExtreme.AspNet.Data's `DataSourceLoadOptions`. */
  endpoint: string
  columns: import('@tanstack/react-table').ColumnDef<TData, any>[]
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
  initialPagination?: import('@tanstack/react-table').PaginationState
  initialSorting?: import('@tanstack/react-table').SortingState
  initialColumnFilters?: import('@tanstack/react-table').ColumnFiltersState
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
}

export interface UseAspNetDataQueryResult<TData> {
  table: import('@tanstack/react-table').Table<TData>
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

function applyUpdater<T>(updater: import('@tanstack/react-table').Updater<T>, old: T): T {
  return typeof updater === 'function' ? (updater as (old: T) => T)(old) : updater
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
    placeholderData,
    select,
    columns,
    globalFilterDebounceMs = 0,
    columnFilterDebounceMs = 0,
    resetPageIndexOnChange = true,
    syncUrl = false,
    headers,
    fetchImpl,
    textFilterOperator,
    mapSelector,
    globalFilterFields,
    resolveColumnFilter,
    initialPagination,
    initialSorting,
    initialColumnFilters,
    initialGlobalFilter,
  } = options

  const urlSync: UrlSyncOptions | null = useMemo(
    () => (typeof syncUrl === 'object' ? syncUrl : syncUrl ? {} : null),
    [syncUrl],
  )
  const urlOptions: UrlSyncOptions | null = useMemo(
    () => (urlSync ? { defaultPageSize: initialPagination?.pageSize ?? 25, ...urlSync } : null),
    [urlSync, initialPagination?.pageSize],
  )

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
    timer: import('react').MutableRefObject<ReturnType<typeof setTimeout> | undefined>,
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

  const [pagination, setPagination] = useState<import('@tanstack/react-table').PaginationState>(
    () => ({
      pageIndex: initialFromUrl.pagination?.pageIndex ?? initialPagination?.pageIndex ?? 0,
      pageSize: initialFromUrl.pagination?.pageSize ?? initialPagination?.pageSize ?? 25,
    }),
  )
  const [sorting, setSorting] = useState<import('@tanstack/react-table').SortingState>(
    () => (initialFromUrl.sorting ? ([...initialFromUrl.sorting] as import('@tanstack/react-table').SortingState) : (initialSorting ?? [])),
  )
  const [columnFilters, setColumnFilters] = useState<import('@tanstack/react-table').ColumnFiltersState>(
    () => (initialFromUrl.columnFilters ? ([...initialFromUrl.columnFilters] as import('@tanstack/react-table').ColumnFiltersState) : (initialColumnFilters ?? [])),
  )
  const [globalFilter, setGlobalFilter] = useState<any>(
    () => (initialFromUrl.globalFilter !== undefined ? initialFromUrl.globalFilter : initialGlobalFilter ?? ''),
  )

  // The serialized state is the single fetch trigger for url sync and queryKey
  const requestKey = useMemo(
    () => JSON.stringify({ pagination, sorting, columnFilters, globalFilter }),
    [pagination, sorting, columnFilters, globalFilter],
  )

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
  }, [requestKey, urlOptions])

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
      if (next.sorting) setSorting([...next.sorting] as import('@tanstack/react-table').SortingState)
      if (next.columnFilters) setColumnFilters([...next.columnFilters] as import('@tanstack/react-table').ColumnFiltersState)
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

  const onPaginationChange = useCallback((updater: import('@tanstack/react-table').Updater<import('@tanstack/react-table').PaginationState>) => {
    setPagination((old) => applyUpdater(updater, old))
  }, [])

  const resetPageIndex = useCallback(() => {
    if (!resetPageIndexOnChange) return
    setPagination((page) => (page.pageIndex === 0 ? page : { ...page, pageIndex: 0 }))
  }, [resetPageIndexOnChange])

  const onSortingChange = useCallback(
    (updater: import('@tanstack/react-table').Updater<import('@tanstack/react-table').SortingState>) => {
      setSorting((old) => applyUpdater(updater, old))
      resetPageIndex()
    },
    [resetPageIndex],
  )

  const onColumnFiltersChange = useCallback(
    (updater: import('@tanstack/react-table').Updater<import('@tanstack/react-table').ColumnFiltersState>) => {
      debounced(columnFilterTimer, columnFilterDebounceMs, () => {
        setColumnFilters((old) => applyUpdater(updater, old))
        resetPageIndex()
      })
    },
    [resetPageIndex, columnFilterDebounceMs],
  )

  const onGlobalFilterChange = useCallback(
    (updater: import('@tanstack/react-table').Updater<any>) => {
      debounced(globalFilterTimer, globalFilterDebounceMs, () => {
        setGlobalFilter((old: any) => applyUpdater(updater, old))
        resetPageIndex()
      })
    },
    [resetPageIndex, globalFilterDebounceMs],
  )

  const { data, isFetching: queryIsFetching, isLoading, isError: queryIsError, error: queryError, refetch: queryRefetch, isStale } = useQuery({
    queryKey: ['aspnet-data', endpoint, requestKey],
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
      return adapter(
        { pagination, sorting, columnFilters, globalFilter },
        signal,
      )
    },
    staleTime,
    gcTime,
    retry: retry ?? false,
    enabled: enabled ?? true,
    placeholderData,
    select,
  })

  const pageCount = useMemo(() => {
    const pageSize = pagination.pageSize
    if (!pageSize || pageSize <= 0) return 1
    if (data?.totalCount === undefined) return -1
    return Math.max(1, Math.ceil(data.totalCount / pageSize))
  }, [data?.totalCount, pagination.pageSize])

  const table = useReactTable({
    data: (data?.data as TData[]) ?? [],
    columns,
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
      await queryRefetch()
    },
    isStale,
  }
}

export type { BuildQueryOptions, FilterOperator, SelectorMapper } from 'tanstack-aspnet-data'
