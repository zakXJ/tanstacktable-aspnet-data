using Microsoft.EntityFrameworkCore;
using TanStackDemo.Api;

public class AppDbContext(DbContextOptions<AppDbContext> options) : DbContext(options) {

    public DbSet<Product> Products => Set<Product>();
    public DbSet<Manufacturer> Manufacturers => Set<Manufacturer>();
    public DbSet<Category> Categories => Set<Category>();

    protected override void OnModelCreating(ModelBuilder modelBuilder) {
        modelBuilder.Entity<Product>()
            .HasOne(p => p.Manufacturer)
            .WithMany(m => m.Products)
            .HasForeignKey(p => p.ManufacturerId);

        modelBuilder.Entity<Product>()
            .HasMany(p => p.Categories)
            .WithMany(c => c.Products);
    }
}

public static class DbSeeder {

    private static readonly (string Name, string Ref, string Address, string City, string Country)[] ManufacturersData = [
        ("Medtronic", "MDT-001", "710 Medtronic Pkwy", "Minneapolis", "USA"),
        ("Boston Scientific", "BSC-002", "300 Boston Scientific Way", "Marlborough", "USA"),
        ("Abbott", "ABT-003", "100 Abbott Park Rd", "Abbott Park", "USA"),
        ("Stryker", "SYK-004", "2825 Airview Blvd", "Kalamazoo", "USA"),
        ("Johnson & Johnson", "JNJ-005", "One Johnson & Johnson Plaza", "New Brunswick", "USA"),
        ("Siemens Healthineers", "SHL-006", "Henkestrasse 127", "Erlangen", "Germany"),
        ("GE Healthcare", "GEH-007", "500 W Monroe St", "Chicago", "USA"),
        ("Philips", "PHI-008", "Amstelplein 2", "Amsterdam", "Netherlands"),
    ];

    private static readonly (string Name, string Code)[] CategoriesData = [
        ("Cardiology", "CARD"),
        ("Orthopedics", "ORTH"),
        ("Neurology", "NEUR"),
        ("Imaging", "IMAG"),
        ("Surgery", "SURG"),
        ("Monitoring", "MONI"),
    ];

    private static readonly string[] NameParts = [
        "Pacemaker", "Stent", "Insulin Pump", "Prosthesis", "Scanner", "Defibrillator",
        "Endoscope", "Monitor", "Catheter", "Dilator",
    ];

    /// <summary>Deterministic seed: same 250 rows on every fresh database.</summary>
    public static void Seed(AppDbContext db) {
        if (db.Products.Any()) return;
        // Guard against partial seed (e.g. crash after manufacturers) — check all tables
        if (db.Manufacturers.Any() || db.Categories.Any()) {
            // Clean partial state to ensure idempotency
            db.Database.EnsureDeleted();
            db.Database.EnsureCreated();
        }

        using var tx = db.Database.BeginTransaction();
        try {
            // Seed manufacturers
            var manufacturers = ManufacturersData.Select((m, idx) => new Manufacturer {
                Id = idx + 1,
                Name = m.Name,
                Ref = m.Ref,
                Address = m.Address,
                City = m.City,
                Country = m.Country,
            }).ToList();
            db.Manufacturers.AddRange(manufacturers);

            // Seed categories
            var categories = CategoriesData.Select((c, idx) => new Category {
                Id = idx + 1,
                Name = c.Name,
                Code = c.Code,
            }).ToList();
            db.Categories.AddRange(categories);
            db.SaveChanges();

            // Deterministic Fisher-Yates shuffle (stable across .NET versions, no OrderBy tie issues)
            var rng = new Random(42); // deterministic
            var products = new List<Product>(250);
            for (var i = 1; i <= 250; i++) {
                var manufacturer = manufacturers[(i - 1) % manufacturers.Count];
                // Deterministic 1-3 categories per product to cover all combinations
                var take = 1 + ((i - 1) % 3); // 1,2,3 cycle starting at 1
                var shuffled = categories.ToList();
                for (int j = shuffled.Count - 1; j > 0; j--) {
                    int k = rng.Next(j + 1);
                    var tmp = shuffled[j];
                    shuffled[j] = shuffled[k];
                    shuffled[k] = tmp;
                }
                shuffled = shuffled.Take(take).ToList();
                // Keep CategoryNames sorted alphabetically for stable display/sorting
                var orderedForNames = shuffled.OrderBy(c => c.Name).ToList();

                products.Add(new Product {
                    Name = $"{NameParts[i % NameParts.Length]} {1000 + i}",
                    ManufacturerId = manufacturer.Id,
                    Categories = shuffled,
                    CategoryNames = string.Join(",", orderedForNames.Select(c => c.Name)),
                    Price = 50 + (i % 60) * 17.5,
                    UnitsInStock = (i * 7) % 120,
                    IsActive = i % 4 != 0,
                    CreatedAt = new DateTime(2024, 1, 1, 0, 0, 0, DateTimeKind.Utc).AddDays(i),
                });
            }

            db.Products.AddRange(products);
            db.SaveChanges();
            tx.Commit();
        } catch {
            tx.Rollback();
            throw;
        }
    }
}
