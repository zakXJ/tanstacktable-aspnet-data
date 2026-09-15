import { computed, onUnmounted, ref, shallowRef, watch } from 'vue'
import { getCoreRowModel, useVueTable } from '@tanstack/vue-table'
import type {
  ColumnDef,
  ColumnFiltersState,
  PaginationState,
  SortingState,
  Table,
  Updater,
} from '@tanstack/vue-table'
import type { Ref } from 'vue'
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
  rows: Ref<TData[]>
  totalCount: Ref<number | undefined>
  pageCount: Ref<number>
  isFetching: Ref<boolean>
  isError: Ref<boolean>
  error: Ref<unknown>
  refetch: () => void
}

function applyUpdater<T>(updater: Updater<T>, old: T): T {
  return typeof updater === 'function' ? (updater as (old: T) => T)(old) : updater
}

/**
 * Server-side TanStack Table for ASP.NET Core endpoints powered by
 * DevExtreme.AspNet.Data.
 *
 * The composable owns pagination/sorting/filter state, keeps TanStack in
 * manual server-side mode, fetches pages with request cancellation, derives
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
    initialPagination = { pageIndex: 0, pageSize: 25 },
    initialSorting = [],
    initialColumnFilters = [],
    initialGlobalFilter = '',
  } = options

  const urlSync: UrlSyncOptions | null =
    typeof syncUrl === 'object' ? syncUrl : syncUrl ? {} : null
  const urlOptions: UrlSyncOptions | null = urlSync
    ? { defaultPageSize: initialPagination.pageSize ?? 25, ...urlSync }
    : null

  const optionsRef = ref(options)
  optionsRef.value = options

  let globalFilterTimer: ReturnType<typeof setTimeout> | undefined
  let columnFilterTimer: ReturnType<typeof setTimeout> | undefined

  function debounced(
    getTimer: () => ReturnType<typeof setTimeout> | undefined,
    setTimer: (value: ReturnType<typeof setTimeout> | undefined) => void,
    ms: number | undefined,
    action: () => void,
  ) {
    if (ms && ms > 0) {
      const existing = getTimer()
      if (existing) clearTimeout(existing)
      setTimer(setTimeout(action, ms))
    } else {
      action()
    }
  }

  const initialFromUrl =
    urlOptions && typeof window !== 'undefined'
      ? decodeTableState(window.location.search, urlOptions)
      : {}

  const pagination = ref<PaginationState>({
    pageIndex: initialFromUrl.pagination?.pageIndex ?? initialPagination?.pageIndex ?? 0,
    pageSize: initialFromUrl.pagination?.pageSize ?? initialPagination?.pageSize ?? 25,
  })
  const sorting = ref<SortingState>(
    initialFromUrl.sorting ? ([...initialFromUrl.sorting] as SortingState) : initialSorting ?? [],
  )
  const columnFilters = ref<ColumnFiltersState>(
    initialFromUrl.columnFilters ? ([...initialFromUrl.columnFilters] as ColumnFiltersState) : initialColumnFilters ?? [],
  )
  const globalFilter = ref<any>(initialFromUrl.globalFilter !== undefined ? initialFromUrl.globalFilter : initialGlobalFilter ?? '')

  const rows = shallowRef<TData[]>([])
  const totalCount = ref<number>()
  const isFetching = ref(false)
  const isError = ref(false)
  const error = shallowRef<unknown>(null)
  const nonce = ref(0)

  let controller: AbortController | undefined

  const requestKey = computed(() =>
    JSON.stringify({
      pagination: pagination.value,
      sorting: sorting.value,
      columnFilters: columnFilters.value,
      globalFilter: globalFilter.value,
    }),
  )

  // Create or use provided cache instance (reactive to options.cache)
  const cacheInstance = computed<DataCache | undefined>(() => {
    const c = optionsRef.value.cache ?? cache
    if (!c) return undefined
    if (typeof c === 'object' && 'get' in c && 'set' in c) {
      return c as DataCache
    }
    return createMemoryCache(typeof c === 'object' ? c : {})
  })

  async function fetchPage() {
    controller?.abort()
    const localController = (controller = new AbortController())

    isFetching.value = true
    isError.value = false
    error.value = null

    try {
      const current = optionsRef.value
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
        cache: cacheInstance.value,
      })

      const result = await adapter<TData>(
        {
          pagination: pagination.value,
          sorting: sorting.value,
          columnFilters: columnFilters.value,
          globalFilter: globalFilter.value,
        },
        localController.signal,
      )

      if (localController.signal.aborted) return
      rows.value = result.data
      totalCount.value = result.totalCount
    } catch (cause) {
      if (localController.signal.aborted || (cause as Error)?.name === 'AbortError') return
      isError.value = true
      error.value = cause
    } finally {
      if (!localController.signal.aborted) isFetching.value = false
    }
  }

  watch([requestKey, () => ((optionsRef.value.enabled ?? true) ? 1 : 0), nonce], ([, isEnabled]) => {
    if (isEnabled === 1) void fetchPage()
    else isFetching.value = false
  }, { immediate: true })

  // Reflect the current state into the URL when syncUrl is enabled. replaceState
  // (default) avoids polluting history; popstate below re-syncs on back/forward.
  watch([requestKey, nonce], () => {
    if (!urlOptions || typeof window === 'undefined') return
    const params = encodeTableState(
      {
        pagination: pagination.value,
        sorting: sorting.value,
        columnFilters: columnFilters.value,
        globalFilter: globalFilter.value,
      },
      urlOptions,
    )
    const qs = params.toString()
    const url = window.location.pathname + (qs ? `?${qs}` : '') + window.location.hash
    if (urlOptions.mode === 'push') window.history.pushState(null, '', url)
    else window.history.replaceState(null, '', url)
  })

  if (urlOptions && typeof window !== 'undefined') {
    const onPop = () => {
      const next = decodeTableState(window.location.search, urlOptions)
      if (next.pagination) {
        pagination.value = {
          pageIndex: next.pagination.pageIndex ?? 0,
          pageSize: next.pagination.pageSize ?? 25,
        }
      }
      if (next.sorting) sorting.value = next.sorting as SortingState
      if (next.columnFilters) columnFilters.value = next.columnFilters as ColumnFiltersState
      if (next.globalFilter !== undefined) globalFilter.value = next.globalFilter
    }
    window.addEventListener('popstate', onPop)
    onUnmounted(() => window.removeEventListener('popstate', onPop))
  }

  onUnmounted(() => {
    if (globalFilterTimer) clearTimeout(globalFilterTimer)
    if (columnFilterTimer) clearTimeout(columnFilterTimer)
    controller?.abort()
  })

  const refetch = () => {
    nonce.value++
  }

  function resetPageIndex() {
    if (!resetPageIndexOnChange) return
    if (pagination.value.pageIndex !== 0) {
      pagination.value = { ...pagination.value, pageIndex: 0 }
    }
  }

  const table = useVueTable<TData>({
    get data() {
      return rows.value
    },
    get columns() {
      return options.columns
    },
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
    manualSorting: true,
    manualFiltering: true,
    state: {
      get pagination() {
        return pagination.value
      },
      get sorting() {
        return sorting.value as import('@tanstack/vue-table').SortingState
      },
      get columnFilters() {
        return columnFilters.value as import('@tanstack/vue-table').ColumnFiltersState
      },
      get globalFilter() {
        return globalFilter.value
      },
    },
    onPaginationChange: (updater) => {
      pagination.value = applyUpdater(updater, pagination.value)
    },
    onSortingChange: (updater) => {
      sorting.value = applyUpdater(updater, sorting.value)
      resetPageIndex()
    },
    onColumnFiltersChange: (updater) => {
      debounced(
        () => columnFilterTimer,
        (value) => (columnFilterTimer = value),
        columnFilterDebounceMs,
        () => {
          columnFilters.value = applyUpdater(updater, columnFilters.value)
          resetPageIndex()
        },
      )
    },
    onGlobalFilterChange: (updater) => {
      debounced(
        () => globalFilterTimer,
        (value) => (globalFilterTimer = value),
        globalFilterDebounceMs,
        () => {
          globalFilter.value = applyUpdater(updater, globalFilter.value)
          resetPageIndex()
        },
      )
    },
  })

  const pageCount = computed(() => {
    const pageSize = pagination.value.pageSize
    if (!pageSize || pageSize <= 0) return 1
    if (totalCount.value === undefined) return -1
    return Math.max(1, Math.ceil((totalCount.value ?? 0) / pagination.value.pageSize))
  })

  return { table, rows, totalCount, pageCount, isFetching, isError, error, refetch }
}

export type { BuildQueryOptions, FilterOperator, SelectorMapper }