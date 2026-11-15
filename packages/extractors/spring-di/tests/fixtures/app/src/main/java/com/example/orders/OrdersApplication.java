package com.example.orders;

import java.nio.file.Files;
import java.nio.file.Path;
import org.springframework.boot.CommandLineRunner;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.context.annotation.Bean;

@SpringBootApplication
public class OrdersApplication {
    public static void main(String[] args) {
        SpringApplication.run(OrdersApplication.class, args);
    }

    /** Projections never runs runners: the run is abandoned once the context is refreshed. */
    @Bean
    CommandLineRunner seed() {
        return args -> Files.writeString(Path.of("runner-ran.txt"), "seeded");
    }
}
