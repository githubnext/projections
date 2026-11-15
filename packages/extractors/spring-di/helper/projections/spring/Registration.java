package projections.spring;

import java.lang.reflect.Method;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.Map;
import org.springframework.beans.factory.FactoryBean;
import org.springframework.beans.factory.annotation.AnnotatedBeanDefinition;
import org.springframework.beans.factory.config.BeanDefinition;

/** A bean's registration: its service, registration and implementation entities and their facts. */
final class Registration {
    private final Composition composition;
    private final RecordingBeanFactory factory;

    Registration(Composition composition) {
        this.composition = composition;
        this.factory = composition.factory;
    }

    void add(Composition.Bean bean) {
        BeanDefinition definition = bean.definition();
        Method method = composition.factoryMethod(definition);
        Class<?> declared = method != null ? method.getReturnType() : BeanTypes.beanClass(definition);
        Class<?> implementation = BeanTypes.implementationType(factory, bean);
        if (implementation == null && definition != null) implementation = method != null ? method.getReturnType() : BeanTypes.beanClass(definition);
        String kind;
        if (definition == null) kind = "instance";
        else if (definition.getFactoryMethodName() != null) kind = "factory-method";
        else if (declared != null && FactoryBean.class.isAssignableFrom(declared)) kind = "factory-bean";
        else if (factory.containsBeanDefinition(bean.definitionName())
            && factory.getBeanDefinition(bean.definitionName()) instanceof AnnotatedBeanDefinition) kind = "component";
        else kind = "class";
        if (declared == null || FactoryBean.class.isAssignableFrom(declared) || definition == null) declared = implementation;

        String service = "service:" + bean.name();
        String registration = service + ":registration";
        Map<String, Object> serviceData = new LinkedHashMap<>();
        if (declared != null) serviceData.put("type", BeanTypes.typeName(declared));
        serviceData.put("name", bean.name());
        String[] aliases = factory.getAliases(bean.name());
        if (aliases.length > 0) serviceData.put("aliases", BeanTypes.sorted(Arrays.asList(aliases)));
        composition.entity(service, "service", bean.name(), serviceData);

        String scope = scopeOf(definition);
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("lifetime", lifetime(scope));
        data.put("scope", scope);
        data.put("ordinal", 0);
        data.put("registrationKind", kind);
        if (implementation != null) data.put("implementation", BeanTypes.typeName(implementation));
        if (method != null) {
            data.put("factory", method.getDeclaringClass().getName() + "#" + method.getName() + "("
                + String.join(",", Arrays.stream(method.getParameterTypes()).map(Class::getSimpleName).toList()) + ")");
        }
        if (definition != null) DefinitionFacts.put(data, definition, method, bean.proxied(), composition.conditions);
        if (bean.proxied()) data.put("proxied", true);
        data.put("origin", composition.origin(bean));
        composition.entity(registration, "registration", bean.name() + " (" + scope + ")", data);
        composition.relationship(registration + ":binds", "registration", service, registration);
        if (implementation != null) {
            String id = "implementation:" + bean.name();
            composition.entity(id, "implementation", implementation.getSimpleName().isEmpty() ? implementation.getName() : implementation.getSimpleName(),
                new LinkedHashMap<>(Map.of("type", BeanTypes.typeName(implementation))));
            composition.relationship(registration + ":implements", "implements", registration, id);
        }
    }

    private static String scopeOf(BeanDefinition definition) {
        if (definition == null) return "singleton";
        String scope = definition.getScope();
        return scope == null || scope.isEmpty() ? "singleton" : scope;
    }

    private static String lifetime(String scope) {
        return switch (scope) {
            case "singleton", "application" -> "singleton";
            case "prototype" -> "transient";
            default -> "scoped";
        };
    }
}
