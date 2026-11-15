package com.example.orders.payments;

public interface PaymentGateway {
    String charge(long amount);
}
