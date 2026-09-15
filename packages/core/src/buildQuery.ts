import type {
  AspNetDataQuery,
  BuildQueryOptions,
  ColumnFilterItem,
  SelectorMapper,
  SortInfo,
  TableStateSnapshot,
} from './types'

type Condition = unknown

const DEFAULT_TEXT_OPERATOR = 'contains'
const ALLOWED_TEXT_OPERATORS = new Set(['contains', 'notcontains', 'startswith', 'endswith', '=', '<>', '>', '>=', '<', '<='])
// Anchored ISO date: YYYY-MM-DD with optional time part, validated month/day range
const ISO_DATE_PATTERN = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])(?:[T ]\S*)?$/

interface ResolvedOptions {
  textOperator: string
  mapSelector?: SelectorMapper
  globalFilterFields: string[]
  resolveColumnFilter?: BuildQueryOptions['resolveColumnFilter']
}

function resolveSelector(columnId: string, mapSelector?: SelectorMapper): string {
  if (!mapSelector) return columnId
  try {
    const mapped = mapSelector(columnId)
    if (typeof mapped !== 'string' || mapped.trim() === '') return columnId
    return mapped
  } catch {
    return columnId
  }
}

function isEmptyValue(value: unknown): boolean {
  if (value === null || value === undefined || value === '') return true
  if (typeof value === 'string' && value.trim() === '') return true
  return false
}

function normalizeScalar(value: unknown): unknown {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw new Error('Invalid Date')
    return value.toISOString()
  }
  return value
}

function isIsoDateString(value: unknown): value is string {
  return typeof value === 'string' && ISO_DATE_PATTERN.test(value)
}

/**
 * A pair is interpreted as a range (between) when both bounds are numbers,
 * Dates or ISO date strings. A nullish bound paired with a range-like bound
 * still yields a half-open range. Any other pair is treated as a set of
 * exact values.
 */
function isRangeBound(value: unknown): boolean {
  if (typeof value === 'number') return Number.isFinite(value)
  if (value instanceof Date) return !Number.isNaN(value.getTime())
  return isIsoDateString(value)
}

function isRangePair(a: unknown, b: unknown): boolean {
  const aEmpty = isEmptyValue(a)
  const bEmpty = isEmptyValue(b)
  if (aEmpty && bEmpty) return false
  if (aEmpty) return isRangeBound(b)
  if (bEmpty) return isRangeBound(a)
  if (typeof a === 'number' && typeof b === 'number') return true
  if (a instanceof Date && b instanceof Date) return true
  return isIsoDateString(a) && isIsoDateString(b)
}

function scalarCondition(selector: string, value: unknown, textOperator: string): Condition {
  switch (typeof value) {
    case 'number':
      if (!Number.isFinite(value)) throw new Error('Invalid number: NaN or Infinity not serializable')
      return [selector, '=', value]
    case 'boolean':
      return [selector, '=', value]
    case 'bigint':
      return [selector, '=', String(value)]
    case 'string':
      return [selector, textOperator, value]
    default:
      return [selector, '=', normalizeScalar(value)]
  }
}

/**
 * Joins conditions with a flat DevExtreme group:
 * `[c1, "and", c2, "and", c3]`. A single condition is returned unwrapped.
 */
function combine(conditions: Condition[], operator: 'and' | 'or'): Condition | undefined {
  if (conditions.length === 0) return undefined
  if (conditions.length === 1) return conditions[0]
  return conditions.flatMap((condition, index) => (index === 0 ? [condition] : [operator, condition]))
}

function rangeCondition(selector: string, from: unknown, to: unknown): Condition | undefined {
  const bounds: Condition[] = []
  if (!isEmptyValue(from)) bounds.push([selector, '>=', normalizeScalar(from)])
  if (!isEmptyValue(to)) bounds.push([selector, '<=', normalizeScalar(to)])
  return combine(bounds, 'and')
}

function inCondition(selector: string, values: readonly unknown[]): Condition | undefined {
  const matches = values
    .filter((value) => !isEmptyValue(value))
    .map((value) => [selector, '=', normalizeScalar(value)])
  return combine(matches, 'or')
}

function columnFilterCondition(filter: ColumnFilterItem, options: ResolvedOptions): Condition | undefined {
  if (options.resolveColumnFilter) {
    const custom = options.resolveColumnFilter(filter)
    if (custom !== undefined && custom !== null) return custom
  }

  if (typeof filter.id !== 'string' || filter.id.trim() === '') return undefined
  const selector = resolveSelector(filter.id.trim(), options.mapSelector)
  const value = filter.value

  if (isEmptyValue(value)) return undefined

  if (Array.isArray(value)) {
    if (value.length === 0) return undefined
    if (value.length === 2 && isRangePair(value[0], value[1])) {
      return rangeCondition(selector, value[0], value[1])
    }
    return inCondition(selector, value)
  }

  return scalarCondition(selector, value, options.textOperator)
}

function globalFilterCondition(globalFilter: unknown, options: ResolvedOptions): Condition | undefined {
  if (isEmptyValue(globalFilter)) return undefined
  if (options.globalFilterFields.length === 0) return undefined

  const conditions: Condition[] = []
  for (const field of options.globalFilterFields) {
    const selector = resolveSelector(field, options.mapSelector)
    if (typeof globalFilter === 'number') {
      if (!Number.isFinite(globalFilter)) continue
      conditions.push([selector, '=', globalFilter])
    } else if (typeof globalFilter === 'boolean') {
      conditions.push([selector, '=', globalFilter])
    } else if (typeof globalFilter === 'bigint') {
      conditions.push([selector, '=', String(globalFilter)])
    } else if (globalFilter instanceof Date) {
      if (Number.isNaN(globalFilter.getTime())) continue
      conditions.push([selector, '=', globalFilter.toISOString()])
    } else if (typeof globalFilter === 'string') {
      conditions.push([selector, options.textOperator, globalFilter])
    } else {
      try {
        const normalized = normalizeScalar(globalFilter)
        conditions.push([selector, '=', normalized])
      } catch {
        // skip invalid scalar (e.g. Invalid Date)
      }
    }
  }
  if (conditions.length === 0) return undefined
  return combine(conditions, 'or')
}

/**
 * Converts a TanStack Table state snapshot into an `AspNetDataQuery` matching
 * the wire format of DevExtreme.AspNet.Data.
 *
 * Conventions:
 * - `pagination` becomes `skip` / `take` (+ `requireTotalCount`);
 * - `sorting` becomes `sort` (`desc` omitted when false);
 * - string column filters use `textFilterOperator` (default `'contains'`),
 *   numbers/booleans/dates use `'='`;
 * - a two-element numeric/date array becomes a between condition;
 * - any other non-empty array becomes an OR-group of equalities;
 * - empty values (`null`, `undefined`, `''`) produce no condition;
 * - the global filter OR-matches every field of `globalFilterFields` and is
 *   AND-combined with the column filters.
 */
export function buildQuery(state: TableStateSnapshot = {}, options: BuildQueryOptions = {}): AspNetDataQuery {
  const rawOperator = options.textFilterOperator ?? DEFAULT_TEXT_OPERATOR
  const validatedOperator = ALLOWED_TEXT_OPERATORS.has(rawOperator) ? rawOperator : DEFAULT_TEXT_OPERATOR
  const resolved: ResolvedOptions = {
    textOperator: validatedOperator,
    mapSelector: options.mapSelector,
    globalFilterFields: options.globalFilterFields ?? [],
    resolveColumnFilter: options.resolveColumnFilter,
  }

  const query: AspNetDataQuery = {}

  const rawPageIndex = state.pagination?.pageIndex ?? 0
  const rawPageSize = state.pagination?.pageSize
  if (
    typeof rawPageSize === 'number' &&
    Number.isFinite(rawPageSize) &&
    Number.isInteger(rawPageSize) &&
    rawPageSize > 0
  ) {
    const pageSize = rawPageSize
    let pageIndex = 0
    if (typeof rawPageIndex === 'number' && Number.isFinite(rawPageIndex) && Number.isInteger(rawPageIndex) && rawPageIndex >= 0) {
      pageIndex = rawPageIndex
    }
    query.skip = pageIndex * pageSize
    query.take = pageSize
    query.requireTotalCount = true
  }

  if (state.sorting && state.sorting.length > 0) {
    const sort = state.sorting
      .filter((item) => typeof item?.id === 'string' && item.id.trim() !== '')
      .map(
        (item): SortInfo => {
          const info: SortInfo = { selector: resolveSelector(item.id.trim(), resolved.mapSelector) }
          if (item.desc === true) info.desc = true
          return info
        },
      )
    if (sort.length > 0) query.sort = sort
  }

  const groups: Condition[] = []

  const globalCondition = globalFilterCondition(state.globalFilter, resolved)
  if (globalCondition !== undefined) groups.push(globalCondition)

  const columnConditions: Condition[] = []
  for (const filter of state.columnFilters ?? []) {
    const condition = columnFilterCondition(filter, resolved)
    if (condition !== undefined) columnConditions.push(condition)
  }
  const columnGroup = combine(columnConditions, 'and')
  if (columnGroup !== undefined) groups.push(columnGroup)

  const filter = combine(groups, 'and')
  if (filter !== undefined) query.filter = filter

  return query
}
