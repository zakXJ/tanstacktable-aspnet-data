/**
 * Internal helpers shared by the public hooks (`useAspNetDataTable`,
 * `useAspNetDataQuery`). Not part of the public API — do not re-export
 * from `index.ts`.
 */
import { useMemo } from 'react'
import { getCoreRowModel, useReactTable } from '@tanstack/react-table'
import type {
  ColumnDef,
  Table,
  Updater,
} from '@tanstack/react-table'
import { createMemoryCache } from 'tanstack-aspnet-data'
import type { DataCache, MemoryCacheOptions } from 'tanstack-aspnet-data'
import type { UseAspNetDataTableStateReturn } from './useAspNetDataTableState'

export function applyUpdater<T>(updater: Updater<T>, old: T): T {
  return typeof updater === 'function' ? (updater as (old: T) => T)(old) : updater
}

/** Creates (or reuses) the response cache. Shared by both fetch strategies. */
export function useCacheInstance(
  cache: boolean | MemoryCacheOptions | DataCache | undefined,
): DataCache | undefined {
  const customCache =
    typeof cache === 'object' && 'get' in cache && 'set' in cache ? (cache as DataCache) : undefined
  const memoryOptions = typeof cache === 'object' && !customCache ? (cache as MemoryCacheOptions) : undefined
  const enabled = cache === true || memoryOptions !== undefined
  const ttlMs = memoryOptions?.ttlMs
  const limit = memoryOptions?.limit
  return useMemo<DataCache | undefined>(() => {
    if (!enabled && !customCache) return undefined
    if (customCache) return customCache
    return createMemoryCache({ ttlMs, limit })
  }, [enabled, customCache, ttlMs, limit])
}

export interface UseAspNetTableArgs<TData> {
  columns: ColumnDef<TData, any>[]
  data: TData[]
  totalCount: number | undefined
  state: UseAspNetDataTableStateReturn
}

/**
 * Assembles the TanStack table instance (manual server-side mode) from
 * shared state plus fetched data. Shared by both fetch strategies.
 */
export function useAspNetTable<TData>(
  args: UseAspNetTableArgs<TData>,
): { table: Table<TData>; pageCount: number } {
  const { columns, data, totalCount, state } = args

  const pageCount = useMemo(() => {
    const pageSize = state.pagination.pageSize
    if (!pageSize || pageSize <= 0) return 1
    if (totalCount === undefined) return -1
    return Math.max(1, Math.ceil(totalCount / pageSize))
  }, [totalCount, state.pagination.pageSize])

  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
    manualSorting: true,
    manualFiltering: true,
    pageCount,
    state: {
      pagination: state.pagination,
      sorting: state.sorting,
      columnFilters: state.columnFilters,
      globalFilter: state.globalFilter,
    },
    onPaginationChange: state.onPaginationChange,
    onSortingChange: state.onSortingChange,
    onColumnFiltersChange: state.onColumnFiltersChange,
    onGlobalFilterChange: state.onGlobalFilterChange,
  })

  return { table, pageCount }
}
