using Microsoft.AspNetCore;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;

namespace WebHost;

public interface IGreeter { }
public sealed class Greeter : IGreeter { }

public sealed class Startup
{
    public void ConfigureServices(IServiceCollection services)
    {
        File.WriteAllText("startup-configured.txt", "Startup.ConfigureServices ran.");
        services.AddSingleton<IGreeter, Greeter>();
    }

    public void Configure(IApplicationBuilder app) =>
        app.Run(context => File.WriteAllTextAsync("started.txt", "The host must never start."));
}

public sealed class Product
{
    public int Id { get; set; }
    public string Name { get; set; } = "";
}

public sealed class CatalogContext(DbContextOptions<CatalogContext> options) : DbContext(options)
{
    protected override void OnModelCreating(ModelBuilder model) => model.Entity<Product>().ToTable("products");
}

/// <summary>Takes precedence over the host for EF Core, which then never builds it.</summary>
public sealed class CatalogContextFactory : IDesignTimeDbContextFactory<CatalogContext>
{
    public CatalogContext CreateDbContext(string[] args) =>
        new(new DbContextOptionsBuilder<CatalogContext>().UseSqlite("Data Source=:memory:").Options);
}

public static class Program
{
    public static void Main(string[] args) => CreateWebHostBuilder(args).Build().Run();

    public static IWebHostBuilder CreateWebHostBuilder(string[] args) =>
        Microsoft.AspNetCore.WebHost.CreateDefaultBuilder(args).UseStartup<Startup>();
}
