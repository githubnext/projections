package com.example.orders.orders;

import com.example.orders.audit.AuditLog;
import org.springframework.stereotype.Service;

@Service
public class NotificationService {
    private final AuditLog audit;

    public NotificationService(AuditLog audit) {
        this.audit = audit;
    }

    public void notify(String order) {
        audit.record("notified " + order);
    }
}
