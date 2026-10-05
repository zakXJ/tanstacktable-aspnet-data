// End-to-end smoke test: published-core logic → HTTP → ASP.NET Core → EF Core → SQL.
// Runs against a local API (`dotnet run`, port 5055) in CI, or any URL via E2E_API_URL.
// No dependencies: plain Node 22+ (global fetch), imports the built core dist.
// Exit code is 1 on the first failure; every check prints PASS/FAIL with timing.
import {
  buildQuery,
  createAspNetDataAdapter,
  createMemoryCache,
  queryToSearchParams,
} from '../../packages/core/dist/index.js'

const ENDPOINT = process.env.E2E_API_URL ?? 'http://localhost:5055/api/products'
const MAX_TAKE = Number(process.env.E2E_MAX_TAKE || 0)

const fetchPage = createAspNetDataAdapter({
  endpoint: ENDPOINT,
  buildQuery: {
    mapSelector: (id) =>
      (
        {
          manufacturerName: 'Manufacturer.Name',
          manufacturerRef: 'Manufacturer.Ref',
          manufacturerAddress: 'Manufacturer.Address',
          manufacturerCity: 'Manufacturer.City',
          manufacturerCountry: 'Manufacturer.Country',
          categories: 'CategoryNames',
        }[id] ?? id
      ),
    globalFilterFields: ['Name', 'Manufacturer.Name', 'Manufacturer.Ref', 'CategoryNames'],
  },
})

let failed = 0
async function t(label, fn) {
  const start = Date.now()
  try {
    await fn()
    console.log(`PASS  ${label} (${Date.now() - start}ms)`)
  } catch (e) {
    failed++
    console.log(`FAIL  ${label}: ${e?.name ?? 'Error'} ${e?.message ?? e}`)
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

// Wire format sanity (no HTTP): the exact keys DataSourceLoadOptionsParser reads.
await t('wire format keys (skip/take/sort/filter)', () => {
  const params = queryToSearchParams(
    buildQuery(
      {
        pagination: { pageIndex: 2, pageSize: 50 },
        sorting: [{ id: 'price', desc: true }],
        columnFilters: [{ id: 'name', value: 'abc' }],
      },
      {},
    ),
  )
  assert(params.get('skip') === '100', `skip=${params.get('skip')}`)
  assert(params.get('take') === '50', `take=${params.get('take')}`)
  assert(params.get('requireTotalCount') === 'true', 'requireTotalCount missing')
  assert(JSON.parse(params.get('sort'))[0].selector === 'price', 'sort selector')
  assert(params.get('filter').includes('contains'), 'filter operator')
})

await t('health endpoint', async () => {
  const res = await fetch(ENDPOINT.replace(/\/api\/products\/?$/, '/health'))
  assert(res.ok, `status=${res.status}`)
})

await t('page 3 size 10 (skip=20, totalCount=250)', async () => {
  const r = await fetchPage({ pagination: { pageIndex: 2, pageSize: 10 } })
  assert(r.totalCount === 250, `totalCount=${r.totalCount}`)
  assert(r.data.length === 10, `data.length=${r.data.length}`)
  assert(r.data[0].id === 21, `first id=${r.data[0]?.id}`)
  assert(r.data[0].manufacturer?.name, 'nested manufacturer missing')
})

await t('sort price DESC is server-side', async () => {
  const r = await fetchPage({
    pagination: { pageIndex: 0, pageSize: 5 },
    sorting: [{ id: 'price', desc: true }],
  })
  const prices = r.data.map((p) => p.price)
  const sorted = [...prices].sort((a, b) => b - a)
  assert(JSON.stringify(prices) === JSON.stringify(sorted), `prices not sorted: ${prices}`)
})

await t('sort manufacturerName via mapSelector', async () => {
  const r = await fetchPage({
    pagination: { pageIndex: 0, pageSize: 5 },
    sorting: [{ id: 'manufacturerName' }],
  })
  assert(r.data.length === 5, 'no results')
})

await t('range filter price [300,600]', async () => {
  const r = await fetchPage({
    pagination: { pageIndex: 0, pageSize: 50 },
    columnFilters: [{ id: 'price', value: [300, 600] }],
  })
  const out = r.data.filter((p) => p.price < 300 || p.price > 600)
  assert(out.length === 0, `${out.length} rows out of range`)
  assert(r.totalCount > 0, 'totalCount=0')
})

await t('globalFilter "pump" (OR across fields)', async () => {
  const r = await fetchPage({
    pagination: { pageIndex: 0, pageSize: 20 },
    globalFilter: 'pump',
  })
  assert(r.data.length > 0, 'no results for "pump"')
})

await t('nested filter Manufacturer.Country = USA', async () => {
  const r = await fetchPage({
    pagination: { pageIndex: 0, pageSize: 20 },
    columnFilters: [{ id: 'manufacturerCountry', value: 'USA' }],
  })
  const out = r.data.filter((p) => p.manufacturer.country !== 'USA')
  assert(out.length === 0, `${out.length} non-USA rows`)
})

await t('invalid selector → AspNetDataError 400 (not 500)', async () => {
  try {
    await fetchPage({
      pagination: { pageIndex: 0, pageSize: 5 },
      sorting: [{ id: 'noSuchColumn' }],
    })
    throw new Error('no error thrown for invalid selector')
  } catch (e) {
    assert(e.name === 'AspNetDataError', `wrong error: ${e.name}`)
    assert(e.status === 400, `status=${e.status}, expected 400`)
  }
})

await t('POST method works (same binder)', async () => {
  const post = createAspNetDataAdapter({ endpoint: ENDPOINT, method: 'POST' })
  const r = await post({ pagination: { pageIndex: 0, pageSize: 5 } })
  assert(r.totalCount === 250, `totalCount=${r.totalCount}`)
  assert(r.data.length === 5, `data.length=${r.data.length}`)
})

if (MAX_TAKE > 0) {
  await t(`configured MaxTake caps pages at ${MAX_TAKE}`, async () => {
    const r = await fetchPage({ pagination: { pageIndex: 0, pageSize: MAX_TAKE + 50 } })
    assert(r.data.length === MAX_TAKE, `data.length=${r.data.length}`)
  })
}

await t('cache: identical 2nd fetch = 1 HTTP request', async () => {
  let calls = 0
  const counting = createAspNetDataAdapter({
    endpoint: ENDPOINT,
    cache: createMemoryCache({ ttlMs: 30_000 }),
    fetchImpl: (...a) => {
      calls++
      return fetch(...a)
    },
  })
  const state = { pagination: { pageIndex: 4, pageSize: 10 } }
  await counting(state)
  await counting(state)
  assert(calls === 1, `${calls} requests instead of 1`)
})

console.log(failed ? `\n${failed} CHECK(S) FAILED` : '\nALL E2E CHECKS PASSED')
process.exit(failed ? 1 : 0)
