using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;

namespace GenericHost;

public interface IClock { }
public sealed class SystemClock : IClock { }
public interface IDevelopmentDiagnostics { }
public sealed class DevelopmentDiagnostics : IDevelopmentDiagnostics { }
public sealed class Reporter(IClock clock)
{
    public IClock Clock { get; } = clock;
}

public sealed class Started : IHostedService
{
    public Task StartAsync(CancellationToken cancellationToken)
    {
        File.WriteAllText("started.txt", "The host must never start.");
        return Task.CompletedTask;
    }
    public Task StopAsync(CancellationToken cancellationToken) => Task.CompletedTask;
}

public sealed class Order
{
    public int Id { get; set; }
    public string Number { get; set; } = "";
}

public sealed class AuditEntry
{
    public int Id { get; set; }
    public string Message { get; set; } = "";
}

public sealed class OrdersContext(DbContextOptions<OrdersContext> options) : DbContext(options)
{
    protected override void OnModelCreating(ModelBuilder model) => model.Entity<Order>().ToTable("orders");
}

public sealed class AuditContext(DbContextOptions<AuditContext> options) : DbContext(options)
{
    protected override void OnModelCreating(ModelBuilder model) => model.Entity<AuditEntry>().ToTable("audit_entries");
}

public static class Program
{
    public static void Main(string[] args) => CreateHostBuilder(args).Build().Run();

    public static IHostBuilder CreateHostBuilder(string[] args) =>
        Host.CreateDefaultBuilder(args).ConfigureServices((context, services) =>
        {
            services.AddSingleton<IClock, SystemClock>();
            services.AddScoped<Reporter>();
            services.AddHostedService<Started>();
            if (context.HostingEnvironment.IsDevelopment()) services.AddSingleton<IDevelopmentDiagnostics, DevelopmentDiagnostics>();
            services.AddDbContext<OrdersContext>(options => options.UseSqlite("Data Source=:memory:"));
            services.AddDbContext<AuditContext>(options => options.UseSqlite("Data Source=:memory:"));
        });
}
