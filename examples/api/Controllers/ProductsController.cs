using DevExtreme.AspNet.Data;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using TanStackDemo.Api;

namespace TanStackDemo.Api.Controllers;

[ApiController]
[Route("api/products")]
public class ProductsController(AppDbContext db) : ControllerBase {

    [HttpGet]
    public async Task<IActionResult> Get(DataSourceLoadOptions loadOptions) {
        // Case-insensitive text comparisons (contains/startswith/endswith),
        // matching what users expect from a search box.
        loadOptions.StringToLower = true;

        // Projection with nested Manufacturer (FK) and many-to-many Categories.
        // Filtering, sorting and paging are fully translated to SQL by
        // DevExtreme.AspNet.Data + EF Core (including nested selectors like
        // `Manufacturer.Name` and collection selectors like `Categories`).
        // Projection keeps nested Manufacturer (FK) for sorting/filtering via `Manufacturer.Name`
        // and `CategoryNames` as denormalized string for collection filtering, plus `Categories`
        // navigation for display. All are SQL-translatable by EF Core + DevExtreme.
        var source = db.Products.AsNoTracking().OrderBy(p => p.Id).Select(p => new {
            p.Id,
            p.Name,
            Manufacturer = new {
                p.Manufacturer.Name,
                p.Manufacturer.Ref,
                p.Manufacturer.Address,
                p.Manufacturer.City,
                p.Manufacturer.Country,
            },
            Categories = p.Categories.Select(c => c.Name).ToList(),
            p.CategoryNames,
            p.Price,
            p.UnitsInStock,
            p.IsActive,
            p.CreatedAt,
        });

        try {
            var result = await DataSourceLoader.LoadAsync(source, loadOptions);
            return Ok(result);
        } catch (Exception ex) when (ex is ArgumentException || ex is InvalidOperationException || ex.InnerException is ArgumentException) {
            // Invalid filter/sort selector (e.g. unknown column) → 400 instead of 500
            return BadRequest(new { error = ex.Message });
        }
    }
}
