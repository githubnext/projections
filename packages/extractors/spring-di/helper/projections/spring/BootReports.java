package projections.spring;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;

/** What Spring Boot reports about the application, read reflectively: its auto-configuration packages and condition evaluation. */
final class BootReports {
    private static final String AUTO_CONFIGURATION_PACKAGES = "org.springframework.boot.autoconfigure.AutoConfigurationPackages";
    private static final String CONDITION_REPORT = "org.springframework.boot.autoconfigure.condition.ConditionEvaluationReport";

    private BootReports() {}

    @SuppressWarnings("unchecked")
    static List<String> autoConfigurationPackages(Class<?> application, RecordingBeanFactory factory) {
        try {
            Class<?> type = Class.forName(AUTO_CONFIGURATION_PACKAGES, false, application.getClassLoader());
            if ((boolean) type.getMethod("has", org.springframework.beans.factory.BeanFactory.class).invoke(null, factory)) {
                return (List<String>) type.getMethod("get", org.springframework.beans.factory.BeanFactory.class).invoke(null, factory);
            }
        } catch (ReflectiveOperationException ignored) {
            // Without Spring Boot's auto-configuration, the main class's package is the application.
        }
        return List.of(application.getPackageName());
    }

    /** Spring Boot's condition evaluation report: why each configuration class and @Bean method was registered. */
    static Map<String, List<String>> conditions(Class<?> application, RecordingBeanFactory factory) {
        Map<String, List<String>> result = new TreeMap<>();
        try {
            Class<?> type = Class.forName(CONDITION_REPORT, false, application.getClassLoader());
            Object report = type.getMethod("get", org.springframework.beans.factory.config.ConfigurableListableBeanFactory.class).invoke(null, factory);
            Map<?, ?> sources = (Map<?, ?>) type.getMethod("getConditionAndOutcomesBySource").invoke(report);
            for (Map.Entry<?, ?> entry : sources.entrySet()) {
                List<String> messages = new ArrayList<>();
                for (Object conditionAndOutcome : (Iterable<?>) entry.getValue()) {
                    Object outcome = conditionAndOutcome.getClass().getMethod("getOutcome").invoke(conditionAndOutcome);
                    Object match = outcome.getClass().getMethod("isMatch").invoke(outcome);
                    Object message = outcome.getClass().getMethod("getMessage").invoke(outcome);
                    if (Boolean.TRUE.equals(match) && message != null) messages.add(message.toString());
                }
                if (!messages.isEmpty()) result.put(String.valueOf(entry.getKey()), messages);
            }
        } catch (ReflectiveOperationException | RuntimeException ignored) {
            // Plain Spring applications have no condition report.
        }
        return result;
    }
}
