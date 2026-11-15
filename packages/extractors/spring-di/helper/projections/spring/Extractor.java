package projections.spring;

import java.io.IOException;
import java.io.PrintStream;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.lang.reflect.Proxy;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicReference;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.SpringApplicationHook;
import org.springframework.boot.SpringApplicationRunListener;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;
import org.springframework.core.env.ConfigurableEnvironment;
import org.springframework.core.env.MapPropertySource;

/**
 * `spring-di`: the application's Spring Boot context, built by its own main method
 * and its own Spring, read from the bean factory.
 *
 * <p>The main method runs under a {@link SpringApplicationHook} (the mechanism Spring
 * Boot's AOT processing uses) that makes the application non-web and eager, records
 * every dependency the bean factory resolves, and abandons the run once the context
 * is refreshed: no web server starts and no runner is called.
 */
public final class Extractor {
    private Extractor() {}

    record Options(String mainClass, String include, List<Path> classes, Map<String, Object> properties, List<String> arguments) {}

    public static void main(String[] args) throws Exception {
        PrintStream output = System.out;
        // The application logs to standard output; only the extraction may.
        System.setOut(System.err);
        try {
            Options options = options(args);
            String state = extract(options);
            output.print(state);
            output.flush();
            System.exit(0);
        } catch (Failure failure) {
            System.err.println(failure.getMessage());
            System.exit(1);
        }
    }

    static final class Failure extends Exception {
        Failure(String message, Throwable cause) { super(message, cause); }
        Failure(String message) { super(message); }
    }

    static Options options(String[] args) throws IOException {
        String mainClass = null;
        String include = "application";
        List<Path> classes = new ArrayList<>();
        Map<String, Object> properties = new LinkedHashMap<>();
        for (int index = 0; index < args.length; index++) {
            switch (args[index]) {
                case "--main-class" -> mainClass = args[++index];
                case "--include" -> include = args[++index];
                case "--classes" -> classes.add(Path.of(args[++index]));
                case "--properties" -> {
                    for (String line : Files.readAllLines(Path.of(args[++index]), StandardCharsets.UTF_8)) {
                        int separator = line.indexOf('=');
                        if (separator > 0) properties.put(line.substring(0, separator), line.substring(separator + 1));
                    }
                }
                default -> throw new IllegalArgumentException("Unknown argument " + args[index]);
            }
        }
        return new Options(mainClass, include, classes, properties, List.of());
    }

    static String extract(Options options) throws Failure {
        System.setProperty("spring.devtools.restart.enabled", "false");
        Class<?> application = MainClass.find(options);
        Method main;
        try {
            main = application.getMethod("main", String[].class);
        } catch (NoSuchMethodException error) {
            throw new Failure(application.getName() + " has no public static main(String[]) method", error);
        }
        Map<String, Object> properties = new LinkedHashMap<>();
        properties.put("spring.main.web-application-type", "none");
        properties.put("spring.main.lazy-initialization", "false");
        properties.putAll(options.properties());
        AtomicReference<ConfigurableApplicationContext> captured = new AtomicReference<>();
        // A proxy implements the run listener, so the helper names no type whose package
        // differs between Spring Boot versions (the bootstrap context moved in Spring Boot 4).
        SpringApplicationHook hook = springApplication -> {
            springApplication.setApplicationContextFactory(type -> new AnnotationConfigApplicationContext(new RecordingBeanFactory()));
            return (SpringApplicationRunListener) Proxy.newProxyInstance(Extractor.class.getClassLoader(),
                new Class<?>[] {SpringApplicationRunListener.class}, (proxy, method, arguments) -> {
                    if (method.getName().equals("environmentPrepared")) {
                        ConfigurableEnvironment environment = (ConfigurableEnvironment) arguments[arguments.length - 1];
                        environment.getPropertySources().addFirst(new MapPropertySource("projections", properties));
                    } else if (method.getName().equals("started")) {
                        ConfigurableApplicationContext context = (ConfigurableApplicationContext) arguments[0];
                        captured.set(context);
                        throw new SpringApplication.AbandonedRunException(context);
                    } else if (method.getDeclaringClass() == Object.class) {
                        return switch (method.getName()) {
                            case "equals" -> proxy == arguments[0];
                            case "hashCode" -> System.identityHashCode(proxy);
                            default -> "projections";
                        };
                    }
                    return null;
                });
        };
        try {
            SpringApplication.withHook(hook, () -> {
                try {
                    main.invoke(null, (Object) new String[0]);
                } catch (InvocationTargetException error) {
                    if (error.getCause() instanceof RuntimeException runtime) throw runtime;
                    throw new IllegalStateException(error.getCause());
                } catch (IllegalAccessException error) {
                    throw new IllegalStateException(error);
                }
            });
        } catch (SpringApplication.AbandonedRunException expected) {
            // The context was captured once it refreshed.
        } catch (RuntimeException error) {
            if (captured.get() == null) {
                Throwable cause = error instanceof IllegalStateException && error.getCause() != null ? error.getCause() : error;
                throw new Failure("Spring could not build " + application.getName() + "'s application context: " + describe(cause), cause);
            }
        }
        ConfigurableApplicationContext context = captured.get();
        if (context == null) {
            throw new Failure(application.getName() + ".main returned without running a SpringApplication; set inputs.mainClass to the class whose main method runs the application");
        }
        if (!(context.getBeanFactory() instanceof RecordingBeanFactory factory)) {
            throw new Failure("The application replaced Spring Boot's application context factory; spring-di needs its own to record dependency resolution");
        }
        try {
            return Json.write(new Composition(factory, application, options).extraction());
        } finally {
            try { context.close(); } catch (RuntimeException ignored) { /* Shutdown failures do not change the composition. */ }
        }
    }

    private static String describe(Throwable error) {
        StringBuilder message = new StringBuilder(String.valueOf(error.getMessage()));
        for (Throwable cause = error.getCause(); cause != null && cause != cause.getCause(); cause = cause.getCause()) {
            if (cause.getMessage() != null && !message.toString().contains(cause.getMessage())) message.append(": ").append(cause.getMessage());
        }
        return message.toString();
    }

}
