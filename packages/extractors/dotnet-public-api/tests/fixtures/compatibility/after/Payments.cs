namespace Payments;

public interface IGateway
{
    Receipt Charge(decimal amount, string currency);
    Task<Receipt> ChargeAsync(decimal amount, string currency);
    string Name => "gateway";
}

public abstract class PaymentMethod
{
    protected PaymentMethod() { }
    public virtual string Describe() => "payment method";
    public abstract bool Validate();
    public abstract string Kind { get; }
}

public sealed class Card : PaymentMethod
{
    public Card(string number) => Number = number;
    public string Number { get; }
    public override bool Validate() => Number.Length > 0;
    public override string Kind => "card";
}

public class Receipt
{
    public string? Id { get; init; }
    public decimal Total { get; init; }
    public string Currency { get; init; } = "USD";
}

public enum Status
{
    Pending = 0,
    Settled = 1,
    Failed = 3,
    Refunded = 4,
}

public static class Limits
{
    public const int MaxRetries = 5;
}

public class Client
{
    public Client(IGateway gateway) => Gateway = gateway;
    protected IGateway Gateway { get; }
    public Receipt Pay(decimal amount, string currencyCode = "USD") => Gateway.Charge(amount, currencyCode);
    public Task<Receipt> PayAsync(decimal amount, string currency = "USD") => Gateway.ChargeAsync(amount, currency);
}

public sealed class Wallet
{
    public IReadOnlyList<PaymentMethod> Methods { get; } = [];
}
