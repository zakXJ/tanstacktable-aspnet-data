import type { TableStateSnapshot } from './types'

export interface UrlSyncOptions {
  /**
   * `'replace'` (default) rewrites the current URL without adding a history
   * entry; `'push'` appends one so the browser back button steps through
   * previous table states.
   */
  mode?: 'replace' | 'push'
  /** Namespaces every param (e.g. `'tbl_'` → `tbl_page`, `tbl_q`…). */
  prefix?: string
  /**
   * Page size treated as "default" and omitted from the URL (default `25`).
   * Pass the hook's effective default so reloads stay consistent.
   */
  defaultPageSize?: number
}

function resolveOptions(syncUrl: boolean | UrlSyncOptions | undefined): UrlSyncOptions | null {
  if (!syncUrl) return null
  return typeof syncUrl === 'object' ? syncUrl : {}
}

function withPrefix(prefix: string | undefined, key: string): string {
  return (prefix ?? '') + key
}

/**
 * Serializes a TanStack Table state snapshot into URL search params using a
 * human-readable format suitable for deep links:
 *
 *   ?page=2&pageSize=10&sort=[{"id":"price","desc":true}]
 *     &filter=[{"id":"name","value":"abc"}]&q=abc
 *
 * Empty values are omitted so the URL stays as short as possible.
 */
export function encodeTableState(state: TableStateSnapshot, options?: boolean | UrlSyncOptions): URLSearchParams {
  const opts = resolveOptions(options) ?? {}
  const prefix = opts.prefix
  const params = new URLSearchParams()

  if (state.pagination) {
    const { pageIndex = 0, pageSize } = state.pagination
    const defaultPageSize = opts.defaultPageSize ?? 25
    if (typeof pageIndex === 'number' && Number.isInteger(pageIndex) && pageIndex > 0) {
      params.set(withPrefix(prefix, 'page'), String(pageIndex + 1))
    }
    if (typeof pageSize === 'number' && Number.isInteger(pageSize) && pageSize > 0 && pageSize !== defaultPageSize) {
      params.set(withPrefix(prefix, 'pageSize'), String(pageSize))
    }
  }

  if (state.sorting && state.sorting.length > 0) {
    const validSorting = state.sorting.filter((s) => typeof (s as any)?.id === 'string' && (s as any).id.trim() !== '')
    if (validSorting.length > 0) {
      try {
        params.set(withPrefix(prefix, 'sort'), JSON.stringify(validSorting))
      } catch {
        // ignore circular
      }
    }
  }

  if (state.columnFilters && state.columnFilters.length > 0) {
    const validFilters = state.columnFilters.filter((f) => typeof (f as any)?.id === 'string' && (f as any).id.trim() !== '')
    if (validFilters.length > 0) {
      try {
        params.set(withPrefix(prefix, 'filter'), JSON.stringify(validFilters))
      } catch {
        // ignore circular
      }
    }
  }

  if (state.globalFilter !== null && state.globalFilter !== undefined && state.globalFilter !== '') {
    const value = state.globalFilter
    // Always JSON-stringify to preserve type on round-trip: "42" -> "\"42\"" vs 42 -> "42"
    try {
      const serialized = JSON.stringify(value)
      if (serialized !== undefined) params.set(withPrefix(prefix, 'q'), serialized)
    } catch {
      // Circular / non-serializable (e.g. Symbol) -> fallback to String
      params.set(withPrefix(prefix, 'q'), String(value))
    }
  }

  return params
}

/**
 * Reverses {@link encodeTableState}. Malformed JSON or out-of-range numeric
 * values are ignored so a hand-edited URL never crashes the table.
 */
export function decodeTableState(
  source: URLSearchParams | string,
  options?: boolean | UrlSyncOptions,
): TableStateSnapshot {
  const opts = resolveOptions(options) ?? {}
  const prefix = opts.prefix
  const params = typeof source === 'string' ? new URLSearchParams(source) : source

  const state: TableStateSnapshot = {}

  const page = params.get(withPrefix(prefix, 'page'))
  const pageSize = params.get(withPrefix(prefix, 'pageSize'))
  if (page !== null || pageSize !== null) {
    const pagination: TableStateSnapshot['pagination'] = {}
    let hasValid = false
    if (page !== null) {
      const trimmed = page.trim()
      const num = Number(trimmed)
      if (Number.isInteger(num) && num >= 1 && String(num) === trimmed) {
        pagination.pageIndex = num - 1
        hasValid = true
      }
    }
    if (pageSize !== null) {
      const trimmed = pageSize.trim()
      const num = Number(trimmed)
      if (Number.isInteger(num) && num > 0 && String(num) === trimmed) {
        pagination.pageSize = num
        hasValid = true
      }
    }
    if (hasValid) state.pagination = pagination
  }

  const sort = params.get(withPrefix(prefix, 'sort'))
  if (sort !== null) {
    try {
      const parsed = JSON.parse(sort)
      if (Array.isArray(parsed)) {
        const valid = (parsed as unknown[]).filter(
          (el) => el !== null && typeof (el as any) === 'object' && typeof (el as any).id === 'string' && (el as any).id.trim() !== '',
        )
        if (valid.length > 0) state.sorting = valid as typeof state.sorting
      }
    } catch {
      /* ignore malformed sort */
    }
  }

  const filter = params.get(withPrefix(prefix, 'filter'))
  if (filter !== null) {
    try {
      const parsed = JSON.parse(filter)
      if (Array.isArray(parsed)) {
        const valid = (parsed as unknown[]).filter(
          (el) => el !== null && typeof (el as any) === 'object' && typeof (el as any).id === 'string' && (el as any).id.trim() !== '',
        )
        if (valid.length > 0) state.columnFilters = valid as typeof state.columnFilters
      }
    } catch {
      /* ignore malformed filter */
    }
  }

  const q = params.get(withPrefix(prefix, 'q'))
  if (q !== null) {
    try {
      state.globalFilter = JSON.parse(q)
    } catch {
      state.globalFilter = q
    }
    // Ensure string values that were JSON-stringified stay strings
    // (already handled by JSON.parse: "\"42\"" -> "42", "\"true\"" -> "true")
  }

  return state
}
