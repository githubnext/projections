package projections.spring;

import java.lang.annotation.Annotation;
import java.lang.reflect.Method;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import org.springframework.beans.factory.config.BeanDefinition;
import org.springframework.beans.factory.support.AbstractBeanDefinition;

/** What a bean definition declares about its registration: precedence, laziness, qualifiers, ordering, role and conditions. */
final class DefinitionFacts {
    private DefinitionFacts() {}

    static void put(Map<String, Object> data, BeanDefinition definition, Method method, boolean proxied, Map<String, List<String>> conditions) {
        if (definition.isPrimary()) data.put("primary", true);
        if (fallback(definition)) data.put("fallback", true);
        if (definition.isLazyInit()) data.put("lazy", true);
        // A scoped target is never injected itself; its proxy is.
        if (!definition.isAutowireCandidate() && !proxied) data.put("autowireCandidate", false);
        List<String> qualifiers = new ArrayList<>(BeanTypes.qualifiers(method != null ? method.getAnnotations()
            : BeanTypes.beanClass(definition) != null ? BeanTypes.beanClass(definition).getAnnotations() : new Annotation[0]));
        if (definition instanceof AbstractBeanDefinition abstractDefinition) {
            abstractDefinition.getQualifiers().forEach(qualifier -> qualifiers.add(String.valueOf(qualifier.getAttribute("value"))));
        }
        if (!qualifiers.isEmpty()) data.put("qualifiers", BeanTypes.sorted(qualifiers));
        if (definition.getDependsOn() != null && definition.getDependsOn().length > 0) data.put("initializedAfter", BeanTypes.sorted(Arrays.asList(definition.getDependsOn())));
        data.put("role", switch (definition.getRole()) {
            case BeanDefinition.ROLE_SUPPORT -> "support";
            case BeanDefinition.ROLE_INFRASTRUCTURE -> "infrastructure";
            default -> "application";
        });
        List<String> reasons = new ArrayList<>();
        if (method != null) reasons.addAll(conditions.getOrDefault(method.getDeclaringClass().getName() + "#" + method.getName(), List.of()));
        Class<?> type = method != null ? method.getDeclaringClass() : BeanTypes.beanClass(definition);
        if (type != null) reasons.addAll(conditions.getOrDefault(type.getName(), List.of()));
        if (!reasons.isEmpty()) data.put("conditions", reasons);
    }

    private static boolean fallback(BeanDefinition definition) {
        try {
            return (boolean) definition.getClass().getMethod("isFallback").invoke(definition);
        } catch (ReflectiveOperationException error) {
            return false;
        }
    }
}
