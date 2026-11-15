package projections.spring;

import java.lang.annotation.Annotation;
import java.lang.reflect.Constructor;
import java.lang.reflect.Executable;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.lang.reflect.Modifier;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.config.DependencyDescriptor;
import org.springframework.beans.factory.support.RootBeanDefinition;
import org.springframework.core.MethodParameter;

/** Where Spring would inject into a bean it did not create, and the candidates it would choose, without creating any bean. */
final class InjectionPoints {
    private final Composition composition;
    private final RecordingBeanFactory factory;

    InjectionPoints(Composition composition) {
        this.composition = composition;
        this.factory = composition.factory;
    }

    /** The injection points Spring would use to create the bean: its constructor or factory method, and @Autowired members. */
    List<DependencyDescriptor> injectionPoints(Composition.Bean bean) {
        List<DependencyDescriptor> points = new ArrayList<>();
        Method method = composition.factoryMethod(bean.definition());
        Class<?> type = BeanTypes.beanClass(bean.definition());
        Executable executable = method;
        if (executable == null && type != null) {
            Constructor<?>[] constructors = null;
            try { constructors = factory.constructors(type, bean.definitionName()); } catch (RuntimeException ignored) { /* Fall back below. */ }
            if (constructors == null && bean.definition() instanceof RootBeanDefinition root) constructors = root.getPreferredConstructors();
            if (constructors == null) {
                Constructor<?>[] declared = type.getDeclaredConstructors();
                constructors = declared.length == 1 ? declared
                    : Arrays.stream(declared).filter(item -> item.getParameterCount() == 0).toArray(Constructor<?>[]::new);
            }
            executable = Arrays.stream(constructors).max(Comparator.comparingInt(Constructor::getParameterCount)).orElse(null);
        }
        if (executable != null) {
            for (int index = 0; index < executable.getParameterCount(); index++) {
                points.add(discovering(new DependencyDescriptor(MethodParameter.forExecutable(executable, index), true)));
            }
        }
        for (Class<?> current = type; current != null && current != Object.class; current = current.getSuperclass()) {
            for (Field field : current.getDeclaredFields()) {
                if (Modifier.isStatic(field.getModifiers())) continue;
                Boolean required = injected(field.getAnnotations());
                if (required != null) points.add(new DependencyDescriptor(field, required));
            }
            for (Method member : current.getDeclaredMethods()) {
                if (Modifier.isStatic(member.getModifiers())) continue;
                Boolean required = injected(member.getAnnotations());
                if (required == null) continue;
                for (int index = 0; index < member.getParameterCount(); index++) {
                    points.add(discovering(new DependencyDescriptor(new MethodParameter(member, index), required)));
                }
            }
        }
        return points;
    }

    /** Parameter names take part in candidate selection, as in the bean factory's own resolution. */
    private DependencyDescriptor discovering(DependencyDescriptor descriptor) {
        descriptor.initParameterNameDiscovery(factory.getParameterNameDiscoverer());
        return descriptor;
    }

    /** Whether a member is injected (`@Autowired`, `@Inject`), and if so whether it is required. */
    private static Boolean injected(Annotation[] annotations) {
        for (Annotation annotation : annotations) {
            if (annotation instanceof Autowired autowired) return autowired.required();
            if (annotation.annotationType().getName().equals("jakarta.inject.Inject")) return true;
        }
        return null;
    }

    /** Spring's own candidate selection for an injection point, without creating any bean. */
    List<String> candidates(String bean, DependencyDescriptor descriptor, Class<?> elementType, boolean nested, boolean collection) {
        try {
            DependencyDescriptor element = discovering(new DependencyDescriptor(descriptor));
            if (nested) element.increaseNestingLevel();
            Map<String, Object> found = factory.candidates(bean, elementType, element);
            if (found.isEmpty()) return List.of();
            if (collection) return new ArrayList<>(found.keySet());
            if (found.size() == 1) return new ArrayList<>(found.keySet());
            String chosen = factory.choose(found, element);
            return chosen == null ? List.of() : List.of(chosen);
        } catch (RuntimeException error) {
            return List.of();
        }
    }
}
