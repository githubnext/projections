package com.example.orders.orders;

import org.springframework.stereotype.Component;
import org.springframework.web.context.annotation.RequestScope;

/** One per HTTP request; singletons receive a scoped proxy. */
@Component
@RequestScope
public class RequestContext {
    public String id() {
        return "request";
    }
}
