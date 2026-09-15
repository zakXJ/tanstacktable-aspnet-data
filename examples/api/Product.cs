namespace TanStackDemo.Api;

public class Product {
    public int Id { get; set; }
    public string Name { get; set; } = string.Empty;

    public int ManufacturerId { get; set; }
    public Manufacturer Manufacturer { get; set; } = null!;

    public ICollection<Category> Categories { get; set; } = new List<Category>();

    // Denormalized comma-joined category names for server-side filtering via `contains`.
    // Keeps the many-to-many `Categories` for display while allowing simple SQL translation.
    public string CategoryNames { get; set; } = string.Empty;

    // NOTE: `double` (not `decimal`) because EF Core + SQLite stores decimals
    // as TEXT whose collation breaks under non-invariant cultures. Use decimal
    // freely with SQL Server / PostgreSQL providers.
    public double Price { get; set; }
    public int UnitsInStock { get; set; }
    public bool IsActive { get; set; }
    public DateTime CreatedAt { get; set; }
}
