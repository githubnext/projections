package com.example.orders.audit;

import org.springframework.beans.factory.config.ConfigurableBeanFactory;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Scope;

@Configuration
public class AuditConfiguration {
    /** A prototype with an alias: every injection gets its own log. */
    @Bean(name = {"auditLog", "auditTrail"})
    @Scope(ConfigurableBeanFactory.SCOPE_PROTOTYPE)
    AuditLog auditLog() {
        return new AuditLog();
    }
}
