package com.example.orders.time;

import java.time.Clock;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Primary;

@Configuration
public class TimeConfiguration {
    /** Two candidates for Clock: unqualified injection gets the primary one. */
    @Bean
    @Primary
    Clock systemClock() {
        return Clock.systemDefaultZone();
    }

    @Bean
    Clock utcClock() {
        return Clock.systemUTC();
    }
}
