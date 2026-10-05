using DevExtreme.AspNet.Data;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using TanStackDemo.Api;

namespace TanStackDemo.Api.Controllers;

[ApiController]
[Route("api/products")]
public class ProductsController(
    AppDbContext db,
    IOptions<DataLoadingOptions> loadingOptions,
    ILogger<ProductsController> logger) : ControllerBase {

    private static readonly HashSet<string> AllowedSelectors = new(StringComparer.OrdinalIgnoreCase) {
        "Id", "Name", "Manufacturer.Name", "Manufacturer.Ref", "Manufacturer.Address",
        "Manufacturer.City", "Manufacturer.Country", "CategoryNames", "Price",
        "UnitsInStock", "IsActive", "CreatedAt",
    };

    [HttpGet]
    [HttpPost]
    public async Task<IActionResult> Get(DataSourceLoadOptions loadOptions) {
        var validationError = DataLoadingValidator.ValidateAndApply(
            loadOptions, loadingOptions.Value, AllowedSelectors);
        if (validationError is not null) {
            logger.LogWarning("Rejected data query: {Reason}", validationError);
            return BadRequest(new { error = "Invalid data query." });
        }

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
            logger.LogWarning(ex, "Rejected data query during execution");
            return BadRequest(new { error = "Invalid data query." });
        }
    }
}
