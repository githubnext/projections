package projections.spring;

import java.lang.reflect.Constructor;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.beans.BeansException;
import org.springframework.beans.TypeConverter;
import org.springframework.beans.factory.config.DependencyDescriptor;
import org.springframework.beans.factory.support.DefaultListableBeanFactory;

/**
 * The application's own bean factory, recording each dependency it resolves: the
 * requesting bean, the injection point and the bean names Spring chose. Resolution
 * itself is unchanged.
 */
final class RecordingBeanFactory extends DefaultListableBeanFactory {
    record Injection(String bean, DependencyDescriptor descriptor, Set<String> names) {}

    final List<Injection> injections = Collections.synchronizedList(new ArrayList<>());

    @Override
    public Object resolveDependency(DependencyDescriptor descriptor, String requestingBeanName,
            Set<String> autowiredBeanNames, TypeConverter typeConverter) throws BeansException {
        Set<String> names = autowiredBeanNames != null ? autowiredBeanNames : new LinkedHashSet<>();
        Object value = super.resolveDependency(descriptor, requestingBeanName, names, typeConverter);
        if (requestingBeanName != null) injections.add(new Injection(requestingBeanName, descriptor, new LinkedHashSet<>(names)));
        return value;
    }

    /** Spring's candidates for a dependency: instances where they exist, otherwise types, so nothing is created. */
    Map<String, Object> candidates(String bean, Class<?> type, DependencyDescriptor descriptor) {
        return findAutowireCandidates(bean, type, descriptor);
    }

    /** Spring's choice among several candidates: primary, then priority, then name. */
    String choose(Map<String, Object> candidates, DependencyDescriptor descriptor) {
        return determineAutowireCandidate(candidates, descriptor);
    }

    /** The constructors bean post-processors select (`@Autowired`, a single constructor), as at creation. */
    Constructor<?>[] constructors(Class<?> type, String bean) {
        return determineConstructorsFromBeanPostProcessors(type, bean);
    }
}
