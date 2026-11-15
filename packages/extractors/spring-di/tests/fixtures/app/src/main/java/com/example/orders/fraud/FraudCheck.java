package com.example.orders.fraud;

import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

/** Registered only when orders.fraud-check.enabled is true. */
@Component
@ConditionalOnProperty(name = "orders.fraud-check.enabled", havingValue = "true")
public class FraudCheck {
    public boolean suspicious(String order) {
        return false;
    }
}
