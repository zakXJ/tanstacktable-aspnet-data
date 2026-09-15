/**
 * State shapes are structurally compatible with TanStack Table v8's
 * `PaginationState`, `SortingState` and `ColumnFiltersState` — no dependency
 * on @tanstack/table-core is required.
 */

export interface PaginationState {
  pageIndex: number
  pageSize: number
}

export interface SortingItem {
  id: string
  desc?: boolean
}

/** Alias of TanStack Table's `SortingState`. */
export type SortingState = SortingItem[]

export interface ColumnFilterItem {
  id: string
  value: unknown
}

/** Alias of TanStack Table's `ColumnFiltersState`. */
export type ColumnFiltersState = ColumnFilterItem[]

/**
 * Server-side snapshot of the TanStack Table state that should be applied
 * remotely.
 */
export interface TableStateSnapshot {
  pagination?: Partial<PaginationState>
  sorting?: readonly SortingItem[]
  columnFilters?: readonly ColumnFilterItem[]
  globalFilter?: unknown
}

/**
 * Filter operators supported by DevExtreme.AspNet.Data's expression compiler.
 */
export type FilterOperator =
  | '='
  | '<>'
  | '>'
  | '>='
  | '<'
  | '<='
  | 'contains'
  | 'notcontains'
  | 'startswith'
  | 'endswith'

/** Maps a TanStack column id to the server-side field selector. */
export type SelectorMapper = (columnId: string) => string

export interface BuildQueryOptions {
  /**
   * Operator used for plain string values. Defaults to `'contains'`.
   * Numbers, booleans and dates always use `'='`.
   */
  textFilterOperator?: FilterOperator
  /** Translates column ids into entity selectors before serialization. */
  mapSelector?: SelectorMapper
  /**
   * Fields matched by the global filter (OR-combined). When omitted or empty,
   * the global filter is ignored.
   */
  globalFilterFields?: string[]
  /**
   * Full control escape hatch: return a raw DevExtreme filter condition for a
   * column filter, bypassing the built-in conventions.
   */
  resolveColumnFilter?: (filter: ColumnFilterItem) => unknown
}

/** DevExtreme `SortingInfo`. */
export interface SortInfo {
  selector: string
  desc?: boolean
}

/**
 * Normalized query ready to be sent to an endpoint bound to
 * DevExtreme.AspNet.Data's `DataSourceLoadOptions`.
 */
export interface AspNetDataQuery {
  skip?: number
  take?: number
  requireTotalCount?: boolean
  sort?: SortInfo[]
  filter?: unknown
}

/**
 * Response of `DataSourceLoader.Load` / `LoadAsync`.
 * Key casing is normalized by `parseLoadResult`.
 */
export interface LoadResult<TData = unknown> {
  data: TData[]
  totalCount?: number
  summary?: unknown[]
  groupCount?: number
}
