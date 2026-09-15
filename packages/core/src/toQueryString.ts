import type { AspNetDataQuery } from './types'

/**
 * Serializes a query into URL search params using the exact keys parsed by
 * DevExtreme.AspNet.Data's `DataSourceLoadOptionsParser`. Structured values
 * (`sort`, `filter`) are sent as JSON strings.
 */
export function queryToSearchParams(query: AspNetDataQuery): URLSearchParams {
  const params = new URLSearchParams()
  if (query.skip !== undefined) {
    if (typeof query.skip !== 'number' || !Number.isFinite(query.skip) || !Number.isInteger(query.skip) || query.skip < 0) {
      throw new Error('Invalid skip: must be a non-negative integer')
    }
    params.set('skip', String(query.skip))
  }
  if (query.take !== undefined) {
    if (typeof query.take !== 'number' || !Number.isFinite(query.take) || !Number.isInteger(query.take) || query.take <= 0) {
      throw new Error('Invalid take: must be a positive integer')
    }
    params.set('take', String(query.take))
  }
  if (query.requireTotalCount) params.set('requireTotalCount', 'true')
  if (query.sort && query.sort.length > 0) {
    try {
      params.set('sort', JSON.stringify(query.sort))
    } catch (e) {
      throw new Error(`Invalid sort: ${(e as Error).message}`)
    }
  }
  if (query.filter !== undefined) {
    try {
      const serialized = JSON.stringify(query.filter)
      if (serialized === undefined) throw new Error('filter contains non-serializable value')
      params.set('filter', serialized)
    } catch (e) {
      throw new Error(`Invalid filter: ${(e as Error).message}`)
    }
  }
  return params
}
