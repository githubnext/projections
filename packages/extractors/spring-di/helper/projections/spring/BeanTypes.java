package projections.spring;

import java.lang.annotation.Annotation;
import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.TreeSet;
import org.springframework.aop.framework.AopProxyUtils;
import org.springframework.beans.factory.FactoryBean;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.beans.factory.config.BeanDefinition;
import org.springframework.beans.factory.support.AbstractBeanDefinition;
import org.springframework.core.annotation.AnnotationUtils;
import org.springframework.util.ClassUtils;

/** Bean definition classes, type names and qualifiers, as the extraction writes them. */
final class BeanTypes {
    private BeanTypes() {}

    static Class<?> beanClass(BeanDefinition definition) {
        return definition instanceof AbstractBeanDefinition abstractDefinition && abstractDefinition.hasBeanClass()
            ? ClassUtils.getUserClass(abstractDefinition.getBeanClass()) : null;
    }

    /** The class an instance of the bean actually is, without creating one. */
    static Class<?> implementationType(RecordingBeanFactory factory, Composition.Bean bean) {
        Class<?> type = null;
        if (factory.containsSingleton(bean.definitionName())) {
            Object instance = factory.getSingleton(bean.definitionName());
            if (instance != null && !(instance instanceof FactoryBean<?>)) type = AopProxyUtils.ultimateTargetClass(instance);
        }
        if (type == null) type = factory.getType(bean.definitionName(), false);
        if (type == null) return null;
        type = ClassUtils.getUserClass(type);
        // A lambda or other generated class has no stable name; its declared type stands in.
        return type.isSynthetic() || type.isHidden() || type.getName().contains("$$") ? null : type;
    }

    /** The type's name as Java source spells it (`java.time.Clock.SystemClock`), else its binary name. */
    static String typeName(Class<?> type) {
        String canonical = type.getCanonicalName();
        return canonical != null ? canonical : type.getName();
    }

    static List<String> qualifiers(Annotation[] annotations) {
        List<String> values = new ArrayList<>();
        for (Annotation annotation : annotations) {
            Class<? extends Annotation> type = annotation.annotationType();
            if (type == Qualifier.class || type.isAnnotationPresent(Qualifier.class) || type.getName().equals("jakarta.inject.Named")) {
                Object value = AnnotationUtils.getValue(annotation);
                values.add(value == null || "".equals(value) ? "@" + type.getSimpleName() : value.toString());
            }
        }
        return values;
    }

    static List<String> sorted(Collection<String> values) {
        return new ArrayList<>(new TreeSet<>(values));
    }
}
