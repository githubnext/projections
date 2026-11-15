package com.example.orders.payments;

public class AdyenGateway implements PaymentGateway {
    private final String currency;

    public AdyenGateway(String currency) {
        this.currency = currency;
    }

    @Override
    public String charge(long amount) {
        return "adyen:" + amount + currency;
    }
}
