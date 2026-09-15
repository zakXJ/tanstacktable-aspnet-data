# tanstack-aspnet-data

Framework-agnostic core of the TanStack Table ↔ ASP.NET Core bridge.

It converts a TanStack Table state snapshot into the exact wire format parsed
by [DevExtreme.AspNet.Data](https://github.com/DevExpress/DevExtreme.AspNet.Data)'s
`DataSourceLoadOptions`, and normalizes the `LoadResult` response.

```ts
import { createAspNetDataAdapter } from 'tanstack-aspnet-data'

const fetchPage = createAspNetDataAdapter({
  endpoint: '/api/products',
  buildQuery: { globalFilterFields: ['name', 'manufacturer'] },
})

const result = await fetchPage(
  {
    pagination: { pageIndex: 2, pageSize: 50 },
    sorting: [{ id: 'commercialName', desc: false }],
    columnFilters: [{ id: 'manufacturer', value: 'Medtronic' }],
  },
  abortSignal,
)
// => GET /api/products?skip=100&take=50&requireTotalCount=true
//      &sort=[{"selector":"commercialName"}]
//      &filter=["manufacturer","contains","Medtronic"]
```

### URL state helpers

`encodeTableState` / `decodeTableState` serialize a `TableStateSnapshot` to and
from a human-readable `URLSearchParams` (`page`, `pageSize`, `sort`, `filter`,
`q`). They power the `syncUrl` option in the React/Vue hooks but are exported
for custom use too.

```ts
import { decodeTableState, encodeTableState } from 'tanstack-aspnet-data'

const params = encodeTableState(
  { pagination: { pageIndex: 1, pageSize: 10 }, globalFilter: 'abc' },
  { prefix: 'tbl_' },
)
// => "tbl_page=2&tbl_pageSize=10&tbl_q=abc"

decodeTableState(params, { prefix: 'tbl_' })
// => { pagination: { pageIndex: 1, pageSize: 10 }, globalFilter: 'abc' }
```

See the repository README for the React and Vue hooks.
