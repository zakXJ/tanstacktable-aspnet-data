import { describe, expect, it } from 'vitest'
import { buildQuery } from '../src/buildQuery'

describe('buildQuery — pagination', () => {
  it('empty state produces an empty query', () => {
    expect(buildQuery({})).toEqual({})
    expect(buildQuery()).toEqual({})
  })

  it('maps pageIndex/pageSize to skip/take with requireTotalCount', () => {
    expect(buildQuery({ pagination: { pageIndex: 2, pageSize: 50 } })).toEqual({
      skip: 100,
      take: 50,
      requireTotalCount: true,
    })
  })

  it('defaults pageIndex to 0 and ignores invalid page sizes', () => {
    expect(buildQuery({ pagination: { pageSize: 25 } })).toEqual({ skip: 0, take: 25, requireTotalCount: true })
    expect(buildQuery({ pagination: { pageIndex: 3, pageSize: 0 } })).toEqual({})
  })
})

describe('buildQuery — sorting', () => {
  it('serializes multi-column sorting, omitting desc when false', () => {
    expect(
      buildQuery({
        sorting: [
          { id: 'commercialName', desc: false },
          { id: 'price', desc: true },
        ],
      }).sort,
    ).toEqual([{ selector: 'commercialName' }, { selector: 'price', desc: true }])
  })

  it('applies mapSelector to sort ids', () => {
    expect(buildQuery({ sorting: [{ id: 'name' }] }, { mapSelector: (id) => `x_${id}` }).sort).toEqual([
      { selector: 'x_name' },
    ])
  })
})

describe('buildQuery — column filters', () => {
  it('uses contains for strings by default', () => {
    expect(buildQuery({ columnFilters: [{ id: 'name', value: 'abc' }] }).filter).toEqual(['name', 'contains', 'abc'])
  })

  it('honors a custom text operator', () => {
    const filter = buildQuery({ columnFilters: [{ id: 'name', value: 'abc' }] }, { textFilterOperator: 'startswith' })
    expect(filter.filter).toEqual(['name', 'startswith', 'abc'])
  })

  it('uses equality for numbers and booleans regardless of text operator', () => {
    expect(buildQuery({ columnFilters: [{ id: 'price', value: 10 }] }).filter).toEqual(['price', '=', 10])
    expect(buildQuery({ columnFilters: [{ id: 'isActive', value: true }] }).filter).toEqual(['isActive', '=', true])
  })

  it('AND-combines multiple column filters in a flat group', () => {
    expect(
      buildQuery({
        columnFilters: [
          { id: 'manufacturer', value: 'Medtronic' },
          { id: 'price', value: 100 },
        ],
      }).filter,
    ).toEqual([['manufacturer', 'contains', 'Medtronic'], 'and', ['price', '=', 100]])
  })

  it('treats numeric/date two-element arrays as ranges', () => {
    expect(buildQuery({ columnFilters: [{ id: 'price', value: [10, 20] }] }).filter).toEqual([
      ['price', '>=', 10],
      'and',
      ['price', '<=', 20],
    ])
    expect(buildQuery({ columnFilters: [{ id: 'createdAt', value: ['2024-01-01', '2024-12-31'] }] }).filter).toEqual([
      ['createdAt', '>=', '2024-01-01'],
      'and',
      ['createdAt', '<=', '2024-12-31'],
    ])
  })

  it('supports half-open ranges', () => {
    expect(buildQuery({ columnFilters: [{ id: 'price', value: [null, 20] }] }).filter).toEqual(['price', '<=', 20])
    expect(buildQuery({ columnFilters: [{ id: 'price', value: [10, undefined] }] }).filter).toEqual(['price', '>=', 10])
  })

  it('treats non-range arrays as OR-groups of equalities', () => {
    expect(buildQuery({ columnFilters: [{ id: 'category', value: ['A', 'B'] }] }).filter).toEqual([
      ['category', '=', 'A'],
      'or',
      ['category', '=', 'B'],
    ])
  })

  it('skips empty values entirely', () => {
    expect(buildQuery({ columnFilters: [{ id: 'name', value: '' }] })).toEqual({})
    expect(buildQuery({ columnFilters: [{ id: 'name', value: null }] })).toEqual({})
    expect(buildQuery({ columnFilters: [{ id: 'name', value: [] }] })).toEqual({})
  })

  it('normalizes Date scalars to ISO strings', () => {
    const date = new Date('2024-06-01T00:00:00.000Z')
    expect(buildQuery({ columnFilters: [{ id: 'createdAt', value: date }] }).filter).toEqual([
      'createdAt',
      '=',
      '2024-06-01T00:00:00.000Z',
    ])
  })

  it('lets resolveColumnFilter bypass all conventions', () => {
    const filter = buildQuery(
      { columnFilters: [{ id: 'name', value: 'abc' }] },
      { resolveColumnFilter: (f) => [f.id, '=', String(f.value).toUpperCase()] },
    )
    expect(filter.filter).toEqual(['name', '=', 'ABC'])
  })

  it('applies mapSelector to filter ids', () => {
    expect(
      buildQuery({ columnFilters: [{ id: 'manufacturer', value: 'X' }] }, { mapSelector: (id) => id.toUpperCase() })
        .filter,
    ).toEqual(['MANUFACTURER', 'contains', 'X'])
  })
})

describe('buildQuery — global filter', () => {
  it('OR-matches every globalFilterField', () => {
    expect(
      buildQuery({ globalFilter: 'med' }, { globalFilterFields: ['name', 'manufacturer'] }).filter,
    ).toEqual([['name', 'contains', 'med'], 'or', ['manufacturer', 'contains', 'med']])
  })

  it('is ignored without globalFilterFields', () => {
    expect(buildQuery({ globalFilter: 'med' })).toEqual({})
  })

  it('combines global and column filters under a root AND', () => {
    expect(
      buildQuery(
        {
          globalFilter: 'med',
          columnFilters: [{ id: 'category', value: 'Cardio' }],
        },
        { globalFilterFields: ['name', 'manufacturer'] },
      ).filter,
    ).toEqual([[['name', 'contains', 'med'], 'or', ['manufacturer', 'contains', 'med']], 'and', [
      'category',
      'contains',
      'Cardio',
    ]])
  })

  it('ignores empty global filters', () => {
    expect(buildQuery({ globalFilter: '' }, { globalFilterFields: ['name'] })).toEqual({})
  })
})
