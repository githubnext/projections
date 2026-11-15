package com.example.orders.orders;

import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;

@Component
@Order(1)
public class AmountValidator implements OrderValidator {
    @Override
    public boolean valid(String order) {
        return !order.isEmpty();
    }
}
