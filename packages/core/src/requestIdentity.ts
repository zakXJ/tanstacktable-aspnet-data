import { buildQuery } from './buildQuery'
import { queryToSearchParams } from './toQueryString'
import type { BuildQueryOptions, TableStateSnapshot } from './types'

interface StableContext {
  seen: WeakMap<object, string>
}

function normalizeStable(value: unknown, path: string, context: StableContext): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (Number.isNaN(value)) return { $number: 'NaN' }
    if (value === Infinity) return { $number: 'Infinity' }
    if (value === -Infinity) return { $number: '-Infinity' }
    if (Object.is(value, -0)) return { $number: '-0' }
    return value
  }
  if (typeof value === 'bigint') return { $bigint: value.toString() }
  if (typeof value === 'undefined') return { $undefined: true }
  if (typeof value === 'symbol') return { $symbol: value.description ?? '' }
  if (typeof value === 'function') return { $function: value.name || 'anonymous' }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? { $date: 'Invalid' } : { $date: value.toISOString() }
  }
  if (typeof value !== 'object') return String(value)

  const previousPath = context.seen.get(value)
  if (previousPath !== undefined) return { $circular: previousPath }
  context.seen.set(value, path)

  if (Array.isArray(value)) {
    return value.map((item, index) => normalizeStable(item, `${path}[${index}]`, context))
  }

  const record = value as Record<string, unknown>
  const normalized: Record<string, unknown> = {}
  for (const key of Object.keys(record).sort()) {
    normalized[key] = normalizeStable(record[key], `${path}.${key}`, context)
  }
  return normalized
}

/** Deterministic serialization for table state, including bigint and Date. */
export function stableSerialize(value: unknown): string {
  return JSON.stringify(normalizeStable(value, '$', { seen: new WeakMap() }))
}

export function createTableStateKey(state: TableStateSnapshot): string {
  return stableSerialize(state)
}

/**
 * Creates a stable, non-cryptographic fingerprint. Header values never appear
 * directly in query keys or development tooling.
 */
export function fingerprintHeaders(headers?: Record<string, string>): string {
  if (!headers) return '0000000000000000'
  // Codepoint comparison (not localeCompare): deterministic across runtimes
  // and locales (e.g. Turkish 'i' collation must not change fingerprints).
  const comparePair = ([aName, aValue]: readonly [string, string], [bName, bValue]: readonly [string, string]) =>
    aName < bName ? -1 : aName > bName ? 1 : aValue < bValue ? -1 : aValue > bValue ? 1 : 0
  const normalized = Object.keys(headers)
    .map((name) => [name.toLowerCase(), String(headers[name])] as const)
    .sort(comparePair)
    .map(([name, value]) => `${name}:${value}\n`)
    .join('')

  let hash = 0xcbf29ce484222325n
  for (let index = 0; index < normalized.length; index++) {
    hash ^= BigInt(normalized.charCodeAt(index))
    hash = BigInt.asUintN(64, hash * 0x100000001b3n)
  }
  return hash.toString(16).padStart(16, '0')
}

export interface AspNetDataRequestKeyOptions {
  endpoint: string
  method?: 'GET' | 'POST'
  headers?: Record<string, string>
  state: TableStateSnapshot
  buildQuery?: BuildQueryOptions
  queryKeyScope?: unknown
}

/** Produces the semantic identity used by framework fetch effects and Query. */
export function createAspNetDataRequestKey(options: AspNetDataRequestKeyOptions): string {
  let wireQuery: string
  try {
    wireQuery = queryToSearchParams(buildQuery(options.state, options.buildQuery)).toString()
  } catch {
    // Invalid state must be surfaced by the adapter, not crash a framework's
    // render phase while deriving its dependency key.
    wireQuery = `invalid:${createTableStateKey(options.state)}`
  }
  // Normalized to uppercase: the adapter treats 'get' and 'GET' as the same
  // wire request, so the identity must too.
  const method = (options.method ?? 'GET').toUpperCase()
  return stableSerialize({
    endpoint: options.endpoint,
    method,
    headers: fingerprintHeaders(options.headers),
    query: wireQuery,
    scope: options.queryKeyScope,
  })
}
