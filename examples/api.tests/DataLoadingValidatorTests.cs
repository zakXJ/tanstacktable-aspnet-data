using System.Collections;
using DevExtreme.AspNet.Data;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using TanStackDemo.Api;
using Xunit;

namespace TanStackDemo.Api.Tests;

public class DataLoadingValidatorTests {
    private static readonly HashSet<string> Allowed = new(StringComparer.OrdinalIgnoreCase) {
        "Id", "Name", "Price",
    };

    [Fact]
    public void MaxTakeCapsExplicitAndMissingPageSizes() {
        var limits = new DataLoadingOptions { MaxTake = 100 };
        var oversized = new DataSourceLoadOptions { Take = 500 };
        var missing = new DataSourceLoadOptions();

        Assert.Null(DataLoadingValidator.ValidateAndApply(oversized, limits, Allowed));
        Assert.Null(DataLoadingValidator.ValidateAndApply(missing, limits, Allowed));
        Assert.Equal(100, oversized.Take);
        Assert.Equal(100, missing.Take);
    }

    [Fact]
    public void UnknownSelectorsAndExcessiveFilterComplexityAreRejected() {
        var unknown = new DataSourceLoadOptions {
            Filter = new ArrayList { "Secret", "contains", "x" },
        };
        var complex = new DataSourceLoadOptions {
            Filter = new ArrayList {
                new ArrayList { "Name", "contains", "a" },
                "and",
                new ArrayList { "Price", ">", 10 },
            },
        };

        Assert.Contains("not allowed", DataLoadingValidator.ValidateAndApply(unknown, new(), Allowed));
        Assert.Contains("At most 1", DataLoadingValidator.ValidateAndApply(
            complex, new DataLoadingOptions { MaxFilterNodes = 1 }, Allowed));
    }

    [Fact]
    public void InitialMigrationCreatesTheDatabaseModel() {
        using var connection = new SqliteConnection("Data Source=:memory:");
        connection.Open();
        var options = new DbContextOptionsBuilder<AppDbContext>().UseSqlite(connection).Options;
        using var db = new AppDbContext(options);

        db.Database.Migrate();

        Assert.Contains("InitialCreate", db.Database.GetAppliedMigrations().Single());
        Assert.False(db.Products.Any());
    }
}
