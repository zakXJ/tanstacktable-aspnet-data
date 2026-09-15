using Microsoft.EntityFrameworkCore;
using TanStackDemo.Api;

var builder = WebApplication.CreateBuilder(args);

// Deterministic port so the demos can target http://localhost:5055/api/products.
builder.WebHost.UseUrls("http://localhost:5055");

builder.Services.AddControllers();
builder.Services.AddDbContext<AppDbContext>(options =>
    options.UseSqlite("Data Source=products.db"));
builder.Services.AddCors(options => options.AddDefaultPolicy(policy =>
    policy.AllowAnyOrigin().AllowAnyHeader().AllowAnyMethod()));

var app = builder.Build();

app.UseCors();
app.MapControllers();

using (var scope = app.Services.CreateScope()) {
    try {
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        db.Database.EnsureCreated();
        DbSeeder.Seed(db);
    } catch (Exception ex) {
        app.Logger.LogError(ex, "Failed to initialize database");
    }
}

app.Run();
