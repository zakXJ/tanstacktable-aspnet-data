import { describe, expect, it } from 'vitest'
import { queryToSearchParams } from '../src/toQueryString'
import { buildQuery } from '../src/buildQuery'

describe('queryToSearchParams', () => {
  it('omits absent keys entirely', () => {
    const params = queryToSearchParams({})
    expect([...params.keys()]).toEqual([])
  })

  it('serializes the full pagination + sorting + filtering snapshot', () => {
    const query = buildQuery({
      pagination: { pageIndex: 2, pageSize: 50 },
      sorting: [
        { id: 'commercialName', desc: false },
        { id: 'price', desc: true },
      ],
      columnFilters: [{ id: 'manufacturer', value: 'Medtronic' }],
    })
    const params = queryToSearchParams(query)

    expect(params.get('skip')).toBe('100')
    expect(params.get('take')).toBe('50')
    expect(params.get('requireTotalCount')).toBe('true')
    expect(params.get('sort')).toBe('[{"selector":"commercialName"},{"selector":"price","desc":true}]')
    expect(params.get('filter')).toBe('["manufacturer","contains","Medtronic"]')
  })

  it('keys are stable and ordered', () => {
    const params = queryToSearchParams(
      buildQuery({
        pagination: { pageIndex: 0, pageSize: 10 },
        sorting: [{ id: 'a' }],
        columnFilters: [{ id: 'b', value: 1 }],
      }),
    )
    expect([...params.keys()]).toEqual(['skip', 'take', 'requireTotalCount', 'sort', 'filter'])
  })

  it('encodes JSON values as single URL-safe strings', () => {
    const params = queryToSearchParams(buildQuery({ columnFilters: [{ id: 'name', value: 'a&b=c' }] }))
    expect(params.get('filter')).toBe('["name","contains","a&b=c"]')
    expect(params.toString()).toContain(encodeURIComponent('["name","contains","a&b=c"]'))
  })
})
