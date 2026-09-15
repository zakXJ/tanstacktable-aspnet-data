# tanstack-aspnet-data

**Server-side data adapter for TanStack Table + ASP.NET Core.**

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

## Quick start

### Client

```bash
npm install tanstack-aspnet-data @tanstack/react-table
# or: npm install @tanstack-aspnet-data/react @tanstack/react-table react
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

Returns `{ table, rows, totalCount, pageCount, isFetching, isError, error, refetch }`.

## Examples

[`examples/`](./examples) contains a runnable end-to-end stack:

```bash
cd examples/api && dotnet run     # ASP.NET Core + EF Core + SQLite on :5055 (250 seeded products)
pnpm --filter vue-demo dev        # http://localhost:5174
pnpm --filter react-demo dev      # http://localhost:5173
```

## Roadmap

- **v0.1** — URL synchronization, debouncing, caching, TanStack Query integration, nested `Manufacturer` + `CategoryNames` many-to-many demo (shipped)
- **next** — grouping & summaries, CRUD helpers, optimistic updates

## License

[MIT](./LICENSE). The example's model binder is adapted from the MIT-licensed
DevExtreme.AspNet.Data sample.
