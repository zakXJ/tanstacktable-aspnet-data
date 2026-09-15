import { computed, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue'
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
import { decodeTableState, encodeTableState } from 'tanstack-aspnet-data'
import type { BuildQueryOptions, FilterOperator, SelectorMapper, UrlSyncOptions } from 'tanstack-aspnet-data'

export { type UrlSyncOptions } from 'tanstack-aspnet-data'

export interface UseAspNetDataTableStateOptions<TData> {
  columns: ColumnDef<TData, any>[]
  method?: 'GET' | 'POST'
  headers?: Record<string, string>
  fetchImpl?: typeof fetch
  textFilterOperator?: FilterOperator
  mapSelector?: SelectorMapper
  globalFilterFields?: string[]
  resolveColumnFilter?: BuildQueryOptions['resolveColumnFilter']
  initialPagination?: PaginationState
  initialSorting?: SortingState
  initialColumnFilters?: ColumnFiltersState
  initialGlobalFilter?: any
  resetPageIndexOnChange?: boolean
  syncUrl?: boolean | UrlSyncOptions
  globalFilterDebounceMs?: number
  columnFilterDebounceMs?: number
}

export interface UseAspNetDataTableStateReturn<TData> {
  table: Table<TData>
  pagination: Ref<PaginationState>
  sorting: Ref<SortingState>
  columnFilters: Ref<ColumnFiltersState>
  globalFilter: Ref<any>
  rows: Ref<TData[]>
  totalCount: Ref<number | undefined>
  isFetching: Ref<boolean>
  isError: Ref<boolean>
  error: Ref<unknown>
  pageCount: Ref<number>
  nonce: Ref<number>
  requestKey: Ref<string>
  refetch: () => void
  onPaginationChange: (updater: Updater<PaginationState>) => void
  onSortingChange: (updater: Updater<SortingState>) => void
  onColumnFiltersChange: (updater: Updater<ColumnFiltersState>) => void
  onGlobalFilterChange: (updater: Updater<any>) => void
  resetPageIndex: () => void
  syncUrl: () => void
  enableUrlSync: () => void
  disableUrlSync: () => void
}

function applyUpdater<T>(updater: Updater<T>, old: T): T {
  return typeof updater === 'function' ? (updater as (old: T) => T)(old) : updater
}

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

/**
 * Shared state logic for TanStack Table with ASP.NET Core backend.
 * Handles pagination, sorting, filtering, URL sync, debounce, and table creation.
 * Does NOT perform data fetching - that's left to the consumer.
 */
export function useAspNetDataTableState<TData>(
  options: UseAspNetDataTableStateOptions<TData>,
): UseAspNetDataTableStateReturn<TData> {
  const {
    columns,
    resetPageIndexOnChange = true,
    syncUrl = false,
    globalFilterDebounceMs = 0,
    columnFilterDebounceMs = 0,
  } = options

  const urlSync: UrlSyncOptions | null =
    typeof syncUrl === 'object' ? syncUrl : syncUrl ? {} : null
  const urlOptions: UrlSyncOptions | null = urlSync
    ? { defaultPageSize: options.initialPagination?.pageSize ?? 25, ...urlSync }
    : null

  const optionsRef = ref(options)
  optionsRef.value = options

  let globalFilterTimer: ReturnType<typeof setTimeout> | undefined
  let columnFilterTimer: ReturnType<typeof setTimeout> | undefined

  const initialFromUrl =
    urlOptions && typeof window !== 'undefined'
      ? decodeTableState(window.location.search, urlOptions)
      : {}

  const pagination = ref<PaginationState>({
    pageIndex: initialFromUrl.pagination?.pageIndex ?? options.initialPagination?.pageIndex ?? 0,
    pageSize: initialFromUrl.pagination?.pageSize ?? options.initialPagination?.pageSize ?? 25,
  })
  const sorting = ref<SortingState>(
    initialFromUrl.sorting ? ([...initialFromUrl.sorting] as SortingState) : options.initialSorting ?? [],
  )
  const columnFilters = ref<ColumnFiltersState>(
    initialFromUrl.columnFilters ? ([...initialFromUrl.columnFilters] as ColumnFiltersState) : options.initialColumnFilters ?? [],
  )
  const globalFilter = ref<any>(initialFromUrl.globalFilter !== undefined ? initialFromUrl.globalFilter : options.initialGlobalFilter ?? '')

  const rows = shallowRef<TData[]>([]) as Ref<TData[]>
  const totalCount = ref<number | undefined>(undefined)
  const isFetching = ref(false)
  const isError = ref(false)
  const error = ref<unknown>(null)
  const nonce = ref(0)

  const pageCount = computed(() => {
    const pageSize = pagination.value.pageSize
    if (!pageSize || pageSize <= 0) return 1
    if (totalCount.value === undefined) return -1
    return Math.max(1, Math.ceil((totalCount.value ?? 0) / pagination.value.pageSize))
  })

  const requestKey = computed(() =>
    JSON.stringify({
      pagination: pagination.value,
      sorting: sorting.value,
      columnFilters: columnFilters.value,
      globalFilter: globalFilter.value,
    }),
  )

  function resetPageIndex() {
    if (!resetPageIndexOnChange) return
    if (pagination.value.pageIndex !== 0) {
      pagination.value = { ...pagination.value, pageIndex: 0 }
    }
  }

  function onPaginationChange(updater: Updater<PaginationState>) {
    pagination.value = applyUpdater(updater, pagination.value)
  }

  function onSortingChange(updater: Updater<SortingState>) {
    sorting.value = applyUpdater(updater, sorting.value)
    resetPageIndex()
  }

  function onColumnFiltersChange(updater: Updater<ColumnFiltersState>) {
    debounced(
      () => columnFilterTimer,
      (value) => (columnFilterTimer = value),
      columnFilterDebounceMs,
      () => {
        columnFilters.value = applyUpdater(updater, columnFilters.value)
        resetPageIndex()
      },
    )
  }

  function onGlobalFilterChange(updater: Updater<any>) {
    debounced(
      () => globalFilterTimer,
      (value) => (globalFilterTimer = value),
      globalFilterDebounceMs,
      () => {
        globalFilter.value = applyUpdater(updater, globalFilter.value)
        resetPageIndex()
      },
    )
  }

  function syncUrlEffect() {
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
  }

  function handlePopState() {
    if (!urlOptions || typeof window === 'undefined') return
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

  function enableUrlSync() {
    if (typeof window !== 'undefined') window.addEventListener('popstate', handlePopState)
  }

  function disableUrlSync() {
    if (typeof window !== 'undefined') window.removeEventListener('popstate', handlePopState)
  }

  // URL sync effect
  watch(
    () => ({ pagination: pagination.value, sorting: sorting.value, columnFilters: columnFilters.value, globalFilter: globalFilter.value }),
    () => {
      if (urlOptions && typeof window !== 'undefined') syncUrlEffect()
    },
    { deep: true },
  )

  // Auto-attach popstate for URL sync (hydratation mount)
  if (urlOptions && typeof window !== 'undefined') {
    onMounted(() => enableUrlSync())
    onUnmounted(() => disableUrlSync())
  }

  // Cleanup timers on unmount
  onUnmounted(() => {
    if (globalFilterTimer) clearTimeout(globalFilterTimer)
    if (columnFilterTimer) clearTimeout(columnFilterTimer)
  })

  const table = useVueTable({
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
    onPaginationChange,
    onSortingChange,
    onColumnFiltersChange,
    onGlobalFilterChange,
  })

  function refetch() {
    nonce.value++
  }

  function syncUrlFn() {
    syncUrlEffect()
  }

  return {
    table,
    pagination,
    sorting,
    columnFilters,
    globalFilter,
    rows,
    totalCount,
    isFetching,
    isError,
    error,
    pageCount,
    nonce,
    requestKey,
    refetch,
    onPaginationChange,
    onSortingChange,
    onColumnFiltersChange,
    onGlobalFilterChange,
    resetPageIndex,
    syncUrl: syncUrlFn,
    enableUrlSync,
    disableUrlSync,
  }
}
