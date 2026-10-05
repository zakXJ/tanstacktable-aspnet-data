import { describe, expect, it } from 'vitest'
import { decodeTableState, encodeTableState, mergeTableStateSearchParams } from '../src/urlState'
import type { TableStateSnapshot } from '../src/types'

describe('encodeTableState', () => {
  it('omits empty state into an empty param set', () => {
    expect(encodeTableState({}).toString()).toBe('')
  })

  it('uses 1-based page and skips default page size', () => {
    const params = encodeTableState({ pagination: { pageIndex: 1, pageSize: 25 } })
    expect(params.get('page')).toBe('2')
    expect(params.has('pageSize')).toBe(false)
  })

  it('serializes sorting, filters and global search', () => {
    const state: TableStateSnapshot = {
      sorting: [{ id: 'price', desc: true }],
      columnFilters: [{ id: 'name', value: 'abc' }],
      globalFilter: 'hello',
    }
    const params = encodeTableState(state)
    expect(params.get('sort')).toBe('[{"id":"price","desc":true}]')
    expect(params.get('filter')).toBe('[{"id":"name","value":"abc"}]')
    expect(params.get('q')).toBe('"hello"')
  })

  it('respects a prefix', () => {
    const params = encodeTableState({ pagination: { pageIndex: 2, pageSize: 10 } }, { prefix: 'tbl_' })
    expect(params.get('tbl_page')).toBe('3')
    expect(params.get('tbl_pageSize')).toBe('10')
  })

  it('serializes non-string global filter as JSON', () => {
    const params = encodeTableState({ globalFilter: 42 })
    expect(params.get('q')).toBe('42')
    expect(decodeTableState(params).globalFilter).toBe(42)
  })
})

describe('decodeTableState', () => {
  it('round-trips a full state', () => {
    const state: TableStateSnapshot = {
      pagination: { pageIndex: 3, pageSize: 50 },
      sorting: [{ id: 'price', desc: true }],
      columnFilters: [{ id: 'name', value: 'abc' }],
      globalFilter: 'search',
    }
    const decoded = decodeTableState(encodeTableState(state))
    expect(decoded).toEqual(state)
  })

  it('ignores malformed JSON without throwing', () => {
    const decoded = decodeTableState('?sort=not-json&filter=[oops&q=ok')
    expect(decoded.sorting).toBeUndefined()
    expect(decoded.columnFilters).toBeUndefined()
    expect(decoded.globalFilter).toBe('ok')
  })

  it('falls back to defaults for out-of-range numbers', () => {
    const decoded = decodeTableState('?page=0&pageSize=-5')
    expect(decoded.pagination?.pageIndex).toBeUndefined()
    expect(decoded.pagination?.pageSize).toBeUndefined()
  })

  it('applies the prefix when decoding', () => {
    const params = new URLSearchParams('tbl_page=2&tbl_q=abc')
    const decoded = decodeTableState(params, { prefix: 'tbl_' })
    expect(decoded.pagination?.pageIndex).toBe(1)
    expect(decoded.globalFilter).toBe('abc')
  })
})

describe('mergeTableStateSearchParams', () => {
  it('preserves unrelated parameters while replacing owned state', () => {
    const merged = mergeTableStateSearchParams(
      '?tab=details&page=9&q=%22old%22&utm_source=test',
      { pagination: { pageIndex: 1, pageSize: 25 }, globalFilter: 'new' },
    )
    expect(merged.get('tab')).toBe('details')
    expect(merged.get('utm_source')).toBe('test')
    expect(merged.get('page')).toBe('2')
    expect(merged.get('q')).toBe('"new"')
  })

  it('does not disturb another table prefix', () => {
    const merged = mergeTableStateSearchParams(
      '?left_page=2&right_page=4&right_q=%22keep%22',
      { pagination: { pageIndex: 4, pageSize: 25 } },
      { prefix: 'left_' },
    )
    expect(merged.get('left_page')).toBe('5')
    expect(merged.get('right_page')).toBe('4')
    expect(merged.get('right_q')).toBe('"keep"')
  })

  it('removes owned parameters when state returns to defaults', () => {
    const merged = mergeTableStateSearchParams('?page=3&sort=[]&other=1', {
      pagination: { pageIndex: 0, pageSize: 25 },
    })
    expect(merged.toString()).toBe('other=1')
  })
})
