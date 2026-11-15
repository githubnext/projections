package com.example.orders.payments;

public class StripeGateway implements PaymentGateway {
    private final String currency;

    public StripeGateway(String currency) {
        this.currency = currency;
    }

    @Override
    public String charge(long amount) {
        return "stripe:" + amount + currency;
    }
}
