using System.Data;
using Microsoft.EntityFrameworkCore;

namespace TanStackDemo.Api;

/// <summary>
/// One-time upgrade path for databases created before EF Core migrations
/// were adopted. Those databases were built with <c>EnsureCreated()</c>,
/// which creates the schema but no <c>__EFMigrationsHistory</c> table — so a
/// plain <c>Migrate()</c> fails trying to recreate existing tables.
///
/// When such a legacy shape is detected (a <c>Products</c> table with no
/// history table), the baseline migration is recorded as applied without
/// running it, and <c>Migrate()</c> then continues from there. Existing rows
/// are never touched. Fresh databases (no tables) and already-migrated
/// databases are left alone.
///
/// SQLite-only: it queries <c>sqlite_master</c> and uses SQLite DDL.
/// </summary>
public static class LegacyDatabaseStamper {
    // Must match Migrations/20261005132315_InitialCreate and the
    // ProductVersion recorded in AppDbContextModelSnapshot.
    private const string BaselineMigrationId = "20261005132315_InitialCreate";
    private const string BaselineProductVersion = "10.0.11";

    public static void StampBaselineIfLegacy(AppDbContext db) {
        var connection = db.Database.GetDbConnection();
        var wasClosed = connection.State == ConnectionState.Closed;
        if (wasClosed) connection.Open();
        try {
            if (HasTable(connection, "__EFMigrationsHistory")) return;
            if (!HasTable(connection, "Products")) return;
            using var ddl = connection.CreateCommand();
            ddl.CommandText = "CREATE TABLE IF NOT EXISTS \"__EFMigrationsHistory\" (\"MigrationId\" TEXT NOT NULL CONSTRAINT \"PK___EFMigrationsHistory\" PRIMARY KEY, \"ProductVersion\" TEXT NOT NULL)";
            ddl.ExecuteNonQuery();
            using var insert = connection.CreateCommand();
            insert.CommandText = "INSERT OR IGNORE INTO \"__EFMigrationsHistory\" (\"MigrationId\", \"ProductVersion\") VALUES (@id, @version)";
            var id = insert.CreateParameter();
            id.ParameterName = "@id";
            id.Value = BaselineMigrationId;
            insert.Parameters.Add(id);
            var version = insert.CreateParameter();
            version.ParameterName = "@version";
            version.Value = BaselineProductVersion;
            insert.Parameters.Add(version);
            insert.ExecuteNonQuery();
        } finally {
            if (wasClosed) connection.Close();
        }
    }

    private static bool HasTable(System.Data.Common.DbConnection connection, string name) {
        using var command = connection.CreateCommand();
        command.CommandText = "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = @name";
        var param = command.CreateParameter();
        param.ParameterName = "@name";
        param.Value = name;
        command.Parameters.Add(param);
        return Convert.ToInt64(command.ExecuteScalar()) > 0;
    }
}
