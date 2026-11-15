using Microsoft.EntityFrameworkCore;
using MinimalHost;

try
{
    var builder = WebApplication.CreateBuilder(args);
    builder.Services.AddSingleton<IGreeter, Greeter>();
    builder.Services.AddDbContext<ShopContext>(options => options.UseSqlite("Data Source=:memory:"));
    var app = builder.Build();
    app.MapGet("/", () => "hello");
    File.WriteAllText("started.txt", "The host must never start.");
    app.Run();
}
catch (Exception error)
{
    // A catch-all startup handler, as many applications log fatal startup errors.
    Console.WriteLine($"Startup stopped: {error.GetType().Name}");
}
