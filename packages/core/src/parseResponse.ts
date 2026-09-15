import { AspNetDataError } from './errors'
import type { LoadResult } from './types'

function readKey(payload: Record<string, unknown>, camelKey: string, pascalKey: string): unknown {
  const value = payload[camelKey] ?? payload[pascalKey]
  return value === null ? undefined : value
}

/**
 * Normalizes a `DataSourceLoader.LoadAsync` response into a `LoadResult`.
 * Tolerates PascalCase payloads (e.g. Newtonsoft.Json defaults) and grouped
 * result items are passed through untouched.
 */
export function parseLoadResult<TData = unknown>(payload: unknown): LoadResult<TData> {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new AspNetDataError('Invalid response: expected a JSON object with a "data" array.')
  }

  const record = payload as Record<string, unknown>
  const data = readKey(record, 'data', 'Data')

  if (!Array.isArray(data)) {
    throw new AspNetDataError('Invalid response: missing "data" array.')
  }

  const totalCount = readKey(record, 'totalCount', 'TotalCount')
  const summary = readKey(record, 'summary', 'Summary')
  const groupCount = readKey(record, 'groupCount', 'GroupCount')

  return {
    data: data as TData[],
    totalCount: typeof totalCount === 'number' ? totalCount : undefined,
    summary: Array.isArray(summary) ? summary : undefined,
    groupCount: typeof groupCount === 'number' ? groupCount : undefined,
  }
}
