package com.example.orders.orders;

import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;

@Component
@Order(2)
public class StockValidator implements OrderValidator {
    @Override
    public boolean valid(String order) {
        return true;
    }
}
