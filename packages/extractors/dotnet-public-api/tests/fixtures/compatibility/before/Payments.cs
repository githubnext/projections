namespace Payments;

public interface IGateway
{
    Receipt Charge(decimal amount, string currency);
}

public abstract class PaymentMethod
{
    protected PaymentMethod() { }
    public virtual string Describe() => "payment method";
    public abstract bool Validate();
}

public class Card : PaymentMethod
{
    public Card(string number) => Number = number;
    public string Number { get; set; }
    public override bool Validate() => Number.Length > 0;
}

public class Receipt
{
    public string Id { get; init; } = "";
    public decimal Total { get; init; }
}

public enum Status
{
    Pending = 0,
    Settled = 1,
    Failed = 2,
}

public static class Limits
{
    public const int MaxRetries = 3;
}

public class Client
{
    public Client(IGateway gateway) => Gateway = gateway;
    protected IGateway Gateway { get; }
    public Receipt Pay(decimal amount, string currency = "USD") => Gateway.Charge(amount, currency);
    public void Refund(string receiptId) { }
}
