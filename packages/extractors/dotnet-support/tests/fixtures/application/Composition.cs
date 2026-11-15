using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Metadata;
using Microsoft.Extensions.DependencyInjection;

namespace Fixture;

public interface IMessage { string Text { get; } }
public sealed class Message : IMessage { public string Text => "hello"; }
public sealed class OtherMessage : IMessage { public string Text => "other"; }
public interface IRepository<T> where T : class { }
public sealed class Repository<T> : IRepository<T> where T : class { }
public interface IClock { }
public sealed class SystemClock : IClock { }
public interface IGreeter { }
public sealed class Greeter : IGreeter
{
    public Greeter() { }
    public Greeter(IMessage message, IEnumerable<IMessage> all, IClock clock,
        [FromKeyedServices("blue")] IMessage blue, IRepository<Customer> repository, string? banner = null) { }
}
public enum Status : byte { Ready = 1, Done = 2 }
public readonly record struct Identifier(int Value);
public delegate TResult Transform<in T, out TResult>(T value);

public class PublicApi<T> where T : class, new()
{
    private int secret = 1;
    public string Name { get; private set; } = "";
    public T Create(int count = 1) { secret += count; return new T(); }
    public T Create(string name) { Name = name; return new T(); }
    public U Map<U>(T source, U fallback) where U : struct => fallback;
    protected virtual int Count => secret;
    internal void Hidden() { }
    private class PrivateNested { }
    public class Nested { public const int Limit = 5; }
}

// Compiles only if the SDK's regex source generator runs; CS1998 is silenced by
// .editorconfig, which TreatWarningsAsErrors would otherwise turn into an error.
public static partial class Patterns
{
    [System.Text.RegularExpressions.GeneratedRegex("[0-9]+")]
    public static partial System.Text.RegularExpressions.Regex Digits();
    public static async Task<int> Quiet() => 1;
}

public static class Composition
{
    private static string Variant(JsonElement input) =>
        input.GetProperty("projection").GetProperty("definition").GetProperty("inputs").GetProperty("variant").GetString()!;

    public static IServiceCollection Services(JsonElement input)
    {
        Console.WriteLine("Application composition logs must not corrupt JSON stdout.");
        var services = new ServiceCollection();
        if (Variant(input) == "lifetime") services.AddScoped<IMessage, Message>();
        else services.AddSingleton<IMessage, Message>();
        services.AddTransient<IMessage, OtherMessage>();
        services.AddKeyedSingleton<IMessage, Message>("blue");
        services.AddKeyedTransient<IMessage>("factory", (_, _) => throw new InvalidOperationException("Do not instantiate factories"));
        services.AddSingleton<IMessage>(_ => throw new InvalidOperationException("Do not instantiate factories"));
        services.AddSingleton(new Message());
        services.AddScoped(typeof(IRepository<>), typeof(Repository<>));
        services.AddSingleton<IClock, SystemClock>();
        services.AddSingleton<IGreeter, Greeter>();
        return services;
    }

    public static DbContext Database(JsonElement input)
    {
        Console.WriteLine("Model construction logs belong on stderr.");
        return new ApplicationContext(Variant(input));
    }

    public static IModel Model(JsonElement input)
    {
        using var context = new ApplicationContext(Variant(input));
        return context.GetService<IDesignTimeModel>().Model;
    }

    public static IServiceCollection ParameterlessServices() => new ServiceCollection().AddSingleton<IMessage, Message>();

    public static async Task<IServiceCollection> AsyncServices(JsonElement input)
    {
        await Task.Yield();
        return Services(input);
    }
}

public sealed class Customer
{
    public int Id { get; set; }
    public string Name { get; set; } = "";
    public ICollection<Order> Orders { get; set; } = new List<Order>();
}

public sealed class Order
{
    public int Id { get; set; }
    public int CustomerId { get; set; }
    public Customer Customer { get; set; } = null!;
}

internal sealed class ApplicationContext(string variant) : DbContext
{
    protected override void OnConfiguring(DbContextOptionsBuilder options) => options.UseSqlite("Data Source=:memory:");
    protected override void OnModelCreating(ModelBuilder model)
    {
        model.Entity<Customer>(entity =>
        {
            entity.ToTable("customers", table => table.HasCheckConstraint("CK_customers_name", "length(name) > 0"));
            entity.HasKey(item => item.Id);
            entity.Property(item => item.Name).HasColumnName("name").HasMaxLength(variant == "schema" ? 200 : 100);
            entity.HasIndex(item => item.Name).IsUnique(variant == "schema");
            if (variant == "schema") entity.Property<string>("Email").HasColumnName("email");
        });
        model.Entity<Order>(entity =>
        {
            entity.ToTable("orders");
            entity.HasKey(item => item.Id);
            entity.HasOne(item => item.Customer).WithMany(item => item.Orders).HasForeignKey(item => item.CustomerId)
                .OnDelete(variant == "schema" ? DeleteBehavior.Restrict : DeleteBehavior.Cascade);
        });
    }
}
