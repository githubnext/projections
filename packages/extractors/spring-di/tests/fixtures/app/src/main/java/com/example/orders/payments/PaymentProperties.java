package com.example.orders.payments;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties("payments")
public record PaymentProperties(String currency) {}
