using Microsoft.Extensions.DependencyInjection;

namespace Shop;

public static class Composition
{
    /// <summary>The application's own registrations, for `dotnet-di`'s `factoryType` and `factoryMethod`.</summary>
    public static IServiceCollection Services() => new ServiceCollection().AddShop();

    public static IServiceCollection AddShop(this IServiceCollection services)
    {
        services.AddTransient<OrdersController>();
        services.AddTransient<CheckoutController>();
        services.AddScoped<ICheckoutService, CheckoutService>();
        services.AddScoped<IOrderQueries, OrderQueries>();
        services.AddScoped<IOrderNotifications, OrderNotifications>();
        services.AddScoped<IOrderRepository, OrderRepository>();
        services.AddScoped<ShopDbContext>();
        services.AddSingleton<IPaymentGateway, StripePaymentGateway>();
        services.AddSingleton<IInventoryClient, InventoryClient>();
        services.AddSingleton<IEmailSender, SmtpEmailSender>();
        services.AddSingleton<IClock, SystemClock>();
        return services;
    }
}

public sealed class OrdersController(IOrderQueries orders);

public sealed class CheckoutController(ICheckoutService checkout, IOrderNotifications notifications);

public interface ICheckoutService;

public sealed class CheckoutService(
    IOrderRepository orders,
    IPaymentGateway payments,
    IInventoryClient inventory) : ICheckoutService;

public interface IOrderQueries;

public sealed class OrderQueries(IOrderRepository orders) : IOrderQueries;

public interface IOrderNotifications;

public sealed class OrderNotifications(IEmailSender email, IClock clock) : IOrderNotifications;

public interface IOrderRepository;

public sealed class OrderRepository(ShopDbContext db) : IOrderRepository;

public sealed class ShopDbContext;

public interface IPaymentGateway;

public sealed class StripePaymentGateway(IClock clock) : IPaymentGateway;

public interface IInventoryClient;

public sealed class InventoryClient : IInventoryClient;

public interface IEmailSender;

public sealed class SmtpEmailSender : IEmailSender;

public interface IClock;

public sealed class SystemClock : IClock;
