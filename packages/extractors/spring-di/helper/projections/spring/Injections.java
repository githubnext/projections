package projections.spring;

import java.lang.annotation.Annotation;
import java.lang.reflect.Constructor;
import java.lang.reflect.Executable;
import java.lang.reflect.Method;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.TreeMap;
import org.springframework.aop.scope.ScopedProxyUtils;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.beans.factory.config.DependencyDescriptor;
import org.springframework.core.MethodParameter;
import org.springframework.core.ResolvableType;
import org.springframework.util.ClassUtils;

/** What each bean injects, recorded while the context refreshed or resolved without creating the bean. */
final class Injections {
    private final Composition composition;
    private final RecordingBeanFactory factory;
    private final InjectionPoints resolver;

    Injections(Composition composition) {
        this.composition = composition;
        this.factory = composition.factory;
        this.resolver = new InjectionPoints(composition);
    }

    /** What each bean injects: as recorded while the context refreshed, otherwise resolved without creating it. */
    Map<String, List<Composition.Dependency>> dependencies(Map<String, Composition.Bean> beans) {
        Map<String, Map<String, Composition.Dependency>> result = new TreeMap<>();
        List<RecordingBeanFactory.Injection> injections;
        synchronized (factory.injections) { injections = new ArrayList<>(factory.injections); }
        for (RecordingBeanFactory.Injection injection : injections) {
            String bean = ScopedProxyUtils.isScopedTarget(injection.bean()) ? ScopedProxyUtils.getOriginalBeanName(injection.bean()) : injection.bean();
            if (!beans.containsKey(bean)) continue;
            Composition.Dependency dependency = describe(bean, beans.get(bean), injection.descriptor(), injection.names(), "authoritative", beans);
            if (dependency != null) result.computeIfAbsent(bean, key -> new TreeMap<>()).putIfAbsent(dependency.point(), dependency);
        }
        for (Composition.Bean bean : beans.values()) {
            if (result.containsKey(bean.name()) || bean.definition() == null) continue;
            if (factory.containsSingleton(bean.definitionName()) && !bean.proxied()) continue;
            for (DependencyDescriptor descriptor : resolver.injectionPoints(bean)) {
                Composition.Dependency dependency = describe(bean.name(), bean, descriptor, Set.of(), "derived", beans);
                if (dependency != null) result.computeIfAbsent(bean.name(), key -> new TreeMap<>()).putIfAbsent(dependency.point(), dependency);
            }
        }
        Map<String, List<Composition.Dependency>> lists = new TreeMap<>();
        result.forEach((bean, points) -> lists.put(bean, new ArrayList<>(points.values())));
        return lists;
    }

    private Composition.Dependency describe(String bean, Composition.Bean owner, DependencyDescriptor descriptor, Set<String> resolved, String confidence, Map<String, Composition.Bean> beans) {
        for (Annotation annotation : descriptor.getAnnotations()) if (annotation instanceof Value) return null;
        String point;
        String injection;
        Integer position = null;
        String parameter = descriptor.getDependencyName();
        Method factoryMethod = composition.factoryMethod(owner.definition());
        if (descriptor.getField() != null) {
            injection = "field";
            parameter = descriptor.getField().getName();
            point = "field:" + parameter;
        } else {
            MethodParameter methodParameter = descriptor.getMethodParameter();
            if (methodParameter == null) return null;
            position = methodParameter.getParameterIndex();
            Executable executable = methodParameter.getExecutable();
            if (executable instanceof Constructor<?>) {
                injection = "constructor";
                point = "constructor:" + position;
            } else if (factoryMethod != null && executable.getName().equals(factoryMethod.getName())) {
                injection = "factory-method";
                point = "factory-method:" + position;
            } else {
                injection = "method";
                point = "method:" + executable.getName() + ":" + position;
            }
            if (parameter == null) parameter = methodParameter.getParameter().getName();
        }
        ResolvableType type = descriptor.getResolvableType();
        Class<?> raw = type.resolve(Object.class);
        boolean annotatedLazy = Arrays.stream(descriptor.getAnnotations())
            .anyMatch(annotation -> annotation.annotationType().getName().equals("org.springframework.context.annotation.Lazy"));
        boolean provider = ObjectProvider.class.isAssignableFrom(raw) || raw.getName().equals("jakarta.inject.Provider");
        boolean lazy = provider || annotatedLazy;
        boolean wrapped = provider || raw == Optional.class;
        boolean collection = !wrapped && (raw.isArray() || Collection.class.isAssignableFrom(raw) || Map.class.isAssignableFrom(raw));
        ResolvableType element = wrapped ? type.getGeneric(0)
            : raw.isArray() ? type.getComponentType()
            : Collection.class.isAssignableFrom(raw) ? type.asCollection().getGeneric(0)
            : Map.class.isAssignableFrom(raw) ? type.asMap().getGeneric(1) : type;
        Class<?> elementType = element.resolve();
        if (elementType == null || elementType.isPrimitive() || elementType == String.class || ClassUtils.isPrimitiveWrapper(elementType)) return null;
        boolean optional = !descriptor.isRequired() || raw == Optional.class || lazy;
        List<String> targets = new ArrayList<>();
        for (String name : resolved.isEmpty() ? resolver.candidates(bean, descriptor, elementType, wrapped || collection, collection) : resolved) {
            String canonical = factory.canonicalName(ScopedProxyUtils.isScopedTarget(name) ? ScopedProxyUtils.getOriginalBeanName(name) : name);
            // Resolvable dependencies that are not beans (the BeanFactory itself) have no bean name.
            if (beans.containsKey(canonical) && !targets.contains(canonical)) targets.add(canonical);
        }
        if (targets.isEmpty()) return null;
        List<String> qualifiers = BeanTypes.qualifiers(descriptor.getAnnotations());
        return new Composition.Dependency(bean, point, injection, parameter, position, BeanTypes.typeName(elementType),
            qualifiers.isEmpty() ? null : qualifiers.get(0), optional, collection, lazy, targets, confidence);
    }

}
