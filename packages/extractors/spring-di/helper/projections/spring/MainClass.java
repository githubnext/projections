package projections.spring;

import java.io.IOException;
import java.lang.reflect.Method;
import java.lang.reflect.Modifier;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Set;
import java.util.TreeSet;
import java.util.stream.Stream;
import org.springframework.core.annotation.MergedAnnotations;

/** The application's main class: the configured one, or the one `@SpringBootApplication` class with a main method. */
final class MainClass {
    private static final String BOOT_APPLICATION = "org.springframework.boot.autoconfigure.SpringBootApplication";

    private MainClass() {}

    /** The configured main class, or the one `@SpringBootApplication` class in the project's own output. */
    static Class<?> find(Extractor.Options options) throws Extractor.Failure {
        ClassLoader loader = Thread.currentThread().getContextClassLoader();
        if (options.mainClass() != null) {
            try {
                return Class.forName(options.mainClass(), false, loader);
            } catch (ClassNotFoundException error) {
                throw new Extractor.Failure("inputs.mainClass " + options.mainClass() + " is not on the application's runtime classpath", error);
            }
        }
        Set<String> found = new TreeSet<>();
        for (Path directory : options.classes()) {
            if (!Files.isDirectory(directory)) continue;
            try (Stream<Path> files = Files.walk(directory)) {
                for (Path file : (Iterable<Path>) files.filter(item -> item.toString().endsWith(".class"))::iterator) {
                    String name = directory.relativize(file).toString().replace(file.getFileSystem().getSeparator(), ".");
                    name = name.substring(0, name.length() - ".class".length());
                    if (name.endsWith("module-info") || name.endsWith("package-info")) continue;
                    try {
                        Class<?> candidate = Class.forName(name, false, loader);
                        if (MergedAnnotations.from(candidate).isPresent(BOOT_APPLICATION) && hasMain(candidate)) found.add(candidate.getName());
                    } catch (Throwable ignored) {
                        // A class that cannot be loaded is not the application's entry point.
                    }
                }
            } catch (IOException error) {
                throw new Extractor.Failure("Cannot read the application's classes in " + directory, error);
            }
        }
        if (found.size() != 1) {
            throw new Extractor.Failure(found.isEmpty()
                ? "No @SpringBootApplication class with a main method was found in the project's classes. Set inputs.mainClass."
                : "More than one @SpringBootApplication class with a main method was found (" + String.join(", ", found) + "). Set inputs.mainClass.");
        }
        try {
            return Class.forName(found.iterator().next(), false, loader);
        } catch (ClassNotFoundException error) {
            throw new Extractor.Failure("Cannot load " + found.iterator().next(), error);
        }
    }

    private static boolean hasMain(Class<?> type) {
        try {
            Method main = type.getMethod("main", String[].class);
            return Modifier.isStatic(main.getModifiers());
        } catch (NoSuchMethodException error) {
            return false;
        }
    }
}
