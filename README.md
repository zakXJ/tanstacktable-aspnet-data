# tanstack-aspnet-data

[![npm version](https://img.shields.io/npm/v/tanstack-aspnet-data.svg)](https://www.npmjs.com/package/tanstack-aspnet-data)
[![npm version](https://img.shields.io/npm/v/@tanstack-aspnet-data/react.svg?label=react)](https://www.npmjs.com/package/@tanstack-aspnet-data/react)
[![npm version](https://img.shields.io/npm/v/@tanstack-aspnet-data/vue.svg?label=vue)](https://www.npmjs.com/package/@tanstack-aspnet-data/vue)
[![CI](https://github.com/zakXJ/tanstacktable-aspnet-data/actions/workflows/ci.yml/badge.svg)](https://github.com/zakXJ/tanstacktable-aspnet-data/actions/workflows/ci.yml)
[![npm downloads](https://img.shields.io/npm/dm/tanstack-aspnet-data.svg)](https://www.npmjs.com/package/tanstack-aspnet-data)
[![license](https://img.shields.io/npm/l/tanstack-aspnet-data.svg)](./LICENSE)

**Server-side data adapter for TanStack Table + ASP.NET Core.**

> **Live demo:** [React demo](https://tanstack-react-demo.vercel.app) · [Vue demo](https://tanstack-vue-demo.vercel.app) · [API (Railway)](https://tanstack-aspnet-data-production.up.railway.app/api/products?skip=0&take=5&requireTotalCount=true)

Turns TanStack Table state into [DevExtreme.AspNet.Data](https://github.com/DevExpress/DevExtreme.AspNet.Data)
queries — so filtering, sorting and paging are executed **in SQL by EF Core**
(PostgreSQL, SQL Server, SQLite…). No DevExtreme UI involved.

```
TanStack Table
      ↓
tanstack-aspnet-data          ← this library (TypeScript)
      ↓
DevExtreme.AspNet.Data        ← battle-tested IQueryable engine (NuGet)
      ↓
EF Core
      ↓
PostgreSQL / SQL Server / SQLite
```

## The problem it solves

With TanStack Table in server-side mode, *you* have to build everything around it.
This library removes that entire layer:

**Before**

```
TanStack Table
      ↓
manual serialization of pagination/sorting/filters
      ↓
custom API parameters
      ↓
custom filtering logic
      ↓
custom sorting logic
      ↓
custom pagination logic
      ↓
manual totalCount handling
```

**After**

```
TanStack Table
      ↓
useAspNetDataTable()          ← one hook
      ↓
DevExtreme.AspNet.Data
      ↓
EF Core
```

## Packages

| Package | Description |
| --- | --- |
| [`tanstack-aspnet-data`](./packages/core) | Framework-agnostic core: query builder, transport, response normalization |
| [`@tanstack-aspnet-data/react`](./packages/react) | `useAspNetDataTable()` for React |
| [`@tanstack-aspnet-data/vue`](./packages/vue) | `useAspNetDataTable()` for Vue 3 |

## Requirements

| Dependency | Version |
| --- | --- |
| `@tanstack/react-table` / `@tanstack/vue-table` | `^8.13` |
| `react` | `^18 \|\| ^19` |
| `vue` | `^3.4` |
| `@tanstack/react-query` / `@tanstack/vue-query` | `^5`, optional (`/query` entry point only) |
| `DevExtreme.AspNet.Data` (server) | `5.1.0` |
| .NET (example API) | `net10.0` |
| Node (build/test) | `>=18` |

## Quick start

### Client

```bash
npm install @tanstack-aspnet-data/react @tanstack/react-table react
# or for Vue: npm install @tanstack-aspnet-data/vue @tanstack/vue-table vue
```

```tsx
import { useAspNetDataTable } from '@tanstack-aspnet-data/react'

const { table, rows, totalCount, pageCount, isFetching } = useAspNetDataTable({
  endpoint: '/api/products',
  columns,
  globalFilterFields: ['name', 'manufacturer'],
})
```

The hook manages everything server-side: pagination state, multi-column
sorting, column filters, global search, request cancellation, page-count
derivation and page reset on filter changes. Render `table.getHeaderGroups()`
and `table.getRowModel().rows` with `flexRender` as usual — TanStack stays
headless, you keep your own UI.

Vue is identical (`@tanstack-aspnet-data/vue`), with refs instead of state.

`useAspNetDataQuery` variants delegate fetching to TanStack Query and live in
separate entry points (`@tanstack-aspnet-data/react/query`,
`@tanstack-aspnet-data/vue/query`), so `@tanstack/react-query` /
`@tanstack/vue-query` stay genuinely optional peers — importing the package
root never requires them. See the React/Vue package READMEs for details.

Cached requests are deduplicated without coupling consumer cancellation: each
caller can abort independently while the shared network request completes and
warms the cache. Calling `refetch()` always bypasses cached and in-flight data,
then replaces the cached value with the fresh response.

### Server

```csharp
// Model binder: copy DataSourceLoadOptions.cs from examples/api
// (adapted from DevExpress' MIT sample).

[HttpGet]
public async Task<IActionResult> Get(DataSourceLoadOptions loadOptions) {
    loadOptions.StringToLower = true; // case-insensitive contains()

    // Nested + collection selectors are translated to JOINs by EF Core.
    // Use mapSelector on the client: manufacturerName → Manufacturer.Name
    var source = _db.Products.Select(p => new {
        p.Id,
        p.Name,
        Manufacturer = new { p.Manufacturer.Name, p.Manufacturer.Ref, p.Manufacturer.City, p.Manufacturer.Country },
        p.CategoryNames, // denormalized for collection filtering via contains
        p.Price,
        p.UnitsInStock,
        p.IsActive,
        p.CreatedAt,
    });

    return Ok(await DataSourceLoader.LoadAsync(source, loadOptions));
}
```

That's the whole server. Filtering, sorting, paging happen in SQL.

## Wire format

The adapter speaks the exact protocol parsed by `DataSourceLoadOptionsParser`:

```
GET /api/products?skip=100&take=50&requireTotalCount=true
    &sort=[{"selector":"commercialName"},{"selector":"price","desc":true}]
    &filter=[[["name","contains","abc"],"or",["manufacturer","contains","abc"]],"and",["price",">=",300]]
```

Response: `{ "data": [...], "totalCount": 1234 }` (PascalCase payloads are
normalized too).

Failed statuses throw `AspNetDataError` carrying the HTTP `status` and, when
the server sent one, the raw response body — truncated to 2000 characters,
appended to the message and also available as `error.body`. In production,
make sure the API returns generic error payloads (the example endpoint
answers `{ "error": "Invalid data query." }`) so no stack trace or business
detail leaks into logs or the UI through that channel.

### Filter conventions

| TanStack column filter value | DevExtreme condition |
| --- | --- |
| `"text"` (string) | `[field, "contains", value]` — operator configurable via `textFilterOperator` |
| `42`, `true`, `Date` | `[field, "=", value]` (dates serialized as ISO) |
| `[10, 20]` (numbers/dates/ISO strings) | between: `[[field,">=",10],"and",[field,"<=",20]]` — half-open ranges supported |
| `["A","B","C"]` (other arrays) | OR-group of equalities |
| `null`, `undefined`, `""`, `[]` | no condition sent |

The global filter OR-matches every field listed in `globalFilterFields`,
then is AND-combined with column filters. Need something else?
`resolveColumnFilter(filter)` gives you raw control per column.

## Hook options

| Option | Default | Description |
| --- | --- | --- |
| `endpoint` | — | URL bound to `DataSourceLoadOptions` |
| `columns` | — | TanStack `ColumnDef[]` |
| `method` | `'GET'` | `'POST'` sends the same keys as a form-urlencoded body (no URL length limits, same model binder) |
| `globalFilterFields` | `[]` | Fields matched by the global search |
| `textFilterOperator` | `'contains'` | Operator for string values |
| `mapSelector` | identity | Column id → entity selector |
| `resolveColumnFilter` | — | Per-column escape hatch returning a raw condition |
| `initialPagination` / `initialSorting` / `initialColumnFilters` / `initialGlobalFilter` | — | Initial state |
| `enabled` | `true` | Pause fetching |
| `resetPageIndexOnChange` | `true` | Back to page 0 when sorting/filters change |
| `syncUrl` | `false` | Mirror table state into the URL (`true`, or `{ mode: 'replace' \| 'push', prefix, defaultPageSize }`) |
| `globalFilterDebounceMs` / `columnFilterDebounceMs` | `0` | Delay requests until typing stops (`0` = immediate) |
| `cache` | `false` | `true` for default in-memory cache, object for options, or custom `DataCache` |

`syncUrl` preserves query parameters owned by the rest of the application.
Back/forward navigation also resets table fields that disappear from the URL.
Query-based hooks accept `queryKeyScope` to partition data by user or tenant;
their keys already include the endpoint, method, effective wire query and a
non-plaintext fingerprint of request headers.

Returns `{ table, rows, totalCount, pageCount, isFetching, isError, error, refetch }`.

## Examples

[`examples/`](./examples) contains a runnable end-to-end stack.

Live (prod API on Railway):

- React: https://tanstack-react-demo.vercel.app
- Vue: https://tanstack-vue-demo.vercel.app
- API: https://tanstack-aspnet-data-production.up.railway.app/api/products?skip=0&take=5&requireTotalCount=true

Local:

```bash
cd examples/api && dotnet run     # ASP.NET Core + EF Core + SQLite on :5055 (250 seeded products)
pnpm build                        # builds packages/*/dist, which the demos import
pnpm dev:vue-demo                 # http://localhost:5174
pnpm dev:react-demo               # http://localhost:5173
```

The API validates selectors against its projection and supports optional
`DataLoading` limits. Numeric limits are disabled until configured; production
recommendations are `MaxTake=100`, `MaxFilterNodes=64`, `MaxSorts=8`. See the
API README for configuration and migration details.

The demos resolve the workspace packages through their `exports` maps, which
point at `dist/`. `dist` is gitignored, so run `pnpm build` (or
`pnpm build:react-demo` / `pnpm build:vue-demo`) once after cloning, otherwise
Vite cannot resolve the import.

Deploying the demos on Vercel (2 projects, same repo):

- Root Directory: `./` (repo root)
- Install Command: `pnpm install --frozen-lockfile`
- Build Command: `pnpm run build:react-demo` (or `pnpm run build:vue-demo`)
- Output Directory: `examples/react-demo/dist` (or `examples/vue-demo/dist`)
- Env: `VITE_API_URL=https://tanstack-aspnet-data-production.up.railway.app/api/products`

`build:react-demo` runs `pnpm -r --filter "react-demo..." build`, so the library
packages are built before the demo. The old `pnpm --filter react-demo build`
skips them and fails on a clean checkout.

`examples/*/​.env.production` already points to Railway, so a plain `vite build` works even without env.

## Roadmap

- **v0.1** — URL synchronization, debouncing, caching, TanStack Query integration, nested `Manufacturer` + `CategoryNames` many-to-many demo (shipped)
- **next** — grouping & summaries, CRUD helpers, optimistic updates

## License

[MIT](./LICENSE). The example's model binder is adapted from the MIT-licensed
DevExtreme.AspNet.Data sample.

Community package — not affiliated with or endorsed by TanStack
(TanStack Table) or DevExpress (DevExtreme).
