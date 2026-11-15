package com.example.orders.payments;

import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
@EnableConfigurationProperties(PaymentProperties.class)
public class PaymentsConfiguration {
    /** Registered as the PaymentGateway contract; the instance is a StripeGateway. */
    @Bean
    PaymentGateway paymentGateway(PaymentProperties properties) {
        return new StripeGateway(properties.currency());
    }
}
