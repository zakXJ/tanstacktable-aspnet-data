using Microsoft.EntityFrameworkCore;
using TanStackDemo.Api;

var builder = WebApplication.CreateBuilder(args);

// Railway injects PORT, fallback 5055 for local demos (http://localhost:5055/api/products)
var port = Environment.GetEnvironmentVariable("PORT") ?? "5055";
builder.WebHost.UseUrls($"http://*:{port}");

// Reduce EF Core verbose logs that triggered Railway 500 logs/sec on seed
builder.Logging.ClearProviders();
builder.Logging.AddConsole();
builder.Logging.AddFilter("Microsoft.EntityFrameworkCore.Database.Command", LogLevel.Warning);

builder.Services.AddControllers();
builder.Services.Configure<DataLoadingOptions>(builder.Configuration.GetSection("DataLoading"));
var connectionString = builder.Configuration.GetConnectionString("Products") ?? "Data Source=products.db";
builder.Services.AddDbContext<AppDbContext>(options =>
    options.UseSqlite(connectionString));
builder.Services.AddCors(options => options.AddDefaultPolicy(policy =>
    policy.AllowAnyOrigin().AllowAnyHeader().AllowAnyMethod()));
builder.Services.AddHealthChecks().AddDbContextCheck<AppDbContext>();

var app = builder.Build();

app.UseCors();
app.MapControllers();
app.MapHealthChecks("/health");

using (var scope = app.Services.CreateScope()) {
    try {
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        LegacyDatabaseStamper.StampBaselineIfLegacy(db);
        db.Database.Migrate();
        DbSeeder.Seed(db);
    } catch (Exception ex) {
        app.Logger.LogError(ex, "Failed to initialize database");
        throw;
    }
}

app.Run();

public partial class Program;
