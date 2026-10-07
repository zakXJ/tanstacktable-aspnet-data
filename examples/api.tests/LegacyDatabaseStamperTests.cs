using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using TanStackDemo.Api;
using Xunit;

namespace TanStackDemo.Api.Tests;

public class LegacyDatabaseStamperTests : IDisposable {
    private readonly string _path = Path.Combine(Path.GetTempPath(), $"legacy-{Guid.NewGuid():N}.db");
    private DbContextOptions<AppDbContext> Options =>
        new DbContextOptionsBuilder<AppDbContext>().UseSqlite($"Data Source={_path}").Options;

    [Fact]
    public void MigrateWithoutStampingFailsOnLegacyDatabase() {
        // Proves the stamper is load-bearing: a pre-migrations database
        // (EnsureCreated shape: schema, no history table) cannot Migrate().
        using (var db = new AppDbContext(Options)) {
            db.Database.EnsureCreated();
        }
        using (var db = new AppDbContext(Options)) {
            Assert.ThrowsAny<Exception>(() => db.Database.Migrate());
        }
    }

    [Fact]
    public void LegacyDatabaseIsStampedMigratesAndKeepsItsData() {
        // Faithful replica of the Railway database: full legacy seed first.
        using (var db = new AppDbContext(Options)) {
            db.Database.EnsureCreated();
            DbSeeder.Seed(db);
        }
        using (var db = new AppDbContext(Options)) {
            LegacyDatabaseStamper.StampBaselineIfLegacy(db);
            db.Database.Migrate();

            Assert.Contains("InitialCreate", db.Database.GetAppliedMigrations().Single());
            Assert.Equal(250, db.Products.Count());
            Assert.Equal(8, db.Manufacturers.Count());
            Assert.Equal("Medtronic", db.Manufacturers.OrderBy(m => m.Id).First().Name);
        }
    }

    [Fact]
    public void StampingIsIdempotentAndFreshDatabasesAreUntouched() {
        using (var db = new AppDbContext(Options)) {
            db.Database.EnsureCreated();
            LegacyDatabaseStamper.StampBaselineIfLegacy(db);
            LegacyDatabaseStamper.StampBaselineIfLegacy(db);

            // No history row duplicated, migrate still succeeds afterwards.
            db.Database.Migrate();
            Assert.Contains("InitialCreate", db.Database.GetAppliedMigrations().Single());
        }

        var fresh = Path.Combine(Path.GetTempPath(), $"fresh-{Guid.NewGuid():N}.db");
        try {
            var freshOptions = new DbContextOptionsBuilder<AppDbContext>().UseSqlite($"Data Source={fresh}").Options;
            using (var db = new AppDbContext(freshOptions)) {
                LegacyDatabaseStamper.StampBaselineIfLegacy(db); // no tables: no-op
                db.Database.Migrate();
                Assert.Contains("InitialCreate", db.Database.GetAppliedMigrations().Single());
                Assert.False(db.Products.Any());
            }
        } finally {
            DeleteQuietly(fresh);
        }
    }

    public void Dispose() {
        DeleteQuietly(_path);
        GC.SuppressFinalize(this);
    }

    private static void DeleteQuietly(string path) {
        try { File.Delete(path); } catch { }
        try { File.Delete(path + "-wal"); } catch { }
        try { File.Delete(path + "-shm"); } catch { }
    }
}
