import { computed, ref, watch } from 'vue'
import type { Ref } from 'vue'
import type { Table } from '@tanstack/vue-table'
import {
  createAspNetDataAdapter,
  createAspNetDataRequestKey,
  createMemoryCache,
} from 'tanstack-aspnet-data'
import type {
  BuildQueryOptions,
  DataCache,
  FilterOperator,
  MemoryCacheOptions,
  SelectorMapper,
} from 'tanstack-aspnet-data'
import {
  useAspNetDataTableState,
  type UseAspNetDataTableStateOptions,
} from './useAspNetDataTableState'

export interface UseAspNetDataTableOptions<TData> extends UseAspNetDataTableStateOptions<TData> {
  /** Endpoint bound to DevExtreme.AspNet.Data's `DataSourceLoadOptions`. */
  endpoint: string
  /** Set to `false` to pause fetching (defaults to `true`). */
  enabled?: boolean
  /** Enable response caching and request deduplication. */
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

/** Server-side table using the state foundation shared with Vue Query. */
export function useAspNetDataTable<TData>(
  options: UseAspNetDataTableOptions<TData>,
): UseAspNetDataTableResult<TData> {
  const optionsRef = ref(options)
  optionsRef.value = options
  const state = useAspNetDataTableState<TData>(options)
  const reloadNext = ref(false)

  const cacheInstance = computed<DataCache | undefined>(() => {
    const cache = optionsRef.value.cache
    if (!cache) return undefined
    if (typeof cache === 'object' && 'get' in cache && 'set' in cache) return cache as DataCache
    return createMemoryCache(typeof cache === 'object' ? cache : {})
  })

  const requestIdentity = computed(() => {
    const current = optionsRef.value
    return createAspNetDataRequestKey({
      endpoint: current.endpoint,
      method: current.method,
      headers: current.headers,
      state: {
        pagination: state.pagination.value,
        sorting: state.sorting.value,
        columnFilters: state.columnFilters.value,
        globalFilter: state.globalFilter.value,
      },
      buildQuery: {
        textFilterOperator: current.textFilterOperator,
        mapSelector: current.mapSelector,
        globalFilterFields: current.globalFilterFields,
        resolveColumnFilter: current.resolveColumnFilter,
      },
    })
  })

  watch(
    [requestIdentity, () => optionsRef.value.enabled ?? true, state.nonce, cacheInstance],
    async ([, enabled], _previous, onCleanup) => {
      if (!enabled) {
        state.isFetching.value = false
        return
      }

      const controller = new AbortController()
      onCleanup(() => controller.abort())
      state.isFetching.value = true
      state.isError.value = false
      state.error.value = null

      const current = optionsRef.value
      const adapter = createAspNetDataAdapter({
        endpoint: current.endpoint,
        method: current.method,
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
      const cacheMode = reloadNext.value ? 'reload' : 'default'
      reloadNext.value = false

      try {
        const result = await adapter<TData>(
          {
            pagination: state.pagination.value,
            sorting: state.sorting.value,
            columnFilters: state.columnFilters.value,
            globalFilter: state.globalFilter.value,
          },
          controller.signal,
          { cacheMode },
        )
        if (controller.signal.aborted) return
        state.rows.value = result.data
        state.totalCount.value = result.totalCount
      } catch (cause) {
        if (controller.signal.aborted || (cause as Error)?.name === 'AbortError') return
        state.isError.value = true
        state.error.value = cause
      } finally {
        if (!controller.signal.aborted) state.isFetching.value = false
      }
    },
    { immediate: true },
  )

  const refetch = () => {
    reloadNext.value = true
    state.refetch()
  }

  return {
    table: state.table,
    rows: state.rows,
    totalCount: state.totalCount,
    pageCount: state.pageCount,
    isFetching: state.isFetching,
    isError: state.isError,
    error: state.error,
    refetch,
  }
}

export type { BuildQueryOptions, FilterOperator, SelectorMapper }
