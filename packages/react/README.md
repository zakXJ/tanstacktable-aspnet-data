# @tanstack-aspnet-data/react

[![npm version](https://img.shields.io/npm/v/@tanstack-aspnet-data/react.svg)](https://www.npmjs.com/package/@tanstack-aspnet-data/react)

> **Live demo:** [React demo](https://tanstack-react-demo.vercel.app) · [API](https://tanstack-aspnet-data-production.up.railway.app/api/products?skip=0&take=5&requireTotalCount=true)

React hook that turns TanStack Table v8 into a fully server-side table backed
by [DevExtreme.AspNet.Data](https://github.com/DevExpress/DevExtreme.AspNet.Data)
(ASP.NET Core + EF Core). No DevExtreme UI involved.

```tsx
import { useAspNetDataTable } from '@tanstack-aspnet-data/react'

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

The hook manages pagination, sorting, column filters, global filter, request
cancellation and page-count derivation. Render `table.getHeaderGroups()` /
`table.getRowModel().rows` with `flexRender` as usual.

### Deep-linking with `syncUrl`

Pass `syncUrl: true` to mirror the table state (page, sorting, column filters,
global search) into the URL so a view can be shared or bookmarked. It is
disabled by default — set it to `false` (or omit it) to leave the URL untouched.

```tsx
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

```tsx
useAspNetDataTable({
  endpoint: '/api/products',
  columns,
  globalFilterFields: ['name', 'manufacturer'],
  globalFilterDebounceMs: 300,
})
```
