package com.example.orders.orders;

import java.time.Clock;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.stereotype.Service;

@Service
public class ReportService {
    private final Clock clock;

    @Autowired
    private OrdersRepository repository;

    /** A qualifier selects the non-primary clock. */
    public ReportService(@Qualifier("utcClock") Clock clock) {
        this.clock = clock;
    }

    public String report() {
        return "report at " + clock.instant() + " for " + repository;
    }
}
