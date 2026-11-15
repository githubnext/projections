package com.example.orders.orders;

import com.example.orders.audit.AuditLog;
import com.example.orders.fraud.FraudCheck;
import com.example.orders.payments.PaymentGateway;
import java.time.Clock;
import java.util.List;
import java.util.Optional;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.stereotype.Service;

@Service
public class OrdersService {
    private final OrdersRepository repository;
    private final PaymentGateway payments;
    private final List<OrderValidator> validators;
    private final Clock clock;
    private final AuditLog audit;
    private final Optional<FraudCheck> fraud;
    private final ObjectProvider<Metrics> metrics;
    private final NotificationService notifications;

    public OrdersService(OrdersRepository repository, PaymentGateway payments, List<OrderValidator> validators, Clock clock,
            AuditLog audit, Optional<FraudCheck> fraud, ObjectProvider<Metrics> metrics, NotificationService notifications) {
        this.repository = repository;
        this.payments = payments;
        this.validators = validators;
        this.clock = clock;
        this.audit = audit;
        this.fraud = fraud;
        this.metrics = metrics;
        this.notifications = notifications;
    }

    public String place(String order) {
        if (validators.stream().anyMatch(validator -> !validator.valid(order))) return "invalid";
        if (fraud.map(check -> check.suspicious(order)).orElse(false)) return "rejected";
        repository.save(order);
        metrics.ifAvailable(metrics -> metrics.increment("orders"));
        notifications.notify(order);
        audit.record(order + " at " + clock.instant());
        return payments.charge(1);
    }
}
