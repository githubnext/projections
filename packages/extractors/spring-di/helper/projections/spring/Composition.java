package projections.spring;

import java.lang.reflect.Method;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.TreeSet;
import org.springframework.aop.scope.ScopedProxyUtils;
import org.springframework.beans.factory.config.BeanDefinition;
import org.springframework.beans.factory.support.AbstractBeanDefinition;
import org.springframework.beans.factory.support.RootBeanDefinition;
import org.springframework.core.SpringVersion;
import org.springframework.util.ClassUtils;

/** The bean factory as the shared dependency-injection model. */
final class Composition {
    final RecordingBeanFactory factory;
    private final Class<?> application;
    private final Extractor.Options options;
    private final List<String> packages;
    final Map<String, List<String>> conditions;
    private final Map<String, Map<String, Object>> entities = new TreeMap<>();
    private final Map<String, Map<String, Object>> relationships = new TreeMap<>();

    record Bean(String name, String definitionName, BeanDefinition definition, boolean proxied) {}

    record Dependency(String bean, String point, String injection, String parameter, Integer position, String requestedType,
            String qualifier, boolean optional, boolean collection, boolean lazy, List<String> targets, String confidence) {}

    Composition(RecordingBeanFactory factory, Class<?> application, Extractor.Options options) {
        this.factory = factory;
        this.application = application;
        this.options = options;
        this.packages = BootReports.autoConfigurationPackages(application, factory);
        this.conditions = BootReports.conditions(application, factory);
    }

    private boolean applicationClass(Class<?> type) {
        if (type == null) return false;
        String name = ClassUtils.getUserClass(type).getName();
        return packages.stream().anyMatch(prefix -> name.startsWith(prefix + "."));
    }

    /** Every bean, with a scoped proxy and its `scopedTarget.` definition folded into one. */
    private List<Bean> beans() {
        Map<String, Bean> beans = new TreeMap<>();
        for (String name : factory.getBeanDefinitionNames()) {
            if (ScopedProxyUtils.isScopedTarget(name)) continue;
            String target = ScopedProxyUtils.getTargetBeanName(name);
            boolean proxied = factory.containsBeanDefinition(target);
            String definitionName = proxied ? target : name;
            beans.put(name, new Bean(name, definitionName, factory.getMergedBeanDefinition(definitionName), proxied));
        }
        for (String name : factory.getSingletonNames()) {
            if (!beans.containsKey(name) && !ScopedProxyUtils.isScopedTarget(name) && !name.startsWith("&")) beans.put(name, new Bean(name, name, null, false));
        }
        return new ArrayList<>(beans.values());
    }

    Method factoryMethod(BeanDefinition definition) {
        if (definition == null || definition.getFactoryMethodName() == null) return null;
        if (definition instanceof RootBeanDefinition root && root.getResolvedFactoryMethod() != null) return root.getResolvedFactoryMethod();
        Class<?> owner = definition.getFactoryBeanName() != null ? factory.getType(definition.getFactoryBeanName(), false)
            : definition instanceof AbstractBeanDefinition abstractDefinition && abstractDefinition.hasBeanClass() ? abstractDefinition.getBeanClass() : null;
        if (owner == null) return null;
        return Arrays.stream(ClassUtils.getUserClass(owner).getDeclaredMethods())
            .filter(method -> method.getName().equals(definition.getFactoryMethodName()))
            .max(Comparator.comparingInt(Method::getParameterCount)).orElse(null);
    }

    Map<String, Object> extraction() {
        List<Bean> beans = beans();
        Map<String, Bean> byName = new LinkedHashMap<>();
        for (Bean bean : beans) byName.put(bean.name(), bean);
        Map<String, List<Dependency>> dependencies = new Injections(this).dependencies(byName);

        Set<String> kept = new TreeSet<>();
        boolean all = "all".equals(options.include());
        for (Bean bean : beans) if (all || origin(bean).equals("application")) kept.add(bean.name());
        for (String name : new ArrayList<>(kept)) {
            for (Dependency dependency : dependencies.getOrDefault(name, List.of())) kept.addAll(dependency.targets());
        }

        for (Bean bean : beans) {
            if (kept.contains(bean.name())) new Registration(this).add(bean);
        }
        for (String name : kept) {
            for (Dependency dependency : dependencies.getOrDefault(name, List.of())) {
                for (String target : dependency.targets()) {
                    if (!kept.contains(target)) continue;
                    Map<String, Object> data = new LinkedHashMap<>();
                    data.put("injection", dependency.injection());
                    if (dependency.parameter() != null) data.put("parameter", dependency.parameter());
                    if (dependency.position() != null) data.put("position", dependency.position());
                    data.put("requestedType", dependency.requestedType());
                    if (dependency.qualifier() != null) data.put("qualifier", dependency.qualifier());
                    data.put("optional", dependency.optional());
                    data.put("collection", dependency.collection());
                    if (dependency.lazy()) data.put("lazy", true);
                    Map<String, Object> relationship = new LinkedHashMap<>();
                    String id = "implementation:" + name + ":dependsOn:" + dependency.point() + (dependency.collection() ? ":" + target : "");
                    relationship.put("id", id);
                    relationship.put("kind", "dependsOn");
                    relationship.put("from", "implementation:" + name);
                    relationship.put("to", "service:" + target);
                    if (dependency.parameter() != null) relationship.put("label", dependency.parameter());
                    relationship.put("data", data);
                    relationship.put("confidence", dependency.confidence());
                    relationships.put(id, relationship);
                }
            }
        }

        Map<String, Object> metadata = new LinkedHashMap<>();
        metadata.put("springFramework", SpringVersion.getVersion());
        String boot = bootVersion();
        if (boot != null) metadata.put("springBoot", boot);
        metadata.put("mainClass", application.getName());
        metadata.put("include", options.include());
        metadata.put("applicationPackages", packages);
        metadata.put("limitations", List.of(
            "Built without a web server (spring.main.web-application-type=none) and abandoned before runners: web-only auto-configuration is absent.",
            "Dependencies are the bean factory's own resolutions while the context refreshed; beans it did not create (prototypes never requested, request or session scoped targets, lazy beans) are resolved from their constructors, factory methods and @Autowired members without creating them, and are derived.",
            "Resolvable dependencies that are not beans (BeanFactory, ApplicationContext, ResourceLoader, ApplicationEventPublisher) and @Value injections are not dependencies.",
            all ? "Every bean, including Spring's infrastructure." : "Beans defined in the application's packages, plus the beans they inject."));
        Map<String, Object> extraction = new LinkedHashMap<>();
        extraction.put("protocolVersion", 0);
        extraction.put("schema", "architecture/v0");
        extraction.put("entities", new ArrayList<>(entities.values()));
        extraction.put("relationships", new ArrayList<>(relationships.values()));
        extraction.put("metadata", metadata);
        return extraction;
    }

    private static String bootVersion() {
        try {
            Object version = Class.forName("org.springframework.boot.SpringBootVersion").getMethod("getVersion").invoke(null);
            return version == null ? null : version.toString();
        } catch (ReflectiveOperationException error) {
            return null;
        }
    }

    String origin(Bean bean) {
        if (bean.definition() == null) return "framework";
        Method method = factoryMethod(bean.definition());
        Class<?> defining = method != null ? method.getDeclaringClass() : BeanTypes.beanClass(bean.definition());
        return applicationClass(defining) ? "application" : "framework";
    }

    void entity(String id, String kind, String label, Map<String, Object> data) {
        Map<String, Object> entity = new LinkedHashMap<>();
        entity.put("id", id);
        entity.put("kind", kind);
        entity.put("label", label);
        entity.put("data", data);
        entities.put(id, entity);
    }

    void relationship(String id, String kind, String from, String to) {
        Map<String, Object> relationship = new LinkedHashMap<>();
        relationship.put("id", id);
        relationship.put("kind", kind);
        relationship.put("from", from);
        relationship.put("to", to);
        relationships.put(id, relationship);
    }
}
