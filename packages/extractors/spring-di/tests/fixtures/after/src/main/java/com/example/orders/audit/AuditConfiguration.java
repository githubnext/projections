package com.example.orders.audit;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class AuditConfiguration {
    /** Now a singleton, still with its alias: one log for the application. */
    @Bean(name = {"auditLog", "auditTrail"})
    AuditLog auditLog() {
        return new AuditLog();
    }
}
