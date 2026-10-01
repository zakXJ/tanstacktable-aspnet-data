import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import type {
  ColumnFiltersState,
  PaginationState,
  SortingState,
  Updater,
} from '@tanstack/react-table'
import { decodeTableState, encodeTableState } from 'tanstack-aspnet-data'
import type { UrlSyncOptions } from 'tanstack-aspnet-data'
import { applyUpdater } from './internal'

/**
 * Options of the headless table-state foundation. Fetch-related options
 * (endpoint, transport, TanStack Query settings) live on the consuming hooks
 * (`useAspNetDataTable`, `useAspNetDataQuery`).
 */
export interface UseAspNetDataTableStateOptions {
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
}

export interface UseAspNetDataTableStateReturn {
  pagination: PaginationState
  sorting: SortingState
  columnFilters: ColumnFiltersState
  globalFilter: any
  setPagination: Dispatch<SetStateAction<PaginationState>>
  setSorting: Dispatch<SetStateAction<SortingState>>
  setColumnFilters: Dispatch<SetStateAction<ColumnFiltersState>>
  setGlobalFilter: Dispatch<SetStateAction<any>>
  /**
   * Serialized state — the single fetch trigger. Any change to
   * pagination/sorting/filters produces a new key.
   */
  requestKey: string
  /**
   * Manual fetch generation counter. Bumped by `refetch()`; also re-emits
   * the URL sync so a programmatic refetch refreshes a shared link.
   * Query-based consumers never bump it (their `requestKey` suffices).
   */
  nonce: number
  /** Bump `nonce`, re-running a manual fetch. */
  refetch: () => void
  resetPageIndex: () => void
  onPaginationChange: (updater: Updater<PaginationState>) => void
  onSortingChange: (updater: Updater<SortingState>) => void
  onColumnFiltersChange: (updater: Updater<ColumnFiltersState>) => void
  onGlobalFilterChange: (updater: Updater<any>) => void
}

/**
 * Headless table-state foundation shared by `useAspNetDataTable` (manual
 * fetch) and `useAspNetDataQuery` (TanStack Query). It owns pagination,
 * sorting, filter state, URL synchronization, debounced filter handling and
 * request-key derivation — everything except fetching, which stays with the
 * consuming hooks.
 */
export function useAspNetDataTableState(
  options: UseAspNetDataTableStateOptions = {},
): UseAspNetDataTableStateReturn {
  const {
    resetPageIndexOnChange = true,
    syncUrl = false,
    globalFilterDebounceMs = 0,
    columnFilterDebounceMs = 0,
  } = options

  const urlSync: UrlSyncOptions | null = useMemo(
    () => (typeof syncUrl === 'object' ? syncUrl : syncUrl ? {} : null),
    [syncUrl],
  )
  const urlOptions: UrlSyncOptions | null = useMemo(
    () => (urlSync ? { defaultPageSize: options.initialPagination?.pageSize ?? 25, ...urlSync } : null),
    [urlSync, options.initialPagination?.pageSize],
  )

  const globalFilterTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const columnFilterTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

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
  const [nonce, setNonce] = useState(0)

  // The serialized state is the single fetch trigger: any change to
  // pagination/sorting/filters produces a new key and re-runs consumers.
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

  return {
    pagination,
    sorting,
    columnFilters,
    globalFilter,
    setPagination,
    setSorting,
    setColumnFilters,
    setGlobalFilter,
    requestKey,
    nonce,
    refetch,
    resetPageIndex,
    onPaginationChange,
    onSortingChange,
    onColumnFiltersChange,
    onGlobalFilterChange,
  }
}
