# Example API — ASP.NET Core + EF Core + DevExtreme.AspNet.Data

Minimal backend for the Vue/React demos.

```bash
dotnet run          # http://localhost:5055/api/products (SQLite, 250 seeded products)
```

Try it:

```
http://localhost:5055/api/products?skip=10&take=5&requireTotalCount=true
  &sort=[{"selector":"Manufacturer.Name"}]
  &filter=[["Manufacturer.Name","contains","medtronic"],"and",["CategoryNames","contains","Cardiology"]]

http://localhost:5055/api/products?skip=0&take=10&requireTotalCount=true
  &sort=[{"selector":"Price","desc":true}]
  &filter=[[["Name","contains","pump"],"or",["Manufacturer.Name","contains","pump"]],"and",[["Price",">=",100],"and",["Price","<=",300]]]
```

(URL-encode the JSON values in a real client. Use `mapSelector` in the demos to map TanStack column ids like `manufacturerName` → `Manufacturer.Name`.)

The same keys work as a POST form-urlencoded body, which avoids URL length
limits for large filters:

```bash
curl -X POST http://localhost:5055/api/products \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  --data-urlencode 'skip=0' \
  --data-urlencode 'take=5' \
  --data-urlencode 'requireTotalCount=true' \
  --data-urlencode 'sort=[{"selector":"Price","desc":true}]'
```

Malformed load options (bad JSON in `filter`/`sort`, non-numeric `take`, …)
return `400` with a `ValidationProblemDetails` body rather than a bare `500`.
Unknown selectors and disabled operations return a generic `400` response;
details are written to server logs only.

## Query limits

The endpoint always checks selectors against the fields projected by
`ProductsController`. Numeric limits are optional and disabled by default so
the example remains configurable. Recommended production settings:

```json
{
  "DataLoading": {
    "MaxTake": 100,
    "MaxFilterNodes": 64,
    "MaxSorts": 8
  }
}
```

Equivalent environment variables are `DataLoading__MaxTake`,
`DataLoading__MaxFilterNodes` and `DataLoading__MaxSorts`. `AllowedSelectors`
can override the controller defaults, for example
`DataLoading__AllowedSelectors__0=Name`.

When `MaxTake` is configured, omitted or larger page sizes are capped. Grouping,
summaries and remote projections remain disabled for this endpoint.

## Database and health

Startup applies EF Core migrations, seeds deterministic data and fails fast if
database initialization fails. `/health` checks the actual `AppDbContext`.
Override SQLite with `ConnectionStrings__Products`, for example
`Data Source=/data/products.db`.

Databases created before this migration-enabled revision have no EF migration
history. For this disposable demo database, stop the API and delete the old
`products.db` once; the next start recreates and seeds it through migrations.
Do not use that deletion procedure for application data—create a baseline
migration instead.

## Files of interest

- `DataSourceLoadOptions.cs` — model binder adapted from DevExpress' MIT sample; copy it into your project to bind `DataSourceLoadOptions` on any controller action. It reports parse failures through `ModelState` so `[ApiController]` turns them into a `400`.
- `Controllers/ProductsController.cs` — the entire server-side implementation.
- `DataLoadingOptions.cs` — selector validation and configurable query limits.
- `Migrations/` — the SQLite schema managed by EF Core.
- `DbSeed.cs` — deterministic seed data.

## Notes

- `loadOptions.StringToLower = true` makes `contains`/`startswith` case-insensitive.
- `Product.Price` is a `double` because EF Core + SQLite stores `decimal` as TEXT whose collation breaks under non-invariant cultures. Use `decimal` freely with SQL Server / PostgreSQL.
- The endpoint accepts both GET query strings and POST form-urlencoded bodies with identical keys.
