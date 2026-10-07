import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { createAspNetDataAdapter } from '../src/createAspNetDataAdapter'
import { createMemoryCache } from '../src/cache'
import { AspNetDataError } from '../src/errors'

const captured: URL[] = []

const server = setupServer(
  http.get('http://test.local/api/products', ({ request }) => {
    captured.push(new URL(request.url))
    return HttpResponse.json({ data: [{ id: 1 }], totalCount: 123 })
  }),
)

beforeAll(() => server.listen())
afterEach(() => {
  server.resetHandlers()
  captured.length = 0
})
afterAll(() => server.close())

describe('createAspNetDataAdapter — GET', () => {
  it('sends the wire format and normalizes the LoadResult', async () => {
    const adapter = createAspNetDataAdapter({ endpoint: 'http://test.local/api/products' })

    const result = await adapter({
      pagination: { pageIndex: 1, pageSize: 10 },
      sorting: [{ id: 'name', desc: true }],
      columnFilters: [{ id: 'manufacturer', value: 'Medtronic' }],
    })

    const url = captured[0]
    expect(url).toBeDefined()
    expect(url!.searchParams.get('skip')).toBe('10')
    expect(url!.searchParams.get('take')).toBe('10')
    expect(url!.searchParams.get('requireTotalCount')).toBe('true')
    expect(url!.searchParams.get('sort')).toBe('[{"selector":"name","desc":true}]')
    expect(url!.searchParams.get('filter')).toBe('["manufacturer","contains","Medtronic"]')

    expect(result).toEqual({ data: [{ id: 1 }], totalCount: 123 })
  })

  it('throws AspNetDataError with status on HTTP errors', async () => {
    server.use(
      http.get('http://test.local/api/products', () => new HttpResponse(null, { status: 500 })),
    )
    const adapter = createAspNetDataAdapter({ endpoint: 'http://test.local/api/products' })

    await expect(adapter({})).rejects.toMatchObject({
      name: 'AspNetDataError',
      status: 500,
    })
  })

  it('includes the server error body in the thrown message', async () => {
    server.use(
      http.get(
        'http://test.local/api/products',
        () =>
          new HttpResponse(
            JSON.stringify({ errors: { loadOptions: ['Invalid DataSourceLoadOptions'] } }),
            { status: 400, headers: { 'Content-Type': 'application/problem+json' } },
          ),
      ),
    )
    const adapter = createAspNetDataAdapter({ endpoint: 'http://test.local/api/products' })

    await expect(adapter({})).rejects.toMatchObject({
      name: 'AspNetDataError',
      status: 400,
      body: expect.stringContaining('Invalid DataSourceLoadOptions'),
    })
    await expect(adapter({})).rejects.toThrow(/status 400.*Invalid DataSourceLoadOptions/)
  })

  it('propagates abort errors untouched', async () => {
    const controller = new AbortController()
    const adapter = createAspNetDataAdapter({
      endpoint: 'http://test.local/api/products',
      fetchImpl: (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            const error = new Error('The operation was aborted.')
            error.name = 'AbortError'
            reject(error)
          })
        }),
    })

    const promise = adapter({}, controller.signal)
    controller.abort()

    await expect(promise).rejects.toMatchObject({ name: 'AbortError' })
  })
})

describe('createAspNetDataAdapter — POST', () => {
  it('sends the same keys as a form-urlencoded body', async () => {
    let seenBody = ''
    let seenContentType = ''
    server.use(
      http.post('http://test.local/api/products', async ({ request }) => {
        seenContentType = String(request.headers.get('Content-Type'))
        seenBody = await request.text()
        return HttpResponse.json({ data: [], totalCount: 0 })
      }),
    )

    const adapter = createAspNetDataAdapter({
      endpoint: 'http://test.local/api/products',
      method: 'POST',
    })

    const result = await adapter({
      pagination: { pageIndex: 0, pageSize: 5 },
      columnFilters: [{ id: 'price', value: [10, 20] }],
    })

    const body = new URLSearchParams(seenBody)
    expect(seenContentType).toContain('application/x-www-form-urlencoded')
    expect(body.get('skip')).toBe('0')
    expect(body.get('take')).toBe('5')
    expect(body.get('filter')).toBe('[["price",">=",10],"and",["price","<=",20]]')
    expect(result.totalCount).toBe(0)
  })
})

describe('parseLoadResult tolerance', () => {
  it('accepts PascalCase payloads', async () => {
    server.use(
      http.get('http://test.local/api/products', () =>
        HttpResponse.json({ Data: [{ id: 2 }], TotalCount: 42 }),
      ),
    )
    const adapter = createAspNetDataAdapter({ endpoint: 'http://test.local/api/products' })
    const result = await adapter<{ id: number }>({})
    expect(result.data).toEqual([{ id: 2 }])
    expect(result.totalCount).toBe(42)
  })

  it('rejects payloads without a data array', async () => {
    server.use(http.get('http://test.local/api/products', () => HttpResponse.json({ foo: 1 })))
    const adapter = createAspNetDataAdapter({ endpoint: 'http://test.local/api/products' })
    await expect(adapter({})).rejects.toBeInstanceOf(AspNetDataError)
  })
})

describe('cache concurrency', () => {
  it('lets each deduplicated consumer abort independently', async () => {
    let resolveResponse!: (response: Response) => void
    let calls = 0
    const adapter = createAspNetDataAdapter({
      endpoint: 'http://test.local/shared',
      cache: createMemoryCache(),
      fetchImpl: () => {
        calls++
        return new Promise<Response>((resolve) => {
          resolveResponse = resolve
        })
      },
    })
    const first = new AbortController()
    const second = new AbortController()

    const firstResult = adapter({}, first.signal)
    const secondResult = adapter({}, second.signal)
    first.abort()

    await expect(firstResult).rejects.toMatchObject({ name: 'AbortError' })
    resolveResponse(HttpResponse.json({ data: [{ id: 1 }], totalCount: 1 }))
    await expect(secondResult).resolves.toEqual({ data: [{ id: 1 }], totalCount: 1 })
    expect(calls).toBe(1)
  })

  it('does not let a later consumer abort the shared request', async () => {
    let resolveResponse!: (response: Response) => void
    const adapter = createAspNetDataAdapter({
      endpoint: 'http://test.local/shared',
      cache: createMemoryCache(),
      fetchImpl: () => new Promise<Response>((resolve) => { resolveResponse = resolve }),
    })
    const first = new AbortController()
    const second = new AbortController()
    const firstResult = adapter({}, first.signal)
    const secondResult = adapter({}, second.signal)
    second.abort()

    await expect(secondResult).rejects.toMatchObject({ name: 'AbortError' })
    resolveResponse(HttpResponse.json({ data: [{ id: 2 }] }))
    await expect(firstResult).resolves.toEqual({ data: [{ id: 2 }] })
  })

  it('reload bypasses cached and in-flight values and refreshes the cache', async () => {
    let calls = 0
    const adapter = createAspNetDataAdapter({
      endpoint: 'http://test.local/reload',
      cache: createMemoryCache(),
      fetchImpl: async () => HttpResponse.json({ data: [{ id: ++calls }] }),
    })

    await expect(adapter({})).resolves.toEqual({ data: [{ id: 1 }] })
    await expect(adapter({})).resolves.toEqual({ data: [{ id: 1 }] })
    await expect(adapter({}, undefined, { cacheMode: 'reload' })).resolves.toEqual({ data: [{ id: 2 }] })
    await expect(adapter({})).resolves.toEqual({ data: [{ id: 2 }] })
    expect(calls).toBe(2)
  })

  it('shares one cache entry across header-name casing', async () => {
    // Header names are case-insensitive on the wire, so the cache key must be too.
    let calls = 0
    const cache = createMemoryCache()
    const fetchImpl = async () => {
      calls++
      return HttpResponse.json({ data: [], totalCount: 0 })
    }
    const upper = createAspNetDataAdapter({
      endpoint: 'http://test.local/case',
      headers: { Authorization: 't' },
      cache,
      fetchImpl,
    })
    const lower = createAspNetDataAdapter({
      endpoint: 'http://test.local/case',
      headers: { authorization: 't' },
      cache,
      fetchImpl,
    })

    await upper({})
    await lower({})
    expect(calls).toBe(1)
  })
})
