import { describe, expect, it } from 'vitest'
import {
  createAspNetDataRequestKey,
  createTableStateKey,
  fingerprintHeaders,
  stableSerialize,
} from '../src/requestIdentity'

describe('request identity', () => {
  it('serializes bigint, Date and circular values without throwing', () => {
    const circular: Record<string, unknown> = { value: 1n, date: new Date('2025-01-02T00:00:00Z') }
    circular.self = circular
    const serialized = stableSerialize(circular)
    expect(serialized).toContain('$bigint')
    expect(serialized).toContain('$date')
    expect(serialized).toContain('$circular')
    expect(() => createTableStateKey({ globalFilter: 42n })).not.toThrow()
  })

  it('normalizes object and header ordering', () => {
    expect(stableSerialize({ b: 2, a: 1 })).toBe(stableSerialize({ a: 1, b: 2 }))
    expect(fingerprintHeaders({ Authorization: 'token', Accept: 'json' })).toBe(
      fingerprintHeaders({ accept: 'json', authorization: 'token' }),
    )
  })

  it('does not expose header values in request keys', () => {
    const key = createAspNetDataRequestKey({
      endpoint: '/api/products',
      headers: { Authorization: 'Bearer super-secret' },
      state: {},
    })
    expect(key).not.toContain('super-secret')
  })

  it('distinguishes method, headers, effective query and explicit scope', () => {
    const base = { endpoint: '/api/products', state: { globalFilter: 'pump' } }
    const get = createAspNetDataRequestKey({ ...base, buildQuery: { globalFilterFields: ['name'] } })
    const post = createAspNetDataRequestKey({ ...base, method: 'POST', buildQuery: { globalFilterFields: ['name'] } })
    const header = createAspNetDataRequestKey({ ...base, headers: { 'X-Tenant': 'a' }, buildQuery: { globalFilterFields: ['name'] } })
    const mapping = createAspNetDataRequestKey({ ...base, buildQuery: { globalFilterFields: ['title'] } })
    const scope = createAspNetDataRequestKey({ ...base, buildQuery: { globalFilterFields: ['name'] }, queryKeyScope: 'user-2' })
    expect(new Set([get, post, header, mapping, scope])).toHaveLength(5)
  })

  it('normalizes method casing in request keys', () => {
    const base = { endpoint: '/api/products', state: {} }
    expect(createAspNetDataRequestKey({ ...base, method: 'get' as 'GET' })).toBe(
      createAspNetDataRequestKey({ ...base, method: 'GET' }),
    )
  })

  it('sorts headers by codepoint, independent of runtime locale', () => {
    // Golden value: locks the exact ordering + FNV-1a output so any
    // accidental change (e.g. back to localeCompare, which collates
    // differently per runtime locale) fails loudly.
    expect(
      fingerprintHeaders({ 'X-Zebra': '1', 'X-apple': '2', Accept: 'json' }),
    ).toBe('b8e8707b5870d724')
    // Order independence holds regardless of input order.
    expect(
      fingerprintHeaders({ 'X-Zebra': '1', 'X-apple': '2' }),
    ).toBe(fingerprintHeaders({ 'X-apple': '2', 'X-Zebra': '1' }))
  })
})
