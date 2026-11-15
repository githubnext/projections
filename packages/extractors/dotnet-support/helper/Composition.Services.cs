using System.Collections;
using System.Globalization;
using System.Reflection;
using static Projections.Dotnet.Program;

namespace Projections.Dotnet;

/// <summary>The service composition graph (`dotnet-di`) of an IServiceCollection.</summary>
internal static partial class Composition
{
    private static string TypeId(Type type)
    {
        if (type.IsGenericParameter) return $"!{type.GenericParameterPosition}";
        if (type.HasElementType) return TypeId(type.GetElementType()!) + (type.IsArray ? $"[{new string(',', type.GetArrayRank() - 1)}]" : type.IsByRef ? "&" : "*");
        var definition = type.IsGenericType ? type.GetGenericTypeDefinition() : type;
        var id = $"{definition.Assembly.GetName().Name}:{definition.FullName}";
        return type.IsGenericType && !type.IsGenericTypeDefinition ? id + "[" + string.Join(",", type.GetGenericArguments().Select(TypeId)) + "]" : id;
    }

    /// <summary>`KeyedService.AnyKey` of the application's DI version, when it has keyed services.</summary>
    private static object? anyKey;

    private static string KeyId(object? key)
    {
        if (key is null) return "null";
        if (anyKey is not null && ReferenceEquals(key, anyKey)) return "any-key";
        if (key is Type type) return "type:" + TypeId(type);
        if (key is not (string or bool or char or byte or sbyte or short or ushort or int or uint or long or ulong or float or double or decimal or Guid) && !key.GetType().IsEnum)
            throw new InvalidOperationException($"Service key {key.GetType()} has no supported stable identity. Use a primitive, enum, Guid, or Type key.");
        return TypeId(key.GetType()) + ":" + Convert.ToString(key, CultureInfo.InvariantCulture);
    }

    /**
     * The container picks a constructor by resolvability, so inference has to use the
     * same rule rather than guessing: the greediest public constructor whose every
     * parameter is either registered or defaulted is the one that will actually run.
     */
    private static ConstructorInfo? SelectConstructor(Type implementation, Func<ParameterInfo, string?> resolve)
    {
        var constructors = implementation.GetConstructors(BindingFlags.Public | BindingFlags.Instance)
            .OrderByDescending(candidate => candidate.GetParameters().Length).ToArray();
        return constructors.FirstOrDefault(candidate =>
            candidate.GetParameters().All(parameter => parameter.HasDefaultValue || resolve(parameter) is not null));
    }

    private static string? ServiceKeyOf(ParameterInfo parameter)
    {
        var keyed = parameter.GetCustomAttributesData()
            .FirstOrDefault(attribute => attribute.AttributeType.FullName == Di + "FromKeyedServicesAttribute");
        if (keyed is null) return "unkeyed";
        var argument = keyed.ConstructorArguments.Count == 1 ? keyed.ConstructorArguments[0].Value : null;
        return KeyId(argument);
    }

    /**
     * A closed generic parameter is served by an open generic registration, and a
     * sequence parameter is served by every registration of its element type, so
     * both are followed to the service the container will actually resolve.
     */
    private static (string Service, bool Collection)? DependencyTarget(ParameterInfo parameter, HashSet<string> registered)
    {
        var key = ServiceKeyOf(parameter);
        var type = parameter.ParameterType;
        var collection = type.IsGenericType && type.GetGenericTypeDefinition() == typeof(IEnumerable<>);
        var requested = collection ? type.GetGenericArguments()[0] : type;
        var candidates = requested.IsGenericType && !requested.IsGenericTypeDefinition
            ? new[] { requested, requested.GetGenericTypeDefinition() } : new[] { requested };
        foreach (var candidate in candidates)
        {
            var id = $"service:{TypeId(candidate)}:{key}";
            if (registered.Contains(id)) return (id, collection);
        }
        return null;
    }

    private static Graph DependencyInjection(IEnumerable services)
    {
        var graph = new Graph("architecture/v0");
        var ordinals = new Dictionary<string, int>();
        var constructed = new Dictionary<string, Type>();
        var registered = new HashSet<string>();
        foreach (var descriptor in services)
        {
            var descriptorType = descriptor.GetType();
            object? Read(string name) => descriptorType.GetProperty(name, BindingFlags.Public | BindingFlags.Instance)?.GetValue(descriptor);
            anyKey ??= descriptorType.Assembly.GetType(Di + "KeyedService")?.GetProperty("AnyKey", BindingFlags.Public | BindingFlags.Static)?.GetValue(null);
            // Keyed services exist from Microsoft.Extensions.DependencyInjection 8; reading an
            // unkeyed accessor of a keyed descriptor throws, so only the matching set is read.
            var keyed = Read("IsKeyedService") is true;
            var serviceType = (Type)Read("ServiceType")!;
            var lifetime = Read("Lifetime")!.ToString();
            var key = keyed ? KeyId(Read("ServiceKey")) : "unkeyed";
            var service = $"service:{TypeId(serviceType)}:{key}";
            if (!ordinals.TryGetValue(service, out var ordinal))
                graph.Add(service, "service", serviceType.ToString(), new() { ["type"] = TypeId(serviceType), ["key"] = key });
            registered.Add(service);
            ordinals[service] = ordinal + 1;
            var registration = service + $":registration:{ordinal}";
            var implementationType = (Type?)Read(keyed ? "KeyedImplementationType" : "ImplementationType");
            var instance = Read(keyed ? "KeyedImplementationInstance" : "ImplementationInstance");
            var factory = (Delegate?)Read(keyed ? "KeyedImplementationFactory" : "ImplementationFactory");
            var data = new Dictionary<string, object?> { ["lifetime"] = lifetime, ["ordinal"] = ordinal, ["keyed"] = keyed };
            if (implementationType is not null) { data["registrationKind"] = "type"; data["implementation"] = TypeId(implementationType); }
            else if (instance is not null) { data["registrationKind"] = "instance"; data["implementation"] = TypeId(instance.GetType()); }
            else if (factory is not null)
            {
                data["registrationKind"] = "factory";
                var declaringType = factory.Method.DeclaringType;
                data["factory"] = $"{(declaringType is null ? "<dynamic>" : TypeId(declaringType))}::{factory.Method.Name}({string.Join(",", factory.Method.GetParameters().Select(p => TypeId(p.ParameterType)))})";
                data["factoryTargetType"] = factory.Target is null ? null : TypeId(factory.Target.GetType());
            }
            else throw new InvalidOperationException($"Unsupported service descriptor for {serviceType}");
            graph.Add(registration, "registration", $"{serviceType.Name} [{ordinal}]", data);
            graph.Link("registration", service, registration);
            var implementation = implementationType ?? instance?.GetType();
            if (implementation is not null)
            {
                var id = "implementation:" + TypeId(implementation);
                if (!graph.Entities.Any(node => node.Id == id)) graph.Add(id, "implementation", implementation.ToString(), new() { ["type"] = TypeId(implementation) });
                graph.Link("implements", registration, id);
                // Only a type registration is constructed by the container; an instance already exists.
                if (implementationType is not null && !implementationType.ContainsGenericParameters) constructed.TryAdd(id, implementationType);
            }
        }

        var unresolved = new SortedSet<string>(StringComparer.Ordinal);
        foreach (var (id, implementation) in constructed.OrderBy(entry => entry.Key, StringComparer.Ordinal))
        {
            var constructor = SelectConstructor(implementation, parameter => DependencyTarget(parameter, registered)?.Service);
            if (constructor is null) { unresolved.Add(TypeId(implementation)); continue; }
            foreach (var parameter in constructor.GetParameters())
            {
                if (DependencyTarget(parameter, registered) is not { } target) continue;
                graph.Link("dependsOn", id, target.Service, parameter.Name ?? parameter.Position.ToString(CultureInfo.InvariantCulture), new()
                {
                    ["parameter"] = parameter.Name,
                    ["position"] = parameter.Position,
                    ["collection"] = target.Collection,
                    ["optional"] = parameter.HasDefaultValue,
                }, "derived");
            }
        }

        graph.Metadata["limitations"] = new[]
        {
            "Factory registrations are recorded, not invoked. Instance state is not serialized. Registration ordinal is scoped to service type and key.",
            "Constructor dependencies are derived by applying the container's own constructor selection to type registrations; factory, instance and open generic registrations contribute no dependency edges.",
        };
        if (unresolved.Count > 0) graph.Metadata["unconstructableImplementations"] = unresolved.ToArray();
        return graph;
    }
}
