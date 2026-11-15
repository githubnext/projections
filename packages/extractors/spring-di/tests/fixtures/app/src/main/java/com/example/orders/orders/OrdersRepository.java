package com.example.orders.orders;

import java.util.ArrayList;
import java.util.List;
import org.springframework.stereotype.Repository;

@Repository
public class OrdersRepository {
    private final List<String> orders = new ArrayList<>();

    public void save(String order) {
        orders.add(order);
    }
}
