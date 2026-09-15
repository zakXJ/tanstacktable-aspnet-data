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

## Files of interest

- `DataSourceLoadOptions.cs` — model binder adapted from DevExpress' MIT sample; copy it into your project to bind `DataSourceLoadOptions` on any controller action.
- `Controllers/ProductsController.cs` — the entire server-side implementation.
- `DbSeed.cs` — deterministic seed data.

## Notes

- `loadOptions.StringToLower = true` makes `contains`/`startswith` case-insensitive.
- `Product.Price` is a `double` because EF Core + SQLite stores `decimal` as TEXT whose collation breaks under non-invariant cultures. Use `decimal` freely with SQL Server / PostgreSQL.
- The endpoint accepts both GET query strings and POST form-urlencoded bodies with identical keys.
