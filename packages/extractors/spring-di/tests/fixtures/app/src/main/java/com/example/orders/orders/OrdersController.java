package com.example.orders.orders;

import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class OrdersController {
    private final OrdersService orders;
    private final RequestContext context;

    public OrdersController(OrdersService orders, RequestContext context) {
        this.orders = orders;
        this.context = context;
    }

    @PostMapping("/orders")
    public String place() {
        return orders.place(context.id());
    }
}
