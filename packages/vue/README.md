# @tanstack-aspnet-data/vue

[![npm version](https://img.shields.io/npm/v/@tanstack-aspnet-data/vue.svg)](https://www.npmjs.com/package/@tanstack-aspnet-data/vue)

> **Live demo:** [Vue demo](https://tanstack-vue-demo.vercel.app) · [API](https://tanstack-aspnet-data-production.up.railway.app/api/products?skip=0&take=5&requireTotalCount=true)

Vue 3 composable that turns TanStack Table (Vue) into a fully server-side
table backed by
[DevExtreme.AspNet.Data](https://github.com/DevExpress/DevExtreme.AspNet.Data)
(ASP.NET Core + EF Core). No DevExtreme UI involved.

```ts
import { useAspNetDataTable } from '@tanstack-aspnet-data/vue'

const columns: ColumnDef<Product>[] = [
  { accessorKey: 'name', header: 'Name' },
  { accessorKey: 'manufacturer', header: 'Manufacturer' },
]

const { table, rows, totalCount, pageCount, isFetching } = useAspNetDataTable({
  endpoint: '/api/products',
  columns,
  globalFilterFields: ['name', 'manufacturer'],
})
```

State is exposed as Vue refs; the TanStack `table` instance drives the UI as
usual (`flexRender`, header groups, row model).

### Install

```bash
npm install @tanstack-aspnet-data/vue @tanstack/vue-table vue
```

`@tanstack/vue-query` is an optional peer dependency, only needed for
`useAspNetDataQuery`. The package root re-exports that hook, so a CJS runtime
without a bundler (plain `node`, Jest, SSR) resolves `@tanstack/vue-query` at
load time. Install it, or keep the hook out of your import if you don't need it.

### Deep-linking with `syncUrl`

Pass `syncUrl: true` to mirror the table state (page, sorting, column filters,
global search) into the URL so a view can be shared or bookmarked. It is
disabled by default — set it to `false` (or omit it) to leave the URL untouched.

```ts
useAspNetDataTable({
  endpoint: '/api/products',
  columns,
  syncUrl: true, // or: { mode: 'push', prefix: 'tbl_' }
})
```

- `mode: 'replace'` (default) rewrites the current URL without adding history
  entries; `mode: 'push'` lets the browser back button step through states.
- `prefix` namespaces every param (e.g. `tbl_page`, `tbl_q`) to avoid clashes.
- Reloading or opening the URL re-applies the state; the browser back/forward
  buttons re-sync the table.

### Debounced filtering

`globalFilterDebounceMs` (and `columnFilterDebounceMs`) delay the request until
the user stops typing, so you don't fire one request per keystroke. `0`
(default) disables it.

```ts
useAspNetDataTable({
  endpoint: '/api/products',
  columns,
  globalFilterFields: ['name', 'manufacturer'],
  globalFilterDebounceMs: 300,
})
```

### TanStack Query integration

`useAspNetDataQuery` delegates fetching, caching and retries to
`@tanstack/vue-query`. It lives in a separate entry point so that
`@tanstack/vue-query` stays a genuinely optional peer — importing
`@tanstack-aspnet-data/vue` does not require it.

```ts
import { useAspNetDataQuery } from '@tanstack-aspnet-data/vue/query'

const { table, rows, totalCount, isFetching } = useAspNetDataQuery({
  endpoint: '/api/products',
  columns,
  staleTime: 30_000,
})
```
